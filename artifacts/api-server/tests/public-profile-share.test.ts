import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import sharp from 'sharp';
import { createPublicProfileShareHandler } from '../src/seo/public-profile-share';

test('public profile share HTML shows the profile photo and identity without caching private changes', async () => {
  let visible = true;
  let reads = 0;
  const server = express()
    .use(createPublicProfileShareHandler(async identity => {
      reads++;
      if (identity === 'temporary') throw new Error('Database unavailable');
      if (!visible || !['alex', 'old-handle'].includes(identity)) return null;
      return { slug: 'alex', name: 'Alex "White" & Co', avatar: '/avatars/alex.png?v=2&public=1' };
    }, () => ({
      scripts: '<script type="module" src="/assets/app.js"></script>',
      styles: '', preloads: '', recovery: '',
    })))
    .use((_req, res) => { res.sendStatus(204); })
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const preview = await fetch(`${base}/tr/users/old-handle?source=whatsapp`, {
      headers: { 'User-Agent': 'WhatsApp' },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(preview.headers.get('X-Robots-Tag'), 'noindex, follow');
    const html = await preview.text();
    assert.match(html, /<meta property="og:type" content="profile">/);
    assert.match(html, /<meta property="og:title" content="Alex &quot;White&quot; &amp; Co · MegaRadio">/);
    assert.match(html, /<meta property="og:url" content="https:\/\/themegaradio\.com\/tr\/users\/alex">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/themegaradio\.com\/avatars\/alex\.png\?v=2&amp;public=1">/);
    assert.match(html, /<script type="module" src="\/assets\/app\.js"><\/script>/);
    const browser = await fetch(`${base}/tr/users/old-handle?source=whatsapp`);
    assert.equal(await browser.text(), html);

    visible = false;
    const withdrawn = await fetch(`${base}/tr/users/old-handle`);
    assert.equal(withdrawn.status, 404);
    assert.equal(withdrawn.headers.get('CDN-Cache-Control'), 'no-store');
    assert.doesNotMatch(await withdrawn.text(), /Alex|og:image/);

    const temporary = await fetch(`${base}/users/temporary`);
    assert.equal(temporary.status, 503);
    assert.equal(temporary.headers.get('Retry-After'), '30');
    assert.doesNotMatch(await temporary.text(), /og:image/);

    assert.equal((await fetch(`${base}/users`)).status, 204);
    assert.equal((await fetch(`${base}/users/alex/settings`)).status, 204);
    assert.equal(reads, 4);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('the public profile preview returns a square JPEG for managed photos, with privacy checked on the image request', async () => {
  const avatar = 'https://megaradio-station-logos.s3.eu-north-1.amazonaws.com/avatars/user_fixture_123.webp';
  const webp = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#ce2b86' } }).webp().toBuffer();
  let visible = true;
  const upstream: string[] = [];
  const app = express().use(createPublicProfileShareHandler(async id => {
    if (!visible) return null;
    return { slug: id, name: 'Fixture profile', avatar: id === 'managed' ? avatar : 'https://example.test/avatar.png' };
  }, () => ({ scripts: '', styles: '', preloads: '', recovery: '' }), async (url, options) => {
    upstream.push(String(url));
    assert.equal(options?.redirect, 'error');
    return new Response(Uint8Array.from(webp), { headers: { 'content-type': 'image/webp' } });
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const imagePath = '/en/users/managed/share-image.jpg';
  try {
    const html = await (await fetch(base + '/en/users/managed?preview=2', { headers: { 'User-Agent': 'WhatsApp' } })).text();
    assert.match(html, /property="og:image" content="https:\/\/themegaradio\.com\/en\/users\/managed\/share-image\.jpg"/);
    assert.match(html, /property="og:image:type" content="image\/jpeg"/);
    const response = await fetch(base + imagePath);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const { width, height, format } = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.deepEqual({ width, height, format }, { width: 400, height: 400, format: 'jpeg' });
    assert.equal((await fetch(base + '/en/users/external/share-image.jpg')).status, 404);
    visible = false;
    assert.equal((await fetch(base + imagePath)).status, 404);
    assert.deepEqual(upstream, [avatar]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
