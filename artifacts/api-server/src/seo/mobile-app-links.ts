import { FALLBACK_SEGMENT_TRANSLATIONS } from '@workspace/seo-shared/seo-config';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';

const LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];
const SEGMENTS = ['station', 'stations', 'genre', 'genres', 'user', 'users', 'profile'];

/** Match the content routes native clients handle, preserving legacy links. */
export function mobileAppLinkPaths(): string[] {
  const paths = new Set<string>(['/tv',...LANGUAGES.map(language=>`/${language}/tv`),'/nl/tv','/pl/tv']);
  for (const segment of SEGMENTS) {
    paths.add(`/${segment}/*`);
    paths.add(`/*/${segment}/*`);
    for (const language of LANGUAGES) {
      // Only claim paths understood by the shipped native parser. An arbitrary
      // admin translation must keep opening on the web until clients support it.
      const variants = [FALLBACK_SEGMENT_TRANSLATIONS[segment]?.[language], URL_TRANSLATIONS[language]?.[segment], segment];
      for (const value of variants) {
        if (!value || /[/?#*]/.test(value) || value === '.' || value === '..') continue;
        paths.add(`/${language}/${value}/*`);
        paths.add(`/${language}/${encodeURIComponent(value)}/*`);
      }
    }
  }
  return [...paths].sort();
}
