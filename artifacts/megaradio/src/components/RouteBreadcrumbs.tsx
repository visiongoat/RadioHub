import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { getLanguageFromPath, getRetiredLocaleFromPath } from '@workspace/seo-shared/seo-config';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { buildRegionBreadcrumbItems } from '@workspace/seo-shared/region-breadcrumbs';
import { useTranslation } from '@/hooks/useTranslation';
import { PROFILE_CONTENT_INSET } from '@/lib/profile-layout';
import { resolveFaqPageText } from '@workspace/seo-shared/faq-schema';
import { StationDirectoryContext } from '@/hooks/useStationDirectory';
import { preserveInitialSsrHead } from '@/utils/ssr-seo-head';
import { getLegacyStationGuideRoute } from '@workspace/seo-shared/legacy-station-guide-routes';

/**
 * Visible breadcrumb trail rendered on every non-home page in the React app —
 * the client-side counterpart to the SSR breadcrumb produced by
 * `computeBreadcrumbItems` in artifacts/api-server/src/seo-renderer.ts.
 *
 * Task #280 added the visible <nav class="breadcrumb"> to the SSR body so the
 * BreadcrumbList JSON-LD has matching visible links (Google flags mismatches as
 * deceptive markup). Once React hydrates, the SSR body is replaced and only a
 * handful of pages re-render their own breadcrumbs — leaving the JSON-LD
 * orphaned for the other pages and for client-side navigations. This component
 * closes that gap by rendering the same breadcrumb items (same names + same
 * href paths) the SSR helper produces.
 *
 * Items are derived purely from the URL using the same rules as the SSR helper:
 *   - Skip on the home page (cleanPath '' or '/').
 *   - Always lead with a Home crumb pointing at /<lang>.
 *   - Walk the english cleanPath segments, translating each into the user's
 *     language via URL_TRANSLATIONS[lang][seg], building href paths the same
 *     way SSR does.
 *   - Resolve display names with the `nav_<segment>` translation key, falling
 *     back to a title-cased version of the slug — same fallback SSR uses.
 *   - Drop the literal `station`/`stations` segment in favour of an injected
 *     "Stations" crumb (matches SSR special-case so /<lang>/<station>/<slug>
 *     gets Home › Stations › <Station Name>).
 *   - Detail pages whose last segment is a content slug (station name, genre
 *     name, region/country/city name) can override that label by wrapping
 *     themselves in <BreadcrumbOverrideProvider name="…"> — otherwise the
 *     title-cased slug is shown, which matches SSR behaviour when the
 *     stationData.name is missing.
 */

type BreadcrumbOverride = {
  /** Replace the *last* breadcrumb item's display name (e.g. station name). */
  lastItemName?: string;
};

const BreadcrumbOverrideContext = createContext<{
  override: BreadcrumbOverride;
  setOverride: (next: BreadcrumbOverride) => void;
}>({ override: {}, setOverride: () => {} });

export function BreadcrumbOverrideProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<BreadcrumbOverride>({});
  const value = useMemo(() => ({ override, setOverride }), [override]);
  return (
    <BreadcrumbOverrideContext.Provider value={value}>
      {children}
    </BreadcrumbOverrideContext.Provider>
  );
}

/**
 * Hook for detail pages to publish a friendlier label for the trailing
 * breadcrumb item (e.g. the actual station name instead of the URL slug).
 * Pass `null`/`undefined` to clear any prior override (we always clear on
 * unmount so the next page starts clean).
 */
export function useBreadcrumbLastItemName(name: string | null | undefined) {
  const { setOverride } = useContext(BreadcrumbOverrideContext);
  useEffect(() => {
    setOverride({ lastItemName: name || undefined });
    return () => setOverride({});
  }, [name, setOverride]);
}

function titleCaseSlug(slug: string): string {
  return slug
    .replace(/-/g, ' ')
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

interface BreadcrumbItem {
  name: string;
  path: string;
}

function retiredStationCanonicalPath(canonical: string | undefined): string | undefined {
  if (!canonical) return;
  try {
    const url = new URL(canonical);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return;
    if (url.origin !== 'https://themegaradio.com' && url.origin !== window.location.origin) return;
    if (!/^\/en\/station\/[^/]+$/.test(url.pathname)) return;
    return url.pathname + url.search;
  } catch {
    return;
  }
}

const accountBreadcrumbLabels: Record<string, readonly [string, string, string]> = {
  en: ['Listeners', 'Profile', 'Settings'], de: ['Hörer', 'Profil', 'Einstellungen'],
  tr: ['Dinleyiciler', 'Profil', 'Ayarlar'], es: ['Oyentes', 'Perfil', 'Configuración'],
  fr: ['Auditeurs', 'Profil', 'Paramètres'], pt: ['Ouvintes', 'Perfil', 'Configurações'],
  it: ['Ascoltatori', 'Profilo', 'Impostazioni'], ru: ['Слушатели', 'Профиль', 'Настройки'],
  ar: ['المستمعون', 'الملف الشخصي', 'الإعدادات'], zh: ['听众', '个人资料', '设置'],
  ja: ['リスナー', 'プロフィール', '設定'], ko: ['청취자', '프로필', '설정'],
  hi: ['श्रोता', 'प्रोफ़ाइल', 'सेटिंग'], he: ['מאזינים', 'פרופיל', 'הגדרות'],
};

function computeItems(params: {
  language: string;
  cleanPath: string;
  t: (key: string, fallback?: string) => string;
  localeTranslations?: Readonly<Record<string, string>>;
  lastItemName?: string;
}): BreadcrumbItem[] {
  const { language, cleanPath, t, localeTranslations, lastItemName } = params;
  if (!cleanPath || cleanPath === '/' || cleanPath === '') return [];
  // The shared editorial renderer owns the fully localized breadcrumb and
  // matching JSON-LD, including article titles rather than slug-derived text.
  if (cleanPath === '/blog' || cleanPath.startsWith('/blog/')) return [];

  const lang = language || 'en';
  const langTranslations = (URL_TRANSLATIONS[lang] || {}) as Record<string, string>;
  const regionItems = buildRegionBreadcrumbItems({
    language: lang, cleanPath, lastItemName,
    getLocalizedText: (key, fallback) => key === 'nav_home' || key === 'nav_regions'
      ? t(key, fallback)
      : localeTranslations?.[key]?.trim() || fallback,
  });
  if (regionItems) return regionItems;

  const items: BreadcrumbItem[] = [
    { name: t('nav_home', 'Home'), path: `/${lang}` },
  ];

  const pathSegments = cleanPath.split('/').filter(Boolean);
  const translateSeg = (seg: string): string => {
    if (!lang || lang === 'en') return seg;
    return langTranslations[seg] || seg;
  };

  let currentPath = '';
  const isStationsPath =
    cleanPath.includes('/station/') || cleanPath.includes('/stations/') || cleanPath.endsWith('/station') || cleanPath.endsWith('/stations');

  for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i];
    // Settings is the profile itself, not a second child profile screen.
    if (pathSegments[0] === 'profile' && pathSegments.length === 2 && segment === 'settings') continue;
    const isLastSegment = i === pathSegments.length - 1;
    const isStationDetailSlug =
      isLastSegment && (cleanPath.includes('/station/') || cleanPath.includes('/stations/'));
    const segForUrl = isStationDetailSlug ? segment : translateSeg(segment);
    currentPath += '/' + segForUrl;

    if (isStationDetailSlug) {
      const name = lastItemName || titleCaseSlug(segment);
      items.push({ name, path: `/${lang}${currentPath}` });
    } else if (segment !== 'stations' && segment !== 'station') {
      const translationKey = `nav_${segment}`;
      const fallback = titleCaseSlug(segment);
      const accountLabelIndex = ['users', 'profile', 'settings'].indexOf(segment);
      // Account routes need a local fallback before the global translator's
      // English dictionary. Other breadcrumb labels keep their existing policy.
      const baseName = segment === 'faq' ? resolveFaqPageText(lang, { ...localeTranslations }).navLabel : accountLabelIndex >= 0
        ? localeTranslations?.[translationKey]?.trim() || (accountBreadcrumbLabels[lang] || accountBreadcrumbLabels.en)[accountLabelIndex]
        : t(translationKey, fallback);
      const displayName = isLastSegment && lastItemName ? lastItemName : baseName;
      const path = i === 0 && segment === 'profile'
        ? `/${lang}/${translateSeg('profile')}/${translateSeg('settings')}`
        : `/${lang}${currentPath}`;
      items.push({ name: displayName, path });
    }
  }

  // SSR special-case: ensure a "Stations" crumb sits between Home and the
  // station detail item on /<lang>/<stations-segment>/<slug> URLs.
  if (isStationsPath) {
    const idx = items.findIndex((b) => !b.path.includes('/station'));
    const stationsName = t('nav_stations', 'Stations');
    if (idx >= 0 && !items.find((b) => b.name.toLowerCase() === stationsName.toLowerCase())) {
      let stationSegment = 'stations';
      if (lang !== 'en') {
        stationSegment = langTranslations['stations'] || 'stations';
      }
      items.splice(idx + 1, 0, {
        name: stationsName,
        path: `/${lang}/${stationSegment}`,
      });
    }
  }

  return items;
}

export function RouteBreadcrumbs({ placement = 'page' }: { placement?: 'page' | 'content' } = {}) {
  const [location] = useLocation();
  const { t, localeTranslations } = useTranslation();
  const { override } = useContext(BreadcrumbOverrideContext);
  const seoPage = useContext(StationDirectoryContext);

  const { language, cleanPath } = getLanguageFromPath(location);
  const isProfilePage = cleanPath === '/profile' || cleanPath.startsWith('/profile/');
  const isGenreIndex = cleanPath === '/genres';
  const retiredStation = getRetiredLocaleFromPath(location) && /^\/station\/[^/]+$/.test(cleanPath);
  // The retired URL retains its alias, but the server has already resolved
  // the actual station. Reuse that exact target, including safe ID canonicals.
  const canonical = retiredStation
    ? preserveInitialSsrHead(window.location.pathname + window.location.search)
      ? document.querySelector<HTMLLinkElement>('link[rel="canonical"][data-managed="seo-head"]')?.href
      : seoPage?.query.data?.seoTags?.canonical
    : undefined;
  const stationCanonicalPath = retiredStationCanonicalPath(canonical);

  const items = useMemo(
    () => {
      const result = computeItems({
        language: language || 'en',
        cleanPath,
        t,
        localeTranslations,
        lastItemName: override.lastItemName,
      });
      if (stationCanonicalPath && result.length) result[result.length - 1].path = stationCanonicalPath;
      return result;
    },
    [language, cleanPath, t, localeTranslations, override.lastItemName, stationCanonicalPath],
  );

  if (items.length === 0 || (getLegacyStationGuideRoute(location) && seoPage?.query.data?.legacyGuideId)) return null;

  return (
    <nav
      aria-label="breadcrumb"
      className={`breadcrumb text-xs sm:text-sm ${placement === 'content' ? 'mt-2 mb-5' : `bg-[#101010] py-3 ${isProfilePage ? PROFILE_CONTENT_INSET : isGenreIndex ? '' : 'px-4'}`}`}
    >
      <ol className={`${placement === 'content' || isProfilePage ? '' : 'container mx-auto '}${isGenreIndex ? 'max-sm:!px-5 ' : ''}flex flex-wrap items-center gap-2 text-gray-400`}>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.path}-${idx}`} className="flex items-center gap-2">
              {idx > 0 && (
                <span aria-hidden="true" className="text-gray-600">
                  ›
                </span>
              )}
              {/* SSR parity: every breadcrumb item is an anchor with the same
                  href computeBreadcrumbItems produced — including the last
                  one. Rendering the trailing item as plain text would re-open
                  the visible/JSON-LD mismatch Task #371 is closing. */}
              <Link
                href={item.path}
                aria-current={isLast ? 'page' : undefined}
                className={
                  isLast
                    ? 'text-gray-200 hover:text-white transition-colors truncate max-w-[200px] sm:max-w-none'
                    : 'hover:text-white transition-colors'
                }
              >
                {item.name}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
