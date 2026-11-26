import type { RequestHandler } from 'express';
import { getLanguageFromPath } from '@workspace/seo-shared/seo-config';
import { STATION_LOGOS_S3_BASE_URL } from '@workspace/seo-shared/station-logo-url';
import sharp from 'sharp';

type Profile = { slug: string; name: string; avatar: string | null };
type Assets = { scripts: string; styles: string; preloads: string; recovery: string };

const origin = 'https://themegaradio.com';
const profilePath = /^\/users\/([\p{L}\p{N}._~-]{1,160})\/?$/u;
const previewImagePath = /^\/users\/([\p{L}\p{N}._~-]{1,160})\/share-image\.jpg$/u;
const avatarStorageOrigin = new URL(STATION_LOGOS_S3_BASE_URL).origin;
const previewImageSize = 400;
const avatarMaxBytes = 2 * 1024 * 1024;
const cacheHeaders = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, follow',
};

const copy = {
  en: { title: (name: string) => `${name} on MegaRadio`, desc: (name: string) => `Explore ${name}’s public radio profile on MegaRadio.`,
    missing: 'This profile is unavailable', temporary: 'This profile is temporarily unavailable', locale: 'en_US' },
  tr: { title: (name: string) => `${name} · MegaRadio`, desc: (name: string) => `${name} adlı kullanıcının MegaRadio profilini keşfet.`,
    missing: 'Bu profil görüntülenemiyor', temporary: 'Bu profil geçici olarak görüntülenemiyor', locale: 'tr_TR' },
  de: { title: (name: string) => `${name} auf MegaRadio`, desc: (name: string) => `Entdecke das öffentliche Radioprofil von ${name} auf MegaRadio.`,
    missing: 'Dieses Profil ist nicht verfügbar', temporary: 'Dieses Profil ist vorübergehend nicht verfügbar', locale: 'de_DE' },
};

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function safeAvatar(avatar: string | null) {
  if (!avatar) return undefined;
  try {
    const url = new URL(avatar, origin);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    if (url.hostname === 'lh3.googleusercontent.com') url.pathname = url.pathname.replace(/=s[0-9]+-c$/, '=s400-c');
    return url.href;
  } catch { return undefined; }
}

function managedAvatar(address: string | undefined) {
  if (!address) return false;
  const url = new URL(address);
  return url.origin === avatarStorageOrigin && !url.search
    && /^\/avatars\/user_[a-z0-9_-]+_[0-9]+\.webp$/i.test(url.pathname);
}

async function loadPreviewImage(avatar: string, fetchImage: typeof fetch) {
  const response = await fetchImage(avatar, { redirect: 'error', signal: AbortSignal.timeout(4000) });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > avatarMaxBytes
    || response.headers.get('content-type')?.split(';')[0] !== 'image/webp') {
    await response.body?.cancel();
    throw new Error('Profile image source is unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > avatarMaxBytes) throw new Error('Profile image exceeds the preview size limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return sharp(Buffer.concat(chunks, length), { limitInputPixels: 1_048_576 })
    .timeout({ seconds: 2 })
    .rotate()
    .resize(previewImageSize, previewImageSize, { fit: 'cover' })
    .flatten({ background: '#151515' })
    .jpeg({ quality: 83 })
    .toBuffer();
}

/** Serve the same, uncached profile document to people and link preview crawlers. */
export function createPublicProfileShareHandler(
  loadProfile: (identity: string) => Promise<Profile | null>,
  loadAssets: () => Assets,
  fetchImage: typeof fetch = globalThis.fetch,
): RequestHandler {
  let activeImages = 0;
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let path;
    try { path = decodeURIComponent(req.path); }
    catch { return next(); }
    const { language, cleanPath } = getLanguageFromPath(path);
    const imageIdentity = previewImagePath.exec(cleanPath)?.[1];
    const identity = imageIdentity ?? profilePath.exec(cleanPath)?.[1];
    if (!identity || identity === '.' || identity === '..') return next();

    res.set(cacheHeaders);
    const labels = copy[language as keyof typeof copy] ?? copy.en;
    let status = 200;
    let profile: Profile | null = null;
    try {
      profile = await loadProfile(identity);
      if (!profile) status = 404;
    } catch {
      status = 503;
      res.set('Retry-After', '30');
    }
    const avatar = profile ? safeAvatar(profile.avatar) : undefined;
    const hasManagedAvatar = managedAvatar(avatar);
    if (imageIdentity) {
      if (status === 503) return void res.sendStatus(503);
      if (!avatar || !hasManagedAvatar) return void res.sendStatus(404);
      if (activeImages >= 8) return void res.set('Retry-After', '10').sendStatus(503);
      activeImages++;
      try {
        const image = await loadPreviewImage(avatar, fetchImage);
        return void res.type('jpeg').send(image);
      } catch {
        return void res.set('Retry-After', '30').sendStatus(503);
      } finally {
        activeImages--;
      }
    }
    const title = escape(profile ? labels.title(profile.name) : status === 404 ? labels.missing : labels.temporary);
    const description = escape(profile ? labels.desc(profile.name) : '');
    const canonical = escape(`${origin}/${language}/users/${encodeURIComponent(profile?.slug ?? identity)}`);
    const socialImage = hasManagedAvatar
      ? `${canonical}/share-image.jpg`
      : escape(avatar || `${origin}/api/og-image`);
    const assets = loadAssets();

    return void res.status(status).type('html').send(`<!doctype html>
<html lang="${escape(language)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="robots" content="noindex, follow">
<link rel="icon" href="/favicon.ico">
${profile ? `<link rel="canonical" href="${canonical}">
<meta name="description" content="${description}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="MegaRadio">
<meta property="og:locale" content="${labels.locale}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${socialImage}">
<meta property="og:image:secure_url" content="${socialImage}">
${hasManagedAvatar ? `<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="${previewImageSize}">
<meta property="og:image:height" content="${previewImageSize}">` : ''}
<meta property="og:image:alt" content="${escape(avatar ? profile.name : 'MegaRadio')}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${socialImage}">` : ''}
${assets.recovery}${assets.styles}${assets.preloads}
</head><body><div id="root"></div>
${assets.scripts || '<script type="module" src="/src/main.tsx"></script>'}
</body></html>`);
  };
}
