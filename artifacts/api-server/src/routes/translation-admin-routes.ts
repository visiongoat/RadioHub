import type { Express } from "express";
import { registerStationVoteRoutes } from "./station-vote-routes";
import { CODE_TO_COUNTRY, SEO_LANGUAGES, isActiveUiLanguage } from "@workspace/seo-shared/seo-config";
import { registerAdminLanguageArchiveRoutes } from './admin-language-archive-routes';
import { SAFE_GENRE_SLUG_RE, normalizeGenreSlug } from '../seo/genre-slug';
import { findActiveAuthToken } from '../data/auth-token-store';
import { pgLocalization } from '../data/postgres-localization-store';
async function generateUserSlug(user: any, _excludeId?: any): Promise<string> {
    const base = (user?.fullName || user?.username || user?.email?.split('@')[0] || 'user')
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    return base || 'user';
}
import { pgCatalog, pgSyncLogs } from '../data/postgres-catalog-store';
import { pgStationFacetCounts, pgGenreLandingCountries, pgGenreLandingRelated, pgFavoriteIds, pgAdminAddFavorites, pgFlushStationData, pgAnalyticsEvents, pgGenrePopulationCounts } from '../data/postgres-translation-admin-store';
import { pgStoredGenreById, pgListAdminGenres, pgUpsertPopulatedGenre, pgMergeDemotedGenre, pgPruneGenreMergeAudit, pgGenreMergeAuditList } from '../data/postgres-genre-admin-store';
import CacheManager from "../cache";
import { publicStationCache } from "../public-station-cache";
import { publicStationResponseCache } from '../middleware/public-station-cache';
import { logger } from "../utils/logger";
import { stripPlaceholders } from "./shared-utils";
import { refreshCommunityFavoritesCache, fetchTranslationsForLanguage, refreshTranslationsCache } from "./cache-refresh-utils";
import { syncService } from "../services/sync";
import { registerAdminStationSyncPolicyRoutes } from './admin-station-sync-policy-routes';
import { isQuotaExceeded, isQuotaError, handleQuotaError, safeWrite } from "../utils/quota-guard";
import { performanceCache } from "../performance-cache";
import { invalidatePublicStationDetails, stationDetailIdentifiers } from '../services/station-detail-cache';
import { triggerGenreStationCountsRecompute } from '../services/genre-station-counts';
import { buildManualStationMergePreview, ManualStationMergeError, parseManualStationMerge } from '../utils/manual-station-merge-review';
import { getPhaseCTranslations } from "../data/phase-c-translations";
import { UserEngagementService } from "../services/user-engagement-service";
import { getCommunityProfiles } from '../services/community-profiles';
import { publicUserIdentity } from '../utils/public-user-identity';
import { pgAddRecentlyPlayed, pgFavoriteStationsForUser, pgFindStationRating, pgIsFavorite, pgRateStationIdentity, pgRecentlyPlayedStations, pgStationRatingsDetailed, } from "../data/postgres-engagement-store";
import { ensurePostgresUser } from "../data/auth-token-store";
import { getStationByIdentifier } from "../data/station-read-store";
import { incrementStationClick } from "../data/station-write-store";
import { pgCreateNotification, pgDismissAllNotifications, pgListNotifications, pgMarkAllNotificationsRead, pgMarkNotificationRead, notificationCategories, type NotificationCategory } from "../data/postgres-notification-store";
import { pgFindUserByEmail, pgFindUserByIdOrSlug, pgUpdateUser, pgUserFavoriteCount, pgUserFollowCounts, pgUsersNeedingProfileFix, newPublicUserId } from "../data/postgres-user-store";
// Module-scoped lock for the auto-translate route. The translation pipeline
// reads existing rows, calls OpenAI in batches, then writes results — running
// two concurrent jobs for the same language causes duplicate-key errors,
// double API spend, and undefined "last write wins" semantics. Holding a
// per-language Set fails fast locally; the PostgreSQL singleton below also
// excludes other replicas and background sync while fencing every write.
const inFlightTranslateJobs = new Set<string>();

async function invalidateManualMergeCaches(result: { primary: Record<string, any> | null; duplicates: Record<string, any>[]; deletedCount: number }): Promise<boolean> {
    const attempts: (() => unknown)[] = [
        () => invalidatePublicStationDetails(stationDetailIdentifiers(...[result.primary, ...result.duplicates].filter(station => station !== null))),
        ...['stations:', 'popular_stations:', 'precomputed_stations:', 'similar_stations:', 'similar:', 'nearby:',
            'community_favorites:', 'radio-browser:', 'station_stats', 'filters:', 'user-favorites:', 'recently-played:']
            .map(pattern => () => publicStationCache.clearByPattern(pattern)),
        () => CacheManager.clearByPattern('admin_stations:'),
        () => CacheManager.clearByPattern('admin:stations:'),
        () => CacheManager.del('admin-station-filter-options:v1'),
        () => performanceCache.clearSeoAndQuickCaches(),
        () => performanceCache.clearSimilarStationPools(),
    ];
    if (result.deletedCount > 0) attempts.push(() => triggerGenreStationCountsRecompute('manual-station-merge'));
    const settled = Promise.allSettled(attempts.map(attempt => Promise.resolve().then(attempt)))
        .then(results => results.every(result => result.status === 'fulfilled'));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        // Report only the local adapters' outcome, never all-replica acknowledgement.
        return await Promise.race([settled, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 500); })]);
    } finally { clearTimeout(timer); }
}

function manualMergeError(res: any, error: unknown): void {
    if (error instanceof ManualStationMergeError) {
        res.status(error.status).json({ error: error.message, code: error.code });
    } else if ((error as any)?.code === 'MERGE_ALIAS_CONFLICT') {
        res.status(409).json({ error: 'Station alias ownership changed; review the group again', code: 'MANUAL_MERGE_ALIAS_CONFLICT' });
    } else {
        res.status(503).json({ error: 'Station merge is temporarily unavailable', code: 'MANUAL_MERGE_UNAVAILABLE' });
    }
}
async function healthyRadioBrowserStations(order: 'clickCount' | 'votes' | 'updatedAt', requested: unknown) {
    const limit = Math.max(1, Math.min(Math.trunc(Number(requested)) || 100, 500));
    return publicStationCache.getOrSetSingleFlight(`radio-browser:${order}:${limit}`, async () => {
        const stations = await pgCatalog().find({ isListVisible: true }, { sort: { [order]: -1 }, limit,
            fields: ['_id','stationuuid','changeUuid','name','slug','url','urlResolved','homepage','favicon','tags','country','countryCode',
                'state','language','languageCodes','codec','bitrate','hls','votes','clickCount','clickTrend','lastCheckOk','lastCheckTime',
                'lastCheckOkTime','lastChangeTime','geoLat','geoLong','logoAssets'] });
        return stations.map(s => ({ ...s, changeuuid:s.changeUuid, url_resolved:s.urlResolved, countrycode:s.countryCode,
            languagecodes:Array.isArray(s.languageCodes) ? s.languageCodes.join(',') : s.languageCodes,
            clickcount:s.clickCount, clicktrend:s.clickTrend, lastcheckok:s.lastCheckOk ? 1 : 0,
            lastchecktime:s.lastCheckTime, lastchecktime_iso8601:s.lastCheckTime,
            lastcheckoktime:s.lastCheckOkTime, lastchangetime:s.lastChangeTime, geo_lat:s.geoLat, geo_long:s.geoLong }));
    });
}
export function registerTranslationAdminRoutes(app: Express, deps: any) {
    app.use(['/api/filters','/api/recently-played','/api/community-favorites','/api/radio-browser','/api/user/favorites','/api/users'], publicStationResponseCache);
    const { requireAuth, requireAdmin } = deps;
    registerAdminStationSyncPolicyRoutes(app, requireAdmin);
    registerAdminLanguageArchiveRoutes(app, requireAdmin);
    const userEngagementService = new UserEngagementService();
    async function authenticatedUserId(req: any): Promise<string | undefined> {
        const sessionUserId = req.session?.userId || req.session?.user?.userId;
        if (sessionUserId)
            return String(sessionUserId);
        const authHeader = req.headers?.authorization;
        const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : null;
        const tokenDoc = bearerToken ? await findActiveAuthToken(bearerToken) : null;
        return tokenDoc?.userId ? String(tokenDoc.userId) : undefined;
    }
    async function createUserNotification(input: Record<string, any>): Promise<any> {
        const id = newPublicUserId();
        let result: any;
        {
            result = await pgCreateNotification({ id, ...input } as any);
        }
        await CacheManager.clearByPattern(`notifications:postgres:${input.userId}:`).catch(() => {});
        return result;
    }
    // Remove duplicate endpoint - using the one below that includes auto-population
    // ADMIN TRANSLATION LANGUAGES API - Manage translation languages
    app.get("/api/admin/translation-languages", requireAdmin, async (req, res) => {
        try {
            return void res.json(await pgLocalization().translationLanguagesWithCompletion());
        }
        catch (error) {
            // console.error('Error fetching translation languages:', error);
            res.status(500).json({ error: 'Failed to fetch translation languages' });
        }
    });
    // CREATE Translation Language
    app.post("/api/admin/translation-languages", requireAdmin, async (req, res) => {
        try {
            const { code, name, isEnabled, isDefault } = req.body;
            // Validate required fields
            if (typeof code !== 'string' || !code.trim() || typeof name !== 'string' || !name.trim()) {
                return void res.status(400).json({ error: 'Language code and name are required' });
            }
            if (!isActiveUiLanguage(code)) return void res.status(400).json({ error: 'Only the 14 published UI languages can be added' });
            {
                const language = await pgLocalization().saveTranslationLanguage({ code, name, isEnabled, isDefault });
                return void res.status(201).json(language);
            }
        }
        catch (error) {
            // console.error('Error creating translation language:', error);
            if ((error as any).code === '23505') {
                return void res.status(409).json({ error: 'Language with this code already exists' });
            }
            res.status(500).json({ error: 'Failed to create translation language' });
        }
    });
    // UPDATE Translation Language
    app.put("/api/admin/translation-languages/:id", requireAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { code, name, isEnabled, isDefault } = req.body;
            if (code !== undefined && !isActiveUiLanguage(code)) return void res.status(400).json({ error: 'Only the 14 published UI languages can be added' });
            {
                const language = await pgLocalization().saveTranslationLanguage({ code, name, isEnabled, isDefault }, String(id));
                return void (language ? res.json(language) : res.status(404).json({ error: 'Translation language not found' }));
            }
        }
        catch (error) {
            // console.error('Error updating translation language:', error);
            if ((error as any).code === '23505') {
                return void res.status(409).json({ error: 'Language with this code already exists' });
            }
            res.status(500).json({ error: 'Failed to update translation language' });
        }
    });
    // DELETE Translation Language
    app.delete("/api/admin/translation-languages/:id", requireAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            {
                const language = await pgLocalization().deleteTranslationLanguage(String(id));
                return void (language ? res.json({ message: 'Translation language deleted successfully' }) : res.status(404).json({ error: 'Translation language not found' }));
            }
        }
        catch (error) {
            // console.error('Error deleting translation language:', error);
            if ((error as any).code === 'default_language') {
                return void res.status(400).json({ error: 'Cannot delete the default language' });
            }
            res.status(500).json({ error: 'Failed to delete translation language' });
        }
    });
    // GET Translation Metadata - for cache versioning
    app.get("/api/admin/translation-metadata", requireAdmin, async (req, res) => {
        try {
            const { getTranslationMetadata } = await import('../services/translation-version');
            const metadata = await getTranslationMetadata();
            res.json(metadata);
        }
        catch (error) {
            console.error('Error fetching translation metadata:', error);
            res.status(500).json({ error: 'Failed to fetch translation metadata' });
        }
    });
    // POST Bump Translation Version - invalidates client caches
    app.post("/api/admin/translation-metadata/bump", requireAdmin, async (req, res) => {
        try {
            const { notes } = req.body;
            const { bumpTranslationVersion } = await import('../services/translation-version');
            const result = await bumpTranslationVersion(notes);
            if (result.success) {
                res.json({
                    success: true,
                    version: result.version,
                    message: `Translation version bumped to ${result.version}`
                });
            }
            else {
                res.status(500).json({ error: 'Failed to bump translation version' });
            }
        }
        catch (error) {
            console.error('Error bumping translation version:', error);
            res.status(500).json({ error: 'Failed to bump translation version' });
        }
    });
    // Seed only the published UI cohort, not the historical URL-language catalog.
    app.post("/api/admin/seed-translation-languages", requireAdmin, async (req, res) => {
        try {
            const languageMapping = Object.fromEntries(SEO_LANGUAGES.filter(l => isActiveUiLanguage(l.code)).map(l => [l.code, l.name]));
            let created = 0;
            let updated = 0;
            let skipped = 0;
            // Check if there's already a default language
            {
                const languages = await pgLocalization().getTranslationLanguages();
                const codes = new Set(languages.map((language) => language.code));
                let hasDefault = languages.some((language) => language.isDefault);
                for (const [code, name] of Object.entries(languageMapping)) {
                    if (codes.has(code)) {
                        skipped++;
                        continue;
                    }
                    const isDefault = !hasDefault && ['en', 'he', 'tr'].includes(code);
                    await pgLocalization().saveTranslationLanguage({ code, name, isEnabled: true, isDefault });
                    if (isDefault)
                        hasDefault = true;
                    created++;
                }
                return void res.json({ message: 'Translation languages seeded successfully', stats: { total: Object.keys(languageMapping).length, created, updated, skipped } });
            }
        }
        catch (error) {
            console.error('Error seeding translation languages:', error);
            res.status(500).json({ error: 'Failed to seed translation languages' });
        }
    });
    // AUTO-TRANSLATE Language via OpenAI - Enhanced with English detection and brand protection
    app.post("/api/admin/translation-languages/:code/translate", requireAdmin, async (req, res) => {
        const { code } = req.params;
        const lockKey = (code || '').toLowerCase();
        if (!isActiveUiLanguage(lockKey)) return void res.status(400).json({ error: 'Language is not in the published UI cohort' });
        // Server-side lock: reject if a job for this language is already running.
        // Without this, double-clicks on "Auto-translate" or two admins clicking
        // simultaneously kick off two pipelines that both insert/update the same
        // rows — wasting OpenAI tokens and risking duplicate-key write errors.
        if (lockKey && inFlightTranslateJobs.has(lockKey)) {
            return void res.status(409).json({
                error: 'A translation job for this language is already running',
                code: 'translation_job_in_progress',
            });
        }
        if (lockKey) {
            inFlightTranslateJobs.add(lockKey);
        }
        try {
            const { pgTranslationSync } = await import('../data/postgres-translation-sync-store');
            const reply = await pgTranslationSync().withLeader(async writer => {
            // missingOnly=true → only insert truly missing translations, never overwrite existing rows
            const missingOnly = req.query.missingOnly === 'true' || req.body?.missingOnly === true;
            const maxKeys = req.body?.maxKeys;
            if (maxKeys !== undefined && (!missingOnly || !Number.isSafeInteger(maxKeys) || maxKeys < 1 || maxKeys > 60))
                return {status:400,body:{error:'maxKeys must be an integer from 1 to 60 in missing-only mode'}};
            // Skip English - no need to translate
            if (code.toLowerCase() === 'en') {
                return { status: 200, body: {
                    message: 'English is the source language, no translation needed',
                    stats: { total: 0, existing: 0, translated: 0, fixed: 0, failed: 0 }
                } };
            }
            // Find the language
            const language = (await pgLocalization().findTranslationLanguage(code.toLowerCase()));
            if (!language) {
                return { status: 404, body: { error: 'Translation language not found' } };
            }
            if (!language.isEnabled) return { status: 409, body: { error: 'Translation language is disabled' } };
            // Protected terms that should NOT be translated (brand names and placeholders)
            const PROTECTED_TERMS = [
                'Mega Radio', 'MegaRadio', 'mega radio',
                '{STATION_NAME}', '{stationname}', '{station_name}', '{station}',
                '{country}', '{COUNTRY}', '{Country}',
                '{genre}', '{GENRE}', '{Genre}',
                '{language}', '{LANGUAGE}', '{Language}',
                '{city}', '{CITY}', '{City}',
                '{count}', '{COUNT}', '{name}', '{NAME}',
                '{url}', '{URL}', '{link}', '{LINK}',
                '{time}', '{TIME}', '{date}', '{DATE}',
                '{number}', '{NUMBER}', '{value}', '{VALUE}'
            ];
            // Common English words to detect incorrect translations (excluding protected terms)
            const COMMON_ENGLISH_WORDS = [
                'the', 'and', 'for', 'with', 'your', 'you', 'are', 'have', 'has', 'this', 'that',
                'from', 'will', 'can', 'all', 'more', 'when', 'there', 'their', 'what', 'about',
                'which', 'would', 'make', 'like', 'just', 'over', 'such', 'into', 'than', 'other',
                'been', 'some', 'could', 'them', 'being', 'these', 'because', 'each', 'through',
                'listen', 'radio', 'station', 'stations', 'streaming', 'music', 'live', 'online',
                'discover', 'explore', 'find', 'search', 'browse', 'play', 'playing', 'favorite',
                'favorites', 'settings', 'loading', 'error', 'please', 'wait', 'welcome', 'hello',
                'world', 'country', 'countries', 'genre', 'genres', 'popular', 'trending', 'new',
                'free', 'unlimited', 'access', 'anywhere', 'anytime', 'best', 'top', 'quality'
            ];
            // Function to detect if translation contains English content
            const hasEnglishContent = (text: string, isEnglishSource: boolean = false): boolean => {
                if (!text || isEnglishSource)
                    return false;
                // Remove ALL placeholder patterns (any format: {xxx}, %xxx%, {{xxx}}, etc.)
                let cleanText = text;
                cleanText = cleanText.replace(/\{[^}]+\}/gi, ''); // {placeholder}
                cleanText = cleanText.replace(/%[^%]+%/gi, ''); // %placeholder%
                cleanText = cleanText.replace(/\{\{[^}]+\}\}/gi, ''); // {{placeholder}}
                // Remove brand name "Mega Radio" in any case variation
                cleanText = cleanText.replace(/mega\s*radio/gi, '');
                // Trim and check if there's meaningful text left
                cleanText = cleanText.trim();
                if (!cleanText || cleanText.length < 3) {
                    // Text is mainly placeholders/brand names - skip
                    return false;
                }
                // Split into words and check for common English words
                const words = cleanText.toLowerCase().split(/\s+/).filter(w => w.length > 1);
                const englishWordCount = words.filter(word => COMMON_ENGLISH_WORDS.includes(word.replace(/[.,!?;:'"()]/g, ''))).length;
                // Calculate ratio: if more than 30% of words are common English words, likely incorrect
                const englishRatio = words.length > 0 ? englishWordCount / words.length : 0;
                // Flag as English if: 2+ common words AND >25% of text is English
                return englishWordCount >= 2 && englishRatio > 0.25;
            };
            // Get all translation keys
            const allKeys = (await pgLocalization().getKeys());
            // Get existing translations for this language - use keyId to map
            const existingTranslations = (await pgLocalization().listTranslations(code.toLowerCase()));
            // Map by the stable key ID, not the user-visible key string.
            const existingTranslationsMap = new Map(existingTranslations.map((t: any) => [t.keyId?.toString(), t]));
            // Find keys that need translation (missing OR have English content)
            const keysToTranslate: any[] = [];
            const keysToFix: string[] = [];
            for (const key of allKeys) {
                // Lookup matches the translation's native foreign-key identity.
                const existing = existingTranslationsMap.get(key._id?.toString());
                // Treat empty / whitespace-only existing rows as "missing" — otherwise
                // missingOnly=true skips them forever and the language stays half-empty.
                const existingValueTrimmed = (existing?.value || '').trim();
                if (!existing || existingValueTrimmed === '') {
                    // Missing (or effectively-empty) translation. Pass existingId when
                    // there's a row to update so we don't insert a duplicate.
                    keysToTranslate.push({
                        ...key,
                        isNew: !existing,
                        ...(existing ? { existingId: existing._id, existingValue: existing.value } : {}),
                    });
                }
                else if (!missingOnly) {
                    // Check if translation needs fixing (skip in missingOnly mode):
                    // 1. Value is same as key name (untranslated)
                    // 2. Value contains underscores (likely key name, not real translation)
                    // 3. Value is same as English default (not translated at all)
                    // 4. Value has English content
                    const value = existing.value?.trim() || '';
                    const defaultValue = key.defaultValue?.trim() || '';
                    const isUntranslated = value === key.key ||
                        (value.includes('_') && !value.includes('{') && value.length < 50) ||
                        (defaultValue && value.toLowerCase() === defaultValue.toLowerCase()) ||
                        hasEnglishContent(value);
                    if (isUntranslated) {
                        keysToTranslate.push({ ...key, isNew: false, existingId: existing._id, existingValue: existing.value });
                        keysToFix.push(key.key);
                    }
                }
            }
            if (keysToTranslate.length === 0) {
                return { status: 200, body: {
                    message: 'All translations are complete and correct for this language',
                    stats: {
                        total: allKeys.length,
                        existing: existingTranslations.length,
                        translated: 0,
                        fixed: 0,
                        failed: 0, remaining: 0
                    }
                } };
            }
            const deferredKeys = maxKeys === undefined ? 0 : Math.max(0, keysToTranslate.length - maxKeys);
            if(maxKeys !== undefined)keysToTranslate.splice(maxKeys);
            logger.log(`🔄 ${language.name}: Found ${keysToTranslate.filter(k => k.isNew).length} missing, ${keysToFix.length} to fix`);
            // Complete language mapping for all 57 languages
            const languageMapping: {
                [key: string]: {
                    name: string;
                    nativeName: string;
                };
            } = {
                af: { name: 'Afrikaans', nativeName: 'Afrikaans' },
                am: { name: 'Amharic', nativeName: 'አማርኛ' },
                ar: { name: 'Arabic', nativeName: 'العربية' },
                az: { name: 'Azerbaijani', nativeName: 'Azərbaycan' },
                bg: { name: 'Bulgarian', nativeName: 'Български' },
                bn: { name: 'Bengali', nativeName: 'বাংলা' },
                bs: { name: 'Bosnian', nativeName: 'Bosanski' },
                cs: { name: 'Czech', nativeName: 'Čeština' },
                da: { name: 'Danish', nativeName: 'Dansk' },
                de: { name: 'German', nativeName: 'Deutsch' },
                el: { name: 'Greek', nativeName: 'Ελληνικά' },
                es: { name: 'Spanish', nativeName: 'Español' },
                et: { name: 'Estonian', nativeName: 'Eesti' },
                fa: { name: 'Persian', nativeName: 'فارسی' },
                fi: { name: 'Finnish', nativeName: 'Suomi' },
                fr: { name: 'French', nativeName: 'Français' },
                gu: { name: 'Gujarati', nativeName: 'ગુજરાતી' },
                he: { name: 'Hebrew', nativeName: 'עברית' },
                hi: { name: 'Hindi', nativeName: 'हिन्दी' },
                hr: { name: 'Croatian', nativeName: 'Hrvatski' },
                hu: { name: 'Hungarian', nativeName: 'Magyar' },
                hy: { name: 'Armenian', nativeName: 'Հայերեն' },
                id: { name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
                it: { name: 'Italian', nativeName: 'Italiano' },
                ja: { name: 'Japanese', nativeName: '日本語' },
                kn: { name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
                ko: { name: 'Korean', nativeName: '한국어' },
                lt: { name: 'Lithuanian', nativeName: 'Lietuvių' },
                lv: { name: 'Latvian', nativeName: 'Latviešu' },
                ml: { name: 'Malayalam', nativeName: 'മലയാളം' },
                mr: { name: 'Marathi', nativeName: 'मराठी' },
                ms: { name: 'Malay', nativeName: 'Bahasa Melayu' },
                nl: { name: 'Dutch', nativeName: 'Nederlands' },
                no: { name: 'Norwegian', nativeName: 'Norsk' },
                pa: { name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
                pl: { name: 'Polish', nativeName: 'Polski' },
                pt: { name: 'Portuguese', nativeName: 'Português' },
                ro: { name: 'Romanian', nativeName: 'Română' },
                ru: { name: 'Russian', nativeName: 'Русский' },
                sk: { name: 'Slovak', nativeName: 'Slovenčina' },
                sl: { name: 'Slovenian', nativeName: 'Slovenščina' },
                so: { name: 'Somali', nativeName: 'Soomaali' },
                sq: { name: 'Albanian', nativeName: 'Shqip' },
                sr: { name: 'Serbian', nativeName: 'Српски' },
                sv: { name: 'Swedish', nativeName: 'Svenska' },
                sw: { name: 'Swahili', nativeName: 'Kiswahili' },
                ta: { name: 'Tamil', nativeName: 'தமிழ்' },
                te: { name: 'Telugu', nativeName: 'తెలుగు' },
                th: { name: 'Thai', nativeName: 'ไทย' },
                tl: { name: 'Filipino', nativeName: 'Tagalog' },
                tr: { name: 'Turkish', nativeName: 'Türkçe' },
                uk: { name: 'Ukrainian', nativeName: 'Українська' },
                ur: { name: 'Urdu', nativeName: 'اردو' },
                vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt' },
                zh: { name: 'Chinese', nativeName: '中文' },
                zu: { name: 'Zulu', nativeName: 'isiZulu' }
            };
            const langConfig = languageMapping[code] || { name: language.name, nativeName: language.name };
            // Translate in batches
            const batchSize = 20;
            let translated = 0;
            let fixed = 0;
            let failed = 0;
            for (let i = 0; i < keysToTranslate.length; i += batchSize) {
                const batch = keysToTranslate.slice(i, i + batchSize);
                // Create translation prompt with protected terms
                const keysText = batch.map((k: any) => `${k.key}: ${k.defaultValue}`).join('\n');
                const prompt = `Translate these UI texts to ${langConfig.name} (${langConfig.nativeName}).

PROTECTED TERMS - DO NOT TRANSLATE, keep exactly as shown:
- Brand name: "Mega Radio" (keep as "Mega Radio")
- All placeholders in {curly braces}: {STATION_NAME}, {country}, {genre}, {language}, {city}, {count}, etc.

TRANSLATION RULES:
1. Translate ALL other text to native ${langConfig.name} - NO English words allowed
2. Keep placeholders exactly as they appear: {country} stays {country}, {STATION_NAME} stays {STATION_NAME}
3. Use natural, fluent ${langConfig.name} that native speakers would use
4. For UI terms like "Settings", "Search", "Loading" - use the standard ${langConfig.name} equivalent
5. Return format: key: translated_text

Keys to translate:
${keysText}`;
                writer.assertOwned();
                let parsed = new Map<string, string>();
                try {
                    const openAIModule = await import('openai');
                    // Bound provider latency so a disconnected admin request cannot retain the global sync lock for minutes.
                    const openai = new openAIModule.default({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 0 });
                    const response = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [
                            { role: 'system', content: `You are an expert ${langConfig.name} translator. Preserve Mega Radio and every placeholder exactly.` },
                            { role: 'user', content: prompt },
                        ],
                        temperature: 0.2,
                        max_tokens: 4000,
                    });
                    writer.assertOwned();
                    const content = response.choices[0]?.message?.content;
                    if (!content?.trim()) throw new Error('Translation provider returned an empty response');
                    for (const line of content.split('\n')) {
                        const colon = line.indexOf(':');
                        if (colon > 0) parsed.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim().replace(/^["']|["']$/g, ''));
                    }
                } catch (error) {
                    writer.assertOwned();
                    logger.error('Translation provider batch failed:', error);
                    failed += batch.length;
                    continue;
                }
                const pending: import('../data/postgres-translation-sync-store').GeneratedTranslation[] = [];
                for (const key of batch) {
                    const value = parsed.get(key.key);
                    const placeholders = (text: string) => (text.match(/\{[^{}]+\}/g) || []).sort();
                    if (!value?.trim() || JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(key.defaultValue))) {
                        failed++;
                        continue;
                    }
                    if (!key.isNew && key.existingValue?.trim() === value.trim()) {
                        // The provider did not correct a value explicitly identified for repair.
                        failed++;
                        continue;
                    }
                    pending.push({ keyId: String(key._id), defaultValue: key.defaultValue, language: code.toLowerCase(), value: value.trim(),
                        observed: existingTranslationsMap.get(String(key._id)), allowCompletedRepair: !missingOnly });
                }
                // Database errors are not provider failures. The batch, CAS checks and version bump are atomic.
                const written = new Set(await writer.saveGeneratedDetailed(pending));
                for (const key of batch) if (written.has(String(key._id))) {
                    if (key.isNew) translated++; else fixed++;
                }
                // Small delay between batches to avoid rate limiting
                if (i + batchSize < keysToTranslate.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            // Clear translation caches
            if (translated > 0 || fixed > 0) {
                await CacheManager.clearByPattern(`sitemap_translations:${code}`);
                await CacheManager.clearByPattern(`translations:${code}`);
                logger.log(`✅ ${language.name}: Translated ${translated} new, fixed ${fixed} incorrect`);
            }
            writer.assertOwned();
            return { status: 200, body: {
                message: `Translation complete for ${language.name}`,
                stats: {
                    total: allKeys.length,
                    existing: existingTranslations.length,
                    translated,
                    fixed,
                    failed,
                    keysFixed: keysToFix,
                    remaining: deferredKeys + failed
                }
            } };
            });
            // A completed response must not race the asynchronous leader unlock.
            res.status(reply.status).json(reply.body);
        }
        catch (error: any) {
            console.error('Error auto-translating language:', error);
            res.status(error?.status === 409 ? 409 : 500).json({ error: error?.status === 409 ? error.message : 'Failed to auto-translate language' });
        }
        finally {
            // Always release the per-language lock so a future job can run, even
            // when the pipeline threw mid-batch.
            if (lockKey) {
                inFlightTranslateJobs.delete(lockKey);
            }
        }
    });
    // ADMIN REAL LANGUAGES API - Manage real languages from station database (Admin Only)
    app.get("/api/admin/real-languages", requireAdmin, async (req, res) => {
        try {
            // Language grouping map to consolidate variants
            const languageGroups = {
                'Turkish': ['turkish', 'türkiye', 'turk', 'türkçe', 'turkey'],
                'German': ['german', 'deutsch', 'germany', 'deutsche'],
                'English': ['english', 'en', 'eng'],
                'Spanish': ['spanish', 'español', 'espanol', 'spain', 'es'],
                'French': ['french', 'français', 'francais', 'france', 'fr'],
                'Italian': ['italian', 'italiano', 'italy', 'it'],
                'Portuguese': ['portuguese', 'português', 'portugues', 'brazil', 'brasil', 'pt'],
                'Russian': ['russian', 'русский', 'russia', 'ru'],
                'Chinese': ['chinese', 'china', 'zh', '中文'],
                'Japanese': ['japanese', 'japan', 'ja', '日本語'],
                'Korean': ['korean', 'korea', 'ko', '한국어'],
                'Arabic': ['arabic', 'عربي', 'ar'],
                'Dutch': ['dutch', 'nederlands', 'netherlands', 'nl'],
                'Polish': ['polish', 'polski', 'poland', 'pl'],
                'Swedish': ['swedish', 'svenska', 'sweden', 'se'],
                'Norwegian': ['norwegian', 'norsk', 'norway', 'no'],
                'Danish': ['danish', 'dansk', 'denmark', 'dk'],
                'Finnish': ['finnish', 'suomi', 'finland', 'fi'],
                'Greek': ['greek', 'ελληνικά', 'greece', 'gr'],
                'Czech': ['czech', 'čeština', 'czechia', 'cz'],
                'Hungarian': ['hungarian', 'magyar', 'hungary', 'hu'],
                'Romanian': ['romanian', 'română', 'romania', 'ro'],
                'Bulgarian': ['bulgarian', 'български', 'bulgaria', 'bg'],
                'Croatian': ['croatian', 'hrvatski', 'croatia', 'hr'],
                'Serbian': ['serbian', 'srpski', 'serbia', 'rs'],
                'Ukrainian': ['ukrainian', 'українська', 'ukraine', 'ua'],
                'Slovenian': ['slovenian', 'slovenščina', 'slovenia', 'si'],
                'Slovak': ['slovak', 'slovenčina', 'slovakia', 'sk'],
                'Lithuanian': ['lithuanian', 'lietuvių', 'lithuania', 'lt'],
                'Latvian': ['latvian', 'latviešu', 'latvia', 'lv'],
                'Estonian': ['estonian', 'eesti', 'estonia', 'ee']
            };
            // Get all unique languages from stations
            const rawLanguages = (await pgStationFacetCounts('language')).map(row => ({ language: row._id, stationCount: row.count }));
            // Group languages by their main language
            const groupedLanguages: Record<string, any> = {};
            const ungroupedLanguages: any[] = [];
            rawLanguages.forEach(langData => {
                const langName = langData.language.toLowerCase().trim();
                let grouped = false;
                // Check if this language belongs to any group
                for (const [mainLang, variants] of Object.entries(languageGroups)) {
                    if (variants.some(variant => langName.includes(variant) || variant.includes(langName))) {
                        if (!groupedLanguages[mainLang]) {
                            groupedLanguages[mainLang] = {
                                mainLanguage: mainLang,
                                variants: [],
                                totalStations: 0
                            };
                        }
                        groupedLanguages[mainLang].variants.push({
                            originalName: langData.language,
                            stationCount: langData.stationCount
                        });
                        groupedLanguages[mainLang].totalStations += langData.stationCount;
                        grouped = true;
                        break;
                    }
                }
                // If not grouped, add to ungrouped
                if (!grouped) {
                    ungroupedLanguages.push({
                        language: langData.language,
                        stationCount: langData.stationCount
                    });
                }
            });
            // Convert grouped languages to array and sort by station count
            const finalLanguages = (Object.values(groupedLanguages) as any[])
                .sort((a: any, b: any) => b.totalStations - a.totalStations)
                .map((group: any) => ({
                ...group,
                variants: group.variants.sort((a: any, b: any) => b.stationCount - a.stationCount)
            }));
            // Add ungrouped languages at the end, sorted by station count
            const sortedUngrouped = ungroupedLanguages
                .sort((a, b) => b.stationCount - a.stationCount)
                .map(lang => ({
                mainLanguage: lang.language,
                variants: [{ originalName: lang.language, stationCount: lang.stationCount }],
                totalStations: lang.stationCount
            }));
            const allLanguages = [...finalLanguages, ...sortedUngrouped];
            res.json({
                languages: allLanguages,
                total: allLanguages.length,
                totalStations: allLanguages.reduce((sum, lang) => sum + lang.totalStations, 0)
            });
        }
        catch (error) {
            console.error('Error fetching real languages:', error);
            res.status(500).json({ error: 'Failed to fetch real languages' });
        }
    });
    app.post("/api/admin/stations/merge-preview", requireAdmin, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const selection = parseManualStationMerge(req.body);
            const documents = await pgCatalog().find({ _id: { $in: [selection.primaryStationId, ...selection.duplicateStationIds] } });
            res.json({ success: true, preview: buildManualStationMergePreview(selection, documents) });
        } catch (error) { manualMergeError(res, error); }
    });
    // Manual override stays available, but only for the explicitly reviewed snapshot.
    app.post("/api/admin/stations/merge", requireAdmin, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const selection = parseManualStationMerge(req.body, true);
            const result = await pgCatalog().mergeDuplicates([selection.primaryStationId, ...selection.duplicateStationIds], {
                primaryId: selection.primaryStationId, validateGroup: false, patch: selection.changes, manualReview: selection.review,
            });
            const cacheInvalidated = await invalidateManualMergeCaches(result).catch(() => false);
            res.json({ success: true, deletedCount: result.deletedCount, mergedStation: result.primary, cacheInvalidated });
        }
        catch (error) { manualMergeError(res, error); }
    });
    // ADMIN GENRES API - Returns only real genres from database for management (Admin Only)
    app.get("/api/admin/genres", requireAdmin, async (req, res) => {
        try {
            logger.log('🎵 Fetching ONLY real genres from database for admin management...');
            // Extract query parameters
            const page = Math.max(1, parseInt(req.query.page as string) || 1);
            const limit = Math.max(1, Math.min(500, parseInt(req.query.limit as string) || 50));
            const search = (req.query.search as string)?.trim() || '';
            const sortBy = (req.query.sortBy as string) || 'stationCount';
            // Task #133: filter to only genres auto-demoted by the slug-cleanup
            // migration so admins can review what went dark and decide whether to
            // merge stations, rename one duplicate, or delete the row.
            const demotedOnly = req.query.demoted === '1' || req.query.demoted === 'true';
            const discoverableOnly = req.query.discoverable === '1' || req.query.discoverable === 'true';
            // Count and page the native genre records.
            const initialGenres = await pgListAdminGenres(search, demotedOnly, sortBy, limit, (page - 1) * limit, discoverableOnly);
            const total = initialGenres.total;
            // Get paginated genres from database (not dynamic ones generated from stations)
            const realGenres = initialGenres.rows;
            logger.log(`📊 Found ${realGenres.length} genres (page ${page}/${Math.ceil(total / limit)}, search: "${search}")`);
            // Listing must stay read-only, including an empty catalogue.
            // Explicit sync/population actions remain available to admins.
            // Return in the format expected by the frontend
            res.json({
                data: realGenres,
                total,
                currentPage: page,
                totalPages: Math.ceil(total / limit)
            });
        }
        catch (error) {
            console.error('Error fetching admin genres:', error);
            res.status(500).json({ error: 'Failed to fetch admin genres' });
        }
    });
    // ADMIN MERGE-PREVIEW API (Task #288) - Read-only preview of which stations
    // a `merge-into-winner` call would re-tag. Mirrors the matching rules used
    // by the POST endpoint so admins see exactly the set of stations about to
    // move before they pull the trigger. The matching set depends only on the
    // demoted genre's name (not the chosen target), so `targetGenreId` is not
    // required — but if supplied we surface basic guard errors (self-merge,
    // missing target) so the dialog can warn before the admin clicks Merge.
    app.get("/api/admin/genres/:id/merge-preview", requireAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const rawTarget = req.query.targetGenreId;
            const targetGenreId = typeof rawTarget === 'string' && rawTarget.trim().length > 0
                ? rawTarget.trim()
                : undefined;
            const rawLimit = Number.parseInt(String(req.query.limit ?? '50'), 10);
            const sampleLimit = Number.isFinite(rawLimit) && rawLimit > 0
                ? Math.min(rawLimit, 200)
                : 50;
            const demoted = await pgStoredGenreById(String(id));
            if (!demoted) {
                return void res.status(404).json({ error: 'Demoted genre not found' });
            }
            if (!demoted.cleanupDemotion) {
                return void res.status(400).json({
                    error: 'Genre is not a slug-cleanup demoted row',
                });
            }
            const demotedName = String(demoted.name || '').trim();
            if (!demotedName) {
                return void res.status(409).json({
                    error: 'Demoted genre is missing a usable name; cannot preview merge',
                });
            }
            let winnerName: string | undefined;
            let winnerSlug: string | undefined;
            if (targetGenreId) {
                if (String(targetGenreId) === String(demoted._id)) {
                    return void res.status(400).json({
                        error: 'Cannot merge a demoted genre into itself',
                    });
                }
                const winner = await pgStoredGenreById(targetGenreId);
                if (!winner) {
                    return void res.status(409).json({
                        error: 'Picked target genre no longer exists',
                    });
                }
                winnerName = String(winner.name || '').trim() || undefined;
                winnerSlug = String(winner.slug || '').trim() || undefined;
            }
            const escapeForRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedDemoted = escapeForRegex(demotedName);
            const matchFilter = {
                $or: [
                    { tags: { $regex: new RegExp(`(^|,)\\s*${escapedDemoted}\\s*(,|$)`, 'i') } },
                    { genre: { $regex: new RegExp(`^\\s*${escapedDemoted}\\s*$`, 'i') } },
                ],
            };
            const [stationsMatched, sampleStations] = await Promise.all([
                pgCatalog().count(matchFilter),
                pgCatalog().find(matchFilter, { sort: { name: 1 }, limit: sampleLimit, fields: ['name', 'slug', 'genre', 'tags', 'country'] }),
            ]);
            return void res.json({
                demotedGenreId: String(demoted._id),
                demotedGenreName: demotedName,
                demotedGenreSlug: demoted.slug,
                targetGenreId: targetGenreId ?? null,
                targetGenreName: winnerName ?? null,
                targetGenreSlug: winnerSlug ?? null,
                stationsMatched,
                sampleLimit,
                sampleStations: sampleStations.map((st) => ({
                    _id: String(st._id),
                    name: st.name,
                    slug: st.slug,
                    genre: st.genre ?? null,
                    tags: st.tags ?? null,
                    country: st.country ?? null,
                })),
            });
        }
        catch (error) {
            logger.error('Error building merge preview:', error);
            res.status(500).json({ error: 'Failed to build merge preview' });
        }
    });
    // ADMIN MERGE-INTO-WINNER API (Task #166) - Re-tag the stations attached to
    // a demoted genre onto its recorded `cleanupDemotion.collisionWinnerId`,
    // then delete the demoted row. Closes the loop on the slug-cleanup
    // migration which intentionally avoids auto-merging stations.
    //
    // Task #214: also accepts an optional `targetGenreId` body param. When
    // provided, the admin-picked target genre overrides the recorded
    // collision winner — and the action becomes available for empty-slug
    // demotions and any older demoted rows missing a `collisionWinnerId`.
    app.post("/api/admin/genres/:id/merge-into-winner", requireAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const rawTarget = (req.body as {
                targetGenreId?: unknown;
            } | undefined)
                ?.targetGenreId;
            const targetGenreId = typeof rawTarget === 'string' && rawTarget.trim().length > 0
                ? rawTarget.trim()
                : undefined;
            const actor = req.user as any;
            const merged = await pgMergeDemotedGenre(String(id), targetGenreId, { userId: actor?._id ? String(actor._id) : actor?.id ? String(actor.id) : null, email: actor?.email || null });
            for (const slug of merged.changedSlugs)
                performanceCache.invalidateStationCache(slug);
            try {
                await pgPruneGenreMergeAudit();
            }
            catch (error) {
                logger.error('Failed to prune genre-merge audit log:', error);
            }
            // Same downstream re-warm the cleanup script uses (Task #133): drop the
            // precomputed-genres caches and force-rebuild the sitemap manifests so
            // the public surfaces stop linking to the demoted slug immediately.
            try {
                const { PrecomputedGenresService } = await import('../services/precomputed-genres');
                await PrecomputedGenresService.refreshAll();
            }
            catch (err) {
                logger.error('Failed to refresh precomputed-genres caches after merge:', err);
            }
            try {
                const { buildAllSitemapManifests } = await import('../seo/sitemap-manifest-builder');
                await buildAllSitemapManifests({ force: true });
            }
            catch (err) {
                logger.error('Failed to rebuild sitemap manifests after merge:', err);
            }
            const { changedSlugs, ...response } = merged;
            return void res.json(response);
        }
        catch (error: any) {
            console.error('Error merging demoted genre into winner:', error);
            res.status(error?.statusCode || 500).json({ error: error?.statusCode ? error.message : 'Failed to merge demoted genre into winner' });
        }
    });
    // ADMIN GENRE MERGE AUDIT LOG (Task #289) — paginated, filterable list
    // of every successful merge so admins can answer "who merged what into
    // where, and when" without grepping the api-server logs. The collection
    // is bounded by both the schema TTL (180 days) and an on-write soft cap
    // in the merge handler above, so this endpoint stays fast.
    app.get("/api/admin/genres/merge-audit-log", requireAdmin, async (req, res) => {
        try {
            const parseIntParam = (raw: unknown, fallback: number, max?: number) => {
                const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
                if (!Number.isFinite(n) || n < 0)
                    return fallback;
                return max !== undefined ? Math.min(n, max) : n;
            };
            const limit = Math.max(1, parseIntParam(req.query.limit, 50, 200));
            const offset = parseIntParam(req.query.offset, 0);
            const escapeForRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const filter: Record<string, unknown> = {};
            const targetSourceParam = typeof req.query.targetSource === 'string'
                ? req.query.targetSource
                : undefined;
            if (targetSourceParam && targetSourceParam !== 'all') {
                if (targetSourceParam !== 'manual' &&
                    targetSourceParam !== 'auto-recorded') {
                    return void res
                        .status(400)
                        .json({ error: 'Invalid targetSource filter' });
                }
                filter.targetSource = targetSourceParam;
            }
            const actorEmail = typeof req.query.actorEmail === 'string'
                ? req.query.actorEmail.trim()
                : '';
            if (actorEmail) {
                filter.actorEmail = {
                    $regex: escapeForRegex(actorEmail),
                    $options: 'i',
                };
            }
            const genre = typeof req.query.genre === 'string' ? req.query.genre.trim() : '';
            if (genre) {
                const re = { $regex: escapeForRegex(genre), $options: 'i' };
                filter.$or = [
                    { demotedGenreName: re },
                    { demotedGenreSlug: re },
                    { winnerGenreName: re },
                    { winnerGenreSlug: re },
                ];
            }
            const fromRaw = typeof req.query.from === 'string' ? req.query.from : '';
            const toRaw = typeof req.query.to === 'string' ? req.query.to : '';
            const createdAt: Record<string, Date> = {};
            const fromDate = fromRaw ? new Date(fromRaw) : null;
            if (fromDate && !isNaN(fromDate.getTime())) {
                createdAt.$gte = fromDate;
            }
            const toDate = toRaw ? new Date(toRaw) : null;
            if (toDate && !isNaN(toDate.getTime())) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
                    toDate.setUTCHours(23, 59, 59, 999);
                }
                createdAt.$lte = toDate;
            }
            if (Object.keys(createdAt).length > 0) {
                filter.createdAt = createdAt;
            }
            const { entries, total } = await pgGenreMergeAuditList({
                targetSource: targetSourceParam, actorEmail, genre,
                from: fromDate && !isNaN(fromDate.getTime()) ? fromDate : undefined,
                to: toDate && !isNaN(toDate.getTime()) ? toDate : undefined,
            }, limit, offset);
            res.json({
                entries: entries.map((e) => ({
                    id: String(e._id),
                    demotedGenreId: e.demotedGenreId,
                    demotedGenreName: e.demotedGenreName,
                    demotedGenreSlug: e.demotedGenreSlug,
                    winnerGenreId: e.winnerGenreId,
                    winnerGenreName: e.winnerGenreName,
                    winnerGenreSlug: e.winnerGenreSlug,
                    targetSource: e.targetSource,
                    stationsMatched: e.stationsMatched,
                    stationsRetagged: e.stationsRetagged,
                    actorUserId: e.actorUserId,
                    actorEmail: e.actorEmail,
                    createdAt: e.createdAt,
                })),
                total,
                limit,
                offset,
            });
            return;
        }
        catch (error) {
            console.error('Error listing genre-merge audit log:', error);
            res
                .status(500)
                .json({ error: 'Failed to list genre-merge audit log' });
            return;
        }
    });
    // ADMIN GENRE POPULATION API - Manually trigger genre population from station tags
    app.post("/api/admin/populate-genres", requireAdmin, async (req, res) => {
        try {
            logger.log('🎵 Manually triggering genre population from station tags...');
            const result = await populateGenresFromStations();
            res.json({
                success: true,
                message: `Successfully populated ${result.genresCreated} genres from station data`,
                genresCreated: result.genresCreated,
                tagsProcessed: result.tagsProcessed
            });
        }
        catch (error) {
            console.error('Error manually populating genres:', error);
            res.status(500).json({ error: 'Failed to populate genres' });
        }
    });
    // Helper function to populate genres from station tags
    async function populateGenresFromStations() {
        try {
            logger.log('🎵 Starting genre population from station tags...');
            const tagCounts = await pgGenrePopulationCounts();
            logger.log(`📈 Found ${tagCounts.length} unique tags`);
            // Create genres for tags with at least 1 station
            // Task #110: skip empty/malformed slugs (would otherwise leak the
            // XML-unsafe legacy values that #102 + #110 just cleaned up).
            // Task #161: route this through the shared `normalizeGenreSlug`
            // helper so every Genre.slug write site uses the same definition
            // of "safe" — duplicating the regex inline meant a future tweak to
            // SAFE_GENRE_SLUG_RE could silently drift away from this admin
            // path and reintroduce malformed slugs.
            let genresCreated = 0;
            let genresSkipped = 0;
            for (const {tag, count} of tagCounts) {
                if (count >= 1) {
                    const slug = normalizeGenreSlug(tag);
                    if (!slug || !SAFE_GENRE_SLUG_RE.test(slug)) {
                        genresSkipped++;
                        continue;
                    }
                    const genreData = {
                        name: tag.charAt(0).toUpperCase() + tag.slice(1), // Capitalize first letter
                        slug,
                        stationCount: count,
                        isDiscoverable: count >= 2, // Make discoverable if 2+ stations
                        createdAt: new Date(),
                        updatedAt: new Date()
                    };
                    // Insert genre (update if exists)
                    await pgUpsertPopulatedGenre(genreData);
                    genresCreated++;
                }
            }
            if (genresSkipped > 0) {
                logger.log(`⏭️ Skipped ${genresSkipped} tags with unsafe/empty slugs`);
            }
            logger.log(`✅ Successfully populated ${genresCreated} genres!`);
            return {
                genresCreated,
                tagsProcessed: tagCounts.length
            };
        }
        catch (error) {
            console.error('❌ Error populating genres:', error);
            throw error;
        }
    }
    // LOCATION API - IP-based geolocation detection
    // 🚀 OPTIMIZED: Uses Cloudflare headers for instant detection (0ms vs 300-800ms)
    app.get("/api/location", async (req, res) => {
        // CRITICAL: Prevent Cloudflare from caching location responses (user-specific data)
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, private',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Vary': 'CF-Connecting-IP, X-Forwarded-For'
        });
        try {
            // Get the client's IP address
            let rawIP = req.headers['cf-connecting-ip'] ||
                req.headers['x-forwarded-for'] ||
                req.headers['x-real-ip'] ||
                req.connection.remoteAddress ||
                req.socket.remoteAddress ||
                (req.connection as any)?.socket?.remoteAddress ||
                req.ip;
            // Parse the IP address - extract the first valid public IP from comma-separated list
            let clientIP = rawIP;
            if (typeof rawIP === 'string' && rawIP.includes(',')) {
                const ips = rawIP.split(',').map(ip => ip.trim());
                const publicIP = ips.find(ip => {
                    const isNotLocalhost = !ip.includes('127.0.0.1') && !ip.includes('::1') && ip !== '::ffff:127.0.0.1';
                    const isNotPrivate = !ip.includes('192.168.') && !ip.includes('10.0.') && !ip.includes('10.81.');
                    const isNotIPv6Local = !ip.includes('::ffff:') && !ip.includes('::1');
                    const hasValidFormat = ip.length > 0 && /^\d+\.\d+\.\d+\.\d+$/.test(ip);
                    return isNotLocalhost && isNotPrivate && isNotIPv6Local && hasValidFormat;
                });
                clientIP = publicIP || ips[0];
            }
            let locationData = {
                country: 'all',
                countryCode: 'all',
                city: null as string | null,
                region: null as string | null,
                lat: null as number | null,
                lng: null as number | null,
                detected: false
            };
            // 🚀 PRIORITY 1: Cloudflare headers (INSTANT - 0ms)
            const cfCountryCode = req.headers['cf-ipcountry'] as string;
            const isCloudflareRequest = !!req.headers['cf-ray']; // CF-Ray header indicates Cloudflare
            if (cfCountryCode && cfCountryCode !== 'XX' && cfCountryCode !== 'T1') {
                // Convert 2-letter code to full country name using existing mapping
                const countryName = CODE_TO_COUNTRY[cfCountryCode.toLowerCase()];
                if (countryName) {
                    locationData = {
                        country: countryName,
                        countryCode: cfCountryCode.toUpperCase(),
                        city: null,
                        region: null,
                        lat: null,
                        lng: null,
                        detected: true
                    };
                    return void res.json({
                        location: locationData,
                        ip: rawIP,
                        source: 'cloudflare'
                    });
                }
            }
            // 🔄 FALLBACK: ip-api.com for any environment when Cloudflare detection fails
            const ipStr = typeof clientIP === 'string' ? clientIP : '';
            const isLocalhost = !ipStr ||
                ipStr === '127.0.0.1' ||
                ipStr === '::1' ||
                ipStr.includes('192.168.') ||
                ipStr.includes('10.0.') ||
                ipStr.includes('10.81.') ||
                ipStr === '::ffff:127.0.0.1';
            const cleanIP = ipStr.includes(',') ? ipStr.split(',')[0].trim() : ipStr;
            if (!isLocalhost) {
                try {
                    const fetch = (await import('node-fetch')).default;
                    const response = await Promise.race([
                        fetch(`http://ip-api.com/json/${cleanIP}?fields=status,message,country,countryCode,region,city,lat,lon`),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 2000))
                    ]) as any;
                    const data = await response.json() as any;
                    if (data && data.status === 'success') {
                        locationData = {
                            country: data.country,
                            countryCode: data.countryCode,
                            city: data.city,
                            region: data.region,
                            lat: data.lat,
                            lng: data.lon,
                            detected: true
                        };
                    }
                }
                catch (geoError: any) {
                }
            }
            res.json({
                location: locationData,
                ip: rawIP,
                source: isLocalhost ? 'localhost' : 'ip-api'
            });
        }
        catch (error) {
            res.json({
                location: {
                    country: 'all',
                    countryCode: 'all',
                    city: null,
                    region: null,
                    lat: null,
                    lng: null,
                    detected: false
                },
                ip: null,
                source: 'fallback'
            });
        }
    });
    // Cached native facets use the bounded public-query budget.
    app.get("/api/filters/countries", async (req, res) => {
        try {
            const cacheKey = 'filters:countries:v1';
            const cached = await publicStationCache.get(cacheKey);
            if (cached) {
                res.set('Cache-Control', 'public, max-age=0, s-maxage=0, must-revalidate');
                return void res.json(cached);
            }
            const countries = (await pgStationFacetCounts('country')).map(row => row._id);
            const filteredCountries = (countries as string[])
                .filter((country: string) => country && country.trim() !== '')
                .sort();
            await publicStationCache.set(cacheKey, filteredCountries, { ttl: 60 });
            res.set('Cache-Control', 'public, max-age=0, s-maxage=0, must-revalidate');
            res.json(filteredCountries);
        }
        catch (error: any) {
            logger.warn('[filters/countries] failed: ' + (error?.message || 'unknown'));
            res.set('Cache-Control', 'no-store');
            res.status(503).json({error:'Country filters are temporarily unavailable'});
        }
    });
    // FILTERS LANGUAGES API
    // INCIDENT 2026-05-14: same pattern as /api/filters/countries — heavy
    // aggregate hit on every page load with no cache. Add 24h cache + bounded
    // execution + soft fallback.
    app.get("/api/filters/languages", async (req, res) => {
        const cacheKey = 'filters:languages:v1';
        try {
            // INCIDENT 2026-05-15 v10 — wrap the heavy distinct-language
            // aggregate in single-flight so concurrent cold misses (homepage
            // SSR fanout) coalesce to one PostgreSQL query.
            // INCIDENT 2026-05-15 v10.2 — upgraded singleflight → SWR
            // (24h fresh / 7d stale) so a stressed cluster mid-refresh
            // keeps serving the prior language list instead of falling
            // through to the empty-array soft-fail.
            const cleanLanguages = await publicStationCache.getOrSetSWR<string[]>(cacheKey, async () => {
                // Get aggregated language data with counts
                const languageStats = (await pgStationFacetCounts('language')).filter(row => row.count >= 3);
                // Clean up the language names - remove malformed data
                const cleanLanguages = languageStats
                    .map(item => item._id)
                    .filter(lang => lang && lang.trim())
                    .map(lang => {
                    // Clean up common issues
                    lang = lang.trim();
                    if (lang.startsWith('"') && lang.endsWith('"')) {
                        lang = lang.slice(1, -1);
                    }
                    if (lang.startsWith('#')) {
                        lang = lang.substring(1);
                    }
                    // Split multi-language entries and take first clean one
                    if (lang.includes(',')) {
                        lang = lang.split(',')[0].trim().replace('#', '');
                    }
                    return lang;
                })
                    .filter(lang => lang && lang.length > 1 && lang.length < 30) // Remove very short or long entries
                    .filter(lang => !lang.match(/^[^a-zA-Z]/) && !lang.includes('#')) // Remove entries starting with special chars or containing #
                    .filter((lang, index, arr) => arr.indexOf(lang) === index) // Remove duplicates
                    .slice(0, 50) // Limit results
                    .sort();
                return cleanLanguages;
            }, { freshTtl: 86400, staleTtl: 86400 * 7 });
            res.set('Cache-Control', 'public, max-age=0, s-maxage=0, must-revalidate');
            res.json(cleanLanguages);
        }
        catch (error: any) {
            logger.warn(`[filters/languages] failed: code=${error?.code || 'unknown'} codeName=${error?.codeName || 'unknown'} msg=${error?.message || 'unknown'}`);
            // INCIDENT 2026-05-15 v10.2 — read SWR envelope on fallback path.
            let stale: any = null;
            try {
                stale = await publicStationCache.getSWR(cacheKey);
            }
            catch { }
            res.set('Cache-Control', 'no-store');
            if (Array.isArray(stale)) return void res.json(stale);
            res.status(503).json({error:'Language filters are temporarily unavailable'});
        }
    });
    // FILTERS GENRES API
    // INCIDENT 2026-05-14: same pattern — `Station.distinct('tags')` is a full
    // collection scan with no cache. Add 24h cache + bounded execution.
    app.get("/api/filters/genres", async (req, res) => {
        try {
            const cacheKey = 'filters:genres:v1';
            const cached = await publicStationCache.get(cacheKey);
            if (cached) {
                res.set('Cache-Control', 'public, max-age=0, s-maxage=0, must-revalidate');
                return void res.json(cached);
            }
            // Get all distinct tags from stations
            const allTags = (await pgStationFacetCounts('tags')).map(row => row._id);
            // Extract unique genre values from tags (tags are comma-separated)
            const genreSet = new Set();
            (allTags as string[]).forEach(tagString => {
                if (tagString && typeof tagString === 'string') {
                    // Split comma-separated tags and clean them up
                    const tags = tagString.split(',').map(tag => tag.trim().toLowerCase());
                    tags.forEach(tag => {
                        if (tag && tag.length > 0) {
                            genreSet.add(tag);
                        }
                    });
                }
            });
            // Debug logging to see what we're getting
            logger.log('🔍 Tags debug:', {
                totalTags: allTags.length,
                sampleTags: allTags.slice(0, 5),
                genreCount: genreSet.size,
                sampleGenres: Array.from(genreSet).slice(0, 10)
            });
            // Convert to sorted array
            const genres = Array.from(genreSet).sort();
            await publicStationCache.set('filters:genres:v1', genres, { ttl: 60 });
            res.set('Cache-Control', 'public, max-age=0, s-maxage=0, must-revalidate');
            res.json(genres);
        }
        catch (error: any) {
            logger.warn('[filters/genres] failed: ' + (error?.message || 'unknown'));
            res.set('Cache-Control', 'no-store');
            res.status(503).json({error:'Genre filters are temporarily unavailable'});
        }
    });
    // Get stations by genre (for genre pages)
    app.get("/api/stations/by-genre/:genre", async (req, res) => {
        try {
            const { genre } = req.params;
            const { page = 1, limit = 20, country } = req.query;
            const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
            let query: any = {
                lastCheckOk: true,
                $or: [
                    { genre: new RegExp(genre, 'i') },
                    { tags: new RegExp(genre, 'i') }
                ]
            };
            if (country && country !== 'All') {
                query.country = country;
            }
            const stations = await pgCatalog().find(query, { sort: { votes: -1, clickCount: -1 }, offset: skip, limit: parseInt(limit as string) });
            const total = await pgCatalog().count(query);
            res.json({
                stations,
                total,
                page: parseInt(page as string),
                totalPages: Math.ceil(total / parseInt(limit as string))
            });
        }
        catch (error) {
            // console.error('Error fetching stations by genre:', error);
            res.status(500).json({ error: 'Failed to fetch stations by genre' });
        }
    });
    // Get genre statistics for landing pages
    app.get("/api/genres/:slug/stats", async (req, res) => {
        try {
            const { slug } = req.params;
            // Convert slug back to genre name (replace hyphens with spaces, capitalize)
            const genreName = slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
            // Get top countries for this genre
            const topCountries = await pgGenreLandingCountries(genreName);
            // Get related genres based on stations that share multiple tags
            const relatedGenres = await pgGenreLandingRelated(genreName);
            res.json({
                topCountries,
                relatedGenres
            });
        }
        catch (error) {
            console.error('Error fetching genre stats:', error);
            res.status(500).json({ error: 'Failed to fetch genre statistics' });
        }
    });
    // STATION CLICK TRACKING
    app.post("/api/stations/:id/click", async (req, res) => {
        try {
            const { id } = req.params;
            const found = await incrementStationClick(id);
            if (!found)
                return void res.status(404).json({ error: 'Station not found' });
            // logger.log(` Station ${id} click tracked`);
            res.json({ success: true });
        }
        catch (error) {
            // console.error('Error tracking station click:', error);
            res.status(500).json({ error: 'Failed to track click' });
        }
    });
    // STATION RATING SYSTEM
    // Calculate rating statistics for a station
    app.post("/api/stations/:id/rate", async (req, res) => {
        try {
            const { id: stationId } = req.params;
            const { rating, sessionId } = req.body;
            const userId = await authenticatedUserId(req);
            let comment = req.body.comment;
            if (comment && typeof comment === 'string') {
                comment = comment.replace(/<[^>]*>/g, '').trim().slice(0, 1000);
            }
            // Validate rating
            if (!rating || rating < 1 || rating > 5) {
                return void res.status(400).json({ error: 'Rating must be between 1 and 5 stars' });
            }
            // Get user identifier and IP for duplicate prevention
            const userIdentifier = userId || sessionId;
            const ipAddress = req.ip || req.connection.remoteAddress;
            const userAgent = req.get('User-Agent');
            if (!userIdentifier && !ipAddress) {
                return void res.status(400).json({ error: 'User identification required' });
            }
            // Check if station exists
            const station = await getStationByIdentifier(stationId);
            if (!station) {
                return void res.status(404).json({ error: 'Station not found' });
            }
            const identity = { userId, sessionId: userId ? undefined : sessionId, ipAddress: userId || sessionId ? undefined : ipAddress };
            {
                if (userId)
                    await ensurePostgresUser(userId);
                const pgResult = await pgRateStationIdentity(identity, stationId, Number(rating), comment || '');
                return void res.json(pgResult);
            }
        }
        catch (error) {
            console.error('Error rating station:', error);
            res.status(500).json({ error: 'Failed to rate station' });
        }
    });
    // Get station ratings
    app.get("/api/stations/:id/ratings", async (req, res) => {
        try {
            const { id: stationId } = req.params;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            {
                return void res.json(await pgStationRatingsDetailed(stationId, page, Math.min(limit, 100)));
            }
        }
        catch (error) {
            console.error('Error fetching station ratings:', error);
            res.status(500).json({ error: 'Failed to fetch ratings' });
        }
    });
    registerStationVoteRoutes(app, authenticatedUserId);
    // Get user's rating for a specific station
    app.get("/api/stations/:id/user-rating", async (req, res) => {
        try {
            const { id: stationId } = req.params;
            let { sessionId } = req.query;
            const userId = await authenticatedUserId(req);
            // Gracefully handle missing parameters - return null rating instead of 400
            if (!userId && !sessionId) {
                return void res.json({ rating: null });
            }
            // Ensure userId and sessionId are strings (not arrays from query params)
            if (Array.isArray(sessionId))
                sessionId = sessionId[0];
            {
                const rating = await pgFindStationRating(stationId, {
                    userId,
                    sessionId: userId ? undefined : typeof sessionId === 'string' ? sessionId : undefined,
                });
                return void res.json({ rating });
            }
        }
        catch (error) {
            console.error('Error fetching user rating:', error);
            res.json({ rating: null }); // Graceful fallback instead of 500
        }
    });
    // ENSURE USER PROFILE IS PUBLIC (for testing purposes)
    app.post("/api/test/make-user-public", requireAdmin, async (req, res) => {
        try {
            const { email } = req.body;
            // logger.log(' Making user profile public for testing:', email);
            if (typeof email !== 'string' || !email.includes('@')) return void res.status(400).json({error:'Valid email is required'});
            const existing = await pgFindUserByEmail(email);
            const user = existing ? await pgUpdateUser(existing._id, {isPublicProfile:true, name:email.split('@')[0]}) : null;
            if (!user) {
                return void res.status(404).json({ error: 'User not found' });
            }
            // logger.log(' User profile set to public:', user.email);
            res.json({ message: 'User profile is now public', user: { email: user.email, isPublicProfile: user.isPublicProfile } });
        }
        catch (error) {
            // console.error('Error making user public:', error);
            res.status(500).json({ error: 'Failed to update user profile' });
        }
    });
    // ADD FAVORITES FOR USER (for testing purposes)
    app.post("/api/test/add-favorites", requireAdmin, async (req, res) => {
        try {
            const { email, stationIds } = req.body;
            // logger.log(' Adding favorites for user:', email, 'stations:', stationIds);
            if (typeof email !== 'string' || !email.includes('@') || !Array.isArray(stationIds) || stationIds.length > 1000 || stationIds.some(id => typeof id !== 'string' || !id)) {
                return void res.status(400).json({error:'Valid email and up to 1000 station IDs are required'});
            }
            const user = await pgAdminAddFavorites(email, stationIds);
            await publicStationCache.clearByPattern(`user-favorites:${user._id}:`);
            await refreshCommunityFavoritesCache();
            // logger.log(' Added favorites to user:', user.email, 'total favorites:', user.favoriteStations.length);
            res.json({
                message: 'Favorites added successfully',
                user: {
                    email: user.email,
                    favoriteStations: user.favoriteStations,
                    isPublicProfile: user.isPublicProfile
                }
            });
        }
        catch (error) {
            // console.error('Error adding favorites:', error);
            res.status((error as any)?.statusCode || 500).json({ error: (error as any)?.statusCode === 400 ? (error as Error).message : 'Failed to add favorites' });
        }
    });
    // UPDATE USER NAME (for fixing user profiles)
    app.post("/api/test/update-user-name", requireAdmin, async (req, res) => {
        try {
            const { email, name } = req.body;
            // logger.log(' Updating user name:', email, 'to:', name);
            if (typeof email !== 'string' || !email.includes('@') || typeof name !== 'string' || !name.trim()) return void res.status(400).json({error:'Valid email and name are required'});
            const existing = await pgFindUserByEmail(email);
            const user = existing ? await pgUpdateUser(existing._id, {name,fullName:name}) : null;
            if (!user) {
                return void res.status(404).json({ error: 'User not found' });
            }
            // logger.log(' Updated user name:', user.email, 'name:', user.name);
            res.json({
                message: 'User name updated successfully',
                user: {
                    email: user.email,
                    name: user.name,
                    isPublicProfile: user.isPublicProfile
                }
            });
        }
        catch (error) {
            // console.error('Error updating user name:', error);
            res.status(500).json({ error: 'Failed to update user name' });
        }
    });
    // DEBUG USER STATUS (for testing purposes)
    app.get("/api/test/user-status/:email", requireAdmin, async (req, res) => {
        try {
            const { email } = req.params;
            // logger.log(' Checking user status for:', email);
            const user = await pgFindUserByEmail(email);
            if (user) user.favoriteStations = await pgFavoriteIds(user._id);
            if (!user) {
                // logger.log(' User not found:', email);
                return void res.json({ found: false, message: 'User not found' });
            }
            // logger.log(' User found:', { email: user.email, isPublicProfile: user.isPublicProfile, favoriteStationsCount: user.favoriteStations?.length || 0, name: user.name });
            res.json({
                found: true,
                user: {
                    _id: user._id,
                    email: user.email,
                    name: user.name,
                    isPublicProfile: user.isPublicProfile,
                    favoriteStations: user.favoriteStations,
                    favoriteStationsCount: user.favoriteStations?.length || 0
                }
            });
        }
        catch (error) {
            // console.error('Error checking user status:', error);
            res.status(500).json({ error: 'Failed to check user status' });
        }
    });
    // GET USER PROFILE BY ID OR SLUG
    app.get("/api/user-profile/:idOrSlug", async (req, res) => {
        try {
            const { idOrSlug } = req.params;
            {
                const user = await pgFindUserByIdOrSlug(String(idOrSlug));
                if (!user)
                    return void res.status(404).json({ error: 'User not found' });
                const [followCounts, favoriteCount] = await Promise.all([
                    pgUserFollowCounts(String(user._id)), pgUserFavoriteCount(String(user._id)),
                ]);
                return void res.json({
                    _id: user._id, email: user.email, fullName: user.fullName, name: user.name,
                    isPublicProfile: user.isPublicProfile, favoriteStations: user.favoriteStations || [],
                    favoriteStationsCount: favoriteCount,
                    recentlyPlayedStations: user.recentlyPlayedStations || [], createdAt: user.createdAt,
                    playAtLogin: user.playAtLogin, theme: user.theme, language: user.language,
                    autoplay: user.autoplay, volume: user.volume,
                    followersCount: followCounts.followersCount, followingCount: followCounts.followingCount,
                });
            }
        }
        catch (error) {
            // console.error('Error fetching user profile:', error);
            res.status(500).json({ error: 'Failed to fetch user profile' });
        }
    });
    app.get("/api/community-favorites", async (req, res) => {
        try {
            const { country } = req.query;
            const cacheKey = `community_favorites:${country || 'all'}:all:20`;
            // Try cache first
            const cached = await publicStationCache.get(cacheKey);
            if (cached) {
                return void res.json(cached);
            }
            // If not cached, refresh and return
            await refreshCommunityFavoritesCache(country as string | undefined);
            const data = await publicStationCache.get(cacheKey);
            res.json(data || []);
        }
        catch (error) {
            logger.log('Error fetching community favorites:', error);
            res.status(500).json({ error: 'Failed to fetch community favorites' });
        }
    });
    // GET CURRENT USER'S FAVORITE STATIONS (Authenticated)
    app.get("/api/user/favorites", requireAuth, async (req, res) => {
        try {
            const currentUserId = (req.session as any)?.userId;
            const sortQuery = (req.query.sort as string) || 'newest';
            const page = parseInt(req.query.page as string) || 0;
            const limit = Math.min(parseInt(req.query.limit as string) || 0, 100);
            const fieldsParam = (req.query.fields as string) || '';
            if (!currentUserId) {
                return void res.status(401).json({ error: 'Authentication required' });
            }
            {
                const result = await pgFavoriteStationsForUser(currentUserId, sortQuery, page, limit);
                const stations = stripPlaceholders(result.stations);
                if (page > 0 && limit > 0) {
                    return void res.json({ stations, pagination: {
                            page, limit, total: result.total, totalPages: Math.ceil(result.total / limit),
                        } });
                }
                return void res.json(stations);
            }
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to fetch favorites' });
        }
    });
    // GET RECENTLY PLAYED STATIONS (returns [] silently for anonymous — no console-noise 401)
    app.get("/api/recently-played", async (req, res) => {
        try {
            const currentUserId = await authenticatedUserId(req);
            if (!currentUserId)
                return void res.json([]);
            const cacheKey = `recently-played:${currentUserId}`;
            const cached = await publicStationCache.get(cacheKey);
            if (cached)
                return void res.json(cached);
            {
                const result = stripPlaceholders(await pgRecentlyPlayedStations(currentUserId));
                await publicStationCache.set(cacheKey, result, { ttl: 60 });
                return void res.json(result);
            }
        }
        catch (error) {
            console.error('Error fetching recently played:', error);
            res.status(500).json({ error: 'Failed to fetch recently played' });
        }
    });
    app.post("/api/recently-played", async (req, res) => {
        try {
            const currentUserId = await authenticatedUserId(req);
            if (!currentUserId)
                return void res.status(204).end();
            const { stationId } = req.body;
            if (!stationId) {
                return void res.status(400).json({ error: 'Station ID is required' });
            }
            {
                await ensurePostgresUser(currentUserId);
                const updated = await pgAddRecentlyPlayed(currentUserId, String(stationId));
                if (!updated)
                    return void res.status(404).json({ error: 'Station or user not found' });
                await publicStationCache.clearByPattern(`recently-played:${currentUserId}`);
                return void res.json({ success: true });
            }
        }
        catch (error: any) {
            handleQuotaError('recently-played', error);
            if (isQuotaError(error)) {
                return void res.status(503).json({ error: 'Database temporarily unavailable' });
            }
            res.status(500).json({ error: 'Failed to add to recently played' });
        }
    });
    // ADD STATION TO CURRENT USER'S FAVORITES (Authenticated)
    app.post("/api/user/favorites", requireAuth, async (req, res) => {
        try {
            const currentUserId = (req.session as any)?.userId;
            const { stationId } = req.body;
            if (!currentUserId) {
                return void res.status(401).json({ error: 'Authentication required' });
            }
            if (!stationId) {
                return void res.status(400).json({ error: 'Station ID is required' });
            }
            const station = await getStationByIdentifier(String(stationId));
            if (!station) {
                return void res.status(404).json({ error: 'Station not found' });
            }
            const result = await userEngagementService.addFavorite(currentUserId, String(stationId));
            if (!result.success)
                return void res.status(500).json({ error: result.message });
            await createUserNotification({
                userId: currentUserId,
                type: 'favorite_station',
                title: '🌟 Station Added to Favorites',
                message: `You added "${station.name}" to your favorites`,
                data: {
                    stationId: station._id,
                    stationName: station.name,
                    stationCountry: station.country,
                    stationGenre: station.genre
                },
                read: false,
                createdAt: new Date()
            });
            await publicStationCache.clearByPattern(`user-favorites:${currentUserId}`);
            res.json(result);
        }
        catch (error: any) {
            handleQuotaError('favorites', error);
            if (isQuotaError(error)) {
                return void res.status(503).json({ error: 'Database temporarily unavailable' });
            }
            res.status(500).json({ error: 'Failed to add station to favorites' });
        }
    });
    // REMOVE STATION FROM CURRENT USER'S FAVORITES (Authenticated)
    app.delete("/api/user/favorites/:stationId", requireAuth, async (req, res) => {
        try {
            const currentUserId = (req.session as any)?.userId;
            const { stationId } = req.params;
            if (!currentUserId) {
                return void res.status(401).json({ error: 'Authentication required' });
            }
            // logger.log(`🗑️ Removing station ${stationId} from favorites for user ${currentUserId}`);
            const result = await userEngagementService.removeFavorite(currentUserId, stationId);
            if (!result.success)
                return void res.status(500).json({ error: result.message });
            // Get station info for notification
            const station = await getStationByIdentifier(stationId);
            // Create notification for the user about removing favorite
            if (station) {
                await createUserNotification({
                    userId: currentUserId,
                    type: 'system',
                    title: '💔 Station Removed from Favorites',
                    message: `You removed "${station.name}" from your favorites`,
                    data: {
                        stationId: stationId,
                        stationName: station.name,
                        stationCountry: station.country,
                        stationGenre: station.genre
                    },
                    read: false,
                    createdAt: new Date()
                });
            }
            await publicStationCache.clearByPattern(`user-favorites:${currentUserId}`);
            res.json(result);
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to remove station from favorites' });
        }
    });
    // CHECK IF STATION IS IN CURRENT USER'S FAVORITES (Authenticated)
    app.get("/api/user/favorites/check/:stationId", requireAuth, async (req, res) => {
        try {
            const currentUserId = (req.session as any)?.userId;
            const { stationId } = req.params;
            if (!currentUserId) {
                return void res.status(401).json({ error: 'Authentication required' });
            }
            const isFavorited = await pgIsFavorite(currentUserId, stationId);
            res.json({ isFavorited });
        }
        catch (error) {
            // console.error('Error checking favorite status:', error);
            res.status(500).json({ error: 'Failed to check favorite status' });
        }
    });
    // GET CURRENT USER'S NOTIFICATIONS (Authenticated)
    app.get("/api/user/notifications", async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            let currentUserId = (req.session as any)?.userId || (req.session as any)?.user?.userId;
            if (!currentUserId) {
                const authHeader = req.headers['authorization'];
                const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
                if (bearerToken) {
                    const tokenDoc = await findActiveAuthToken(bearerToken);
                    if (tokenDoc)
                        currentUserId = tokenDoc.userId;
                }
            }
            const page = Math.max(1, Math.min(1000000, parseInt(req.query.page as string) || 1));
            const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 10));
            const skip = (page - 1) * limit;
            if (!currentUserId) {
                return void res.status(401).json({ error: 'Authentication required' });
            }
            const category = req.query.category ?? 'all';
            if (typeof category !== 'string' || !Object.hasOwn(notificationCategories, category))
                return void res.status(400).json({ error: 'Invalid notification category' });
            const cacheKey = `notifications:postgres:${currentUserId}:${page}:${limit}:${category}`;
            const cached = await CacheManager.get(cacheKey);
            if (cached)
                return void res.json(cached);
            {
                const pgResult = await pgListNotifications(currentUserId, page, limit, category as NotificationCategory);
                const result = { ...pgResult, pagination: {
                        ...pgResult.pagination, pages: pgResult.pagination.totalPages,
                    } };
                await CacheManager.set(cacheKey, result, { ttl: 15 });
                return void res.json(result);
            }
        }
        catch (error) {
            // console.error('Error fetching user notifications:', error);
            res.status(500).json({ error: 'Failed to fetch notifications' });
        }
    });
    // MARK NOTIFICATION AS READ (Authenticated)
    app.patch("/api/user/notifications/:id/read", async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            let currentUserId = (req.session as any)?.userId || (req.session as any)?.user?.userId;
            if (!currentUserId) {
                const authHeader = req.headers['authorization'];
                const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
                if (bearerToken) {
                    const tokenDoc = await findActiveAuthToken(bearerToken);
                    if (tokenDoc)
                        currentUserId = tokenDoc.userId;
                }
            }
            const notificationId = req.params.id;
            if (!currentUserId) {
                return void res.status(401).json({ error: 'Authentication required' });
            }
            let notification: any;
            {
                notification = await pgMarkNotificationRead(currentUserId, notificationId);
            }
            if (!notification) {
                return void res.status(404).json({ error: 'Notification not found' });
            }
            await CacheManager.clearByPattern(`notifications:postgres:${currentUserId}:`).catch(() => {});
            // logger.log(`📖 Marked notification ${notificationId} as read for user ${currentUserId}`);
            res.json({ success: true, notification });
        }
        catch (error) {
            // console.error('Error marking notification as read:', error);
            res.status(500).json({ error: 'Failed to mark notification as read' });
        }
    });
    // MARK ALL NOTIFICATIONS AS READ (Authenticated)
    app.patch("/api/user/notifications/read-all", async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            let currentUserId = (req.session as any)?.userId || (req.session as any)?.user?.userId;
            if (!currentUserId) {
                const authHeader = req.headers['authorization'];
                const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
                if (bearerToken) {
                    const tokenDoc = await findActiveAuthToken(bearerToken);
                    if (tokenDoc)
                        currentUserId = tokenDoc.userId;
                }
            }
            if (!currentUserId) {
                return void res.status(401).json({ error: 'Authentication required' });
            }
            let markedCount = 0;
            markedCount = await pgMarkAllNotificationsRead(currentUserId);
            await CacheManager.clearByPattern(`notifications:postgres:${currentUserId}:`).catch(() => {});
            // logger.log(`📖 Marked ${result.modifiedCount} notifications as read for user ${currentUserId}`);
            res.json({ success: true, markedCount });
        }
        catch (error) {
            // console.error('Error marking all notifications as read:', error);
            res.status(500).json({ error: 'Failed to mark all notifications as read' });
        }
    });
    app.delete("/api/user/notifications", requireAuth, async (req,res)=>{
      res.setHeader('Cache-Control','private, no-store');
      const owner=(req.session as any)?.userId||(req.session as any)?.user?.userId;
      if(!owner)return void res.status(401).json({error:'Authentication required'});
      try{const clearedCount=await pgDismissAllNotifications(owner);await CacheManager.clearByPattern(`notifications:postgres:${owner}:`).catch(()=>{});res.json({success:true,clearedCount});}
      catch{res.status(500).json({error:'Failed to clear notifications'});}
    });
    // GET USER PROFILE BY ID (for public profiles)
    app.get("/api/user-profile/:id", async (req, res) => {
        try {
            const { id } = req.params;
            const user: any = await pgFindUserByIdOrSlug(String(id));
            if (!user || !user.isPublicProfile || user.status !== 'active') {
                return void res.status(404).json({ error: 'User not found or profile is private' });
            }
            // Return user profile in expected format
            const profile = {
                _id: user._id,
                ...publicUserIdentity(user),
                isPublicProfile: user.isPublicProfile,
                createdAt: user.createdAt,
                ...await pgUserFollowCounts(String(user._id))
            };
            res.json(profile);
        }
        catch (error) {
            console.error('Error fetching user profile:', error);
            res.status(500).json({ error: 'Failed to fetch user profile' });
        }
    });
    // Admin endpoint to fix specific user with debug info
    app.post("/api/admin/fix-user/:userId", requireAdmin, async (req, res) => {
        try {
            const { userId } = req.params;
            const user: any = await pgFindUserByIdOrSlug(String(userId));
            if (!user) {
                return void res.status(404).json({ error: 'User not found' });
            }
            logger.log('🔧 Fixing user:', user.fullName, 'Email:', user.email);
            logger.log('🔍 User object fields:', {
                fullName: user.fullName,
                username: user.username,
                name: user.name,
                email: user.email
            });
            const updateData: any = {};
            // Set profile as public
            updateData.isPublicProfile = true;
            // Generate slug manually to fix the issue
            const generateSlug = (text: string): string => {
                return text
                    .toLowerCase()
                    .replace(/[^\w\s-]/g, '')
                    .replace(/\s+/g, '') // Remove spaces completely for "sahinyogurtcu" format
                    .replace(/-+/g, '-')
                    .trim()
                    .replace(/^-+|-+$/g, '');
            };
            let slugSource = user.fullName || user.username || user.name || user.email?.split('@')[0] || 'user';
            updateData.slug = generateSlug(slugSource);
            logger.log(`✅ Generated slug from "${slugSource}": ${updateData.slug}`);
            logger.log('🔧 About to update user with data:', updateData);
            let updatedUser: any;
            updatedUser = await pgUpdateUser(String(user._id), updateData);
            logger.log('✅ User updated successfully. Full user object:');
            logger.log('  - _id:', updatedUser?._id);
            logger.log('  - fullName:', updatedUser?.fullName);
            logger.log('  - slug:', updatedUser?.slug);
            logger.log('  - isPublicProfile:', updatedUser?.isPublicProfile);
            // Sync favorites
            await refreshCommunityFavoritesCache();
            res.json({
                success: true,
                message: `Fixed user ${user.fullName || user.email}`,
                newSlug: updateData.slug
            });
        }
        catch (error) {
            console.error('Error fixing user:', error);
            res.status(500).json({ error: 'Failed to fix user' });
        }
    });
    // Admin endpoint to fix user profiles (make public + generate slugs)
    app.post("/api/admin/fix-user-profiles", requireAdmin, async (req, res) => {
        try {
            // Get all users without public profiles or with ID-based slugs
            const users: any[] = await pgUsersNeedingProfileFix();
            let fixedCount = 0;
            for (const user of users) {
                const updateData: any = {};
                // Set profile as public
                if (!user.isPublicProfile) {
                    updateData.isPublicProfile = true;
                }
                if (!user.slug || /^[0-9a-fA-F]{24}$/.test(user.slug)) {
                    updateData.slug = await generateUserSlug(user, user._id);
                }
                if (Object.keys(updateData).length > 0) {
                    await pgUpdateUser(String(user._id), updateData);
                    fixedCount++;
                }
            }
            // Also sync favorites to fix the favorites display issue
            await refreshCommunityFavoritesCache();
            res.json({
                success: true,
                message: `Fixed ${fixedCount} user profiles and synced favorites`,
                totalUsers: users.length
            });
        }
        catch (error) {
            console.error('Error fixing user profiles:', error);
            res.status(500).json({ error: 'Failed to fix user profiles' });
        }
    });
    // GET USER'S FAVORITE STATIONS BY ID OR SLUG (for public profiles)
    app.get("/api/users/:idOrSlug/favorites", async (req, res) => {
        try {
            const { idOrSlug } = req.params;
            const page = parseInt(req.query.page as string) || 0;
            const limit = Math.min(parseInt(req.query.limit as string) || 0, 100);
            const fieldsParam = (req.query.fields as string) || '';
            const user = await pgFindUserByIdOrSlug(idOrSlug);
            const viewerId = await authenticatedUserId(req);
            if (!user || (!user.isPublicProfile && viewerId !== user._id)) {
                return void res.status(404).json({error:'User not found or profile is private'});
            }
            const userId = String(user._id);
            const usePagination = page > 0 && limit > 0;
            const cacheKey = `user-favorites:${userId}:p${page}:l${limit}:f${fieldsParam}`;
            const cached = await publicStationCache.get(cacheKey);
            if (cached) {
                return void res.json(cached);
            }
            const defaultMobileFields: Record<string, string> = {
                _id: '$station._id',
                name: '$station.name',
                favicon: '$station.favicon',
                country: '$station.country',
                slug: '$station.slug',
                url: '$station.url',
                genre: '$station.genre',
                tags: '$station.tags',
                votes: '$station.votes',
                codec: '$station.codec',
                bitrate: '$station.bitrate',
                language: '$station.language',
                iso_3166_1: '$station.iso_3166_1',
                urlResolved: '$station.urlResolved',
                lastcheckok: '$station.lastcheckok',
                lastCheckOk: '$station.lastCheckOk',
                clickCount: '$station.clickCount',
                favoritedAt: '$createdAt'
            };
            let projectStage: Record<string, any>;
            if (fieldsParam) {
                const requested = fieldsParam.split(',').map(f => f.trim());
                projectStage = { _id: '$station._id', favoritedAt: '$createdAt' };
                for (const field of requested) {
                    if (defaultMobileFields[field]) {
                        projectStage[field] = defaultMobileFields[field];
                    }
                }
            }
            else {
                projectStage = defaultMobileFields;
            }
            const favoritePage = await pgFavoriteStationsForUser(userId, 'newest', page, limit);
            const stations = favoritePage.stations.map(station => Object.fromEntries(
                Object.keys(projectStage).filter(field => station[field] !== undefined).map(field => [field,station[field]])
            ));
            const totalCount = favoritePage.total;
            let result: any;
            if (usePagination) {
                result = {
                    stations,
                    pagination: {
                        page,
                        limit,
                        total: totalCount,
                        totalPages: Math.ceil(totalCount / limit)
                    }
                };
            }
            else {
                result = stations;
            }
            await publicStationCache.set(cacheKey, result, { ttl: 60 });
            res.json(result);
        }
        catch (error) {
            console.error('Error fetching user favorites:', error);
            res.status(500).json({ error: 'Failed to fetch user favorites' });
        }
    });
    // GET USER'S RECENTLY PLAYED STATIONS
    app.get("/api/users/:id/recent", async (req, res) => {
        try {
            const { id } = req.params;
            {
                const user = await pgFindUserByIdOrSlug(String(id));
                if (!user || !user.isPublicProfile)
                    return void res.status(404).json({ error: 'User not found or profile is private' });
                return void res.json(await pgRecentlyPlayedStations(String(user._id)));
            }
        }
        catch (error) {
            // console.error('Error fetching user recent plays:', error);
            res.status(500).json({ error: 'Failed to fetch recent plays' });
        }
    });
    // Public community activity: short-lived ranking, live privacy/identity checks.
    app.get("/api/public-profiles", async (req, res) => {
        try {
            res.set('Cache-Control', 'no-store');
            res.set('CDN-Cache-Control', 'no-store');
            res.set('Cloudflare-CDN-Cache-Control', 'no-store');
            return void res.json({ data: await getCommunityProfiles(Number(req.query.limit) || 100) });
        }
        catch (error) {
            console.error('Error fetching public profiles:', error);
            res.status(500).json({ error: 'Failed to fetch public profiles' });
        }
    });
    // LANGUAGES API - with station counts
    app.get("/api/languages", async (req, res) => {
        try {
            // Fetching languages with station counts
            // Get languages with station counts using aggregation
            const languageStats = (await pgStationFacetCounts('language')).slice(0,100).map(row => ({ _id: row._id, name: row._id, code: row._id.toLowerCase(), stationCount: row.count }));
            // Found languages with station data
            res.json(languageStats);
        }
        catch (error) {
            // console.error('Error fetching languages:', error);
            res.status(500).json({ error: 'Failed to fetch languages' });
        }
    });
    // CODECS API - with station counts
    app.get("/api/codecs", async (req, res) => {
        try {
            // Fetching codecs with station counts
            // Get codecs with station counts using aggregation
            const codecStats = (await pgStationFacetCounts('codec')).slice(0,50).map(row => ({ _id: row._id, name: row._id, stationCount: row.count }));
            // logger.log(` Found ${codecStats.length} codecs with stations`);
            res.json(codecStats);
        }
        catch (error) {
            // console.error('Error fetching codecs:', error);
            res.status(500).json({ error: 'Failed to fetch codecs' });
        }
    });
    // RADIO BROWSER API ENDPOINTS - Direct integration with Radio-Browser.info API
    // Import the Radio Browser service
    let radioBrowserService: any;
    import('../services/radio-browser').then(module => {
        radioBrowserService = module.radioBrowserService;
    });
    // Get Radio Browser API stats
    app.get("/api/radio-browser/stats", async (req, res) => {
        try {
            if (!radioBrowserService) {
                return void res.status(503).json({ error: 'Radio Browser service not available yet' });
            }
            // logger.log(' Fetching Radio Browser API stats...');
            const stats = await radioBrowserService.getStats();
            res.json(stats);
        }
        catch (error) {
            // console.error('Error fetching Radio Browser stats:', error);
            res.status(500).json({ error: 'Failed to fetch Radio Browser stats' });
        }
    });
    // Get top clicked stations from Radio Browser API
    app.get("/api/radio-browser/top-clicked", async (req, res) => {
        try {
            const { limit = 100 } = req.query;
            // logger.log('🔥 Fetching top ${limit} clicked stations from Radio Browser API...');
            const stations = await healthyRadioBrowserStations('clickCount', limit);
            res.json({ stations });
        }
        catch (error) {
            // console.error('Error fetching top clicked stations:', error);
            res.status(500).json({ error: 'Failed to fetch top clicked stations' });
        }
    });
    // Get top voted stations from Radio Browser API
    app.get("/api/radio-browser/top-voted", async (req, res) => {
        try {
            const { limit = 100 } = req.query;
            // logger.log(`⭐ Fetching top ${limit} voted stations from Radio Browser API...`);
            const stations = await healthyRadioBrowserStations('votes', limit);
            res.json({ stations });
        }
        catch (error) {
            // console.error('Error fetching top voted stations:', error);
            res.status(500).json({ error: 'Failed to fetch top voted stations' });
        }
    });
    // Get recently changed stations from Radio Browser API
    app.get("/api/radio-browser/recent", async (req, res) => {
        try {
            const { limit = 100 } = req.query;
            // logger.log('🕒 Fetching ${limit} recently changed stations from Radio Browser API...');
            const stations = await healthyRadioBrowserStations('updatedAt', limit);
            res.json({ stations });
        }
        catch (error) {
            // console.error('Error fetching recently changed stations:', error);
            res.status(500).json({ error: 'Failed to fetch recently changed stations' });
        }
    });
    // Get broken stations from Radio Browser API
    app.get("/api/radio-browser/broken", requireAdmin, async (req, res) => {
        try {
            if (!radioBrowserService) {
                return void res.status(503).json({ error: 'Radio Browser service not available yet' });
            }
            const { limit = 50 } = req.query;
            // logger.log('💔 Fetching ${limit} broken stations from Radio Browser API...');
            const stations = await radioBrowserService.getBrokenStations(Number(limit));
            res.json({ stations });
        }
        catch (error) {
            // console.error('Error fetching broken stations:', error);
            res.status(500).json({ error: 'Failed to fetch broken stations' });
        }
    });
    // SYNC MANAGEMENT API ENDPOINTS
    // Get sync status
    app.get("/api/sync/status", async (req, res) => {
        try {
            const status = await syncService.getStatus();
            res.json(status);
        }
        catch (error) {
            console.error('Error fetching sync status:', error);
            res.status(500).json({ error: 'Failed to fetch sync status' });
        }
    });
    // Auto-flagged junk report — short summary of how many records the
    // ingest pipeline marked as junk during the most recent sync runs.
    // Backs the admin dashboard tile for task #20.
    app.get("/api/admin/sync/auto-flagged-report", requireAdmin, async (req, res) => {
        try {
            const recent = await pgSyncLogs(10);
            const lastCompleted = recent.find((l: any) => l.status === 'completed');
            const last = recent[0] || null;
            res.json({
                last: last
                    ? {
                        syncType: last.syncType,
                        status: last.status,
                        startedAt: last.startedAt,
                        completedAt: last.completedAt,
                        stationsAdded: last.stationsAdded || 0,
                        stationsUpdated: last.stationsUpdated || 0,
                        autoFlagged: last.stationsAutoFlagged || 0,
                    }
                    : null,
                lastCompleted: lastCompleted
                    ? {
                        startedAt: lastCompleted.startedAt,
                        completedAt: lastCompleted.completedAt,
                        stationsAdded: lastCompleted.stationsAdded || 0,
                        stationsUpdated: lastCompleted.stationsUpdated || 0,
                        autoFlagged: lastCompleted.stationsAutoFlagged || 0,
                    }
                    : null,
                recent: recent.map((l: any) => ({
                    syncType: l.syncType,
                    status: l.status,
                    startedAt: l.startedAt,
                    completedAt: l.completedAt,
                    autoFlagged: l.stationsAutoFlagged || 0,
                })),
            });
        }
        catch (error) {
            console.error('Error fetching auto-flagged report:', error);
            res.status(500).json({ error: 'Failed to fetch auto-flagged report' });
        }
    });
    // Get sync logs
    app.get("/api/sync/logs", async (req, res) => {
        try {
            const { limit = 20 } = req.query;
            const logs = await syncService.getLogs(Number(limit));
            res.json(logs);
        }
        catch (error) {
            console.error('Error fetching sync logs:', error);
            res.status(500).json({ error: 'Failed to fetch sync logs' });
        }
    });
    // Force start sync — admin-only (was a public lever to spawn a heavy
    // long-running sync that pulls 40k+ stations into memory).
    app.post("/api/sync/force", requireAdmin, async (req, res) => {
        try {
            logger.log('🚀 Force starting sync...');
            // Start the sync asynchronously (don't wait for completion)
            syncService.startSync()
                .then(() => {
                logger.log('✅ Force sync completed successfully');
            })
                .catch((error) => {
                console.error('❌ Force sync failed:', error);
            });
            res.json({
                success: true,
                message: 'Sync started successfully - check status for progress'
            });
        }
        catch (error) {
            console.error('Error starting sync:', error);
            res.status(500).json({ error: 'Failed to start sync' });
        }
    });
    // Stop sync — admin-only.
    app.post("/api/sync/stop", requireAdmin, async (req, res) => {
        try {
            logger.log('🛑 Stopping sync...');
            await syncService.stopSync();
            res.status(202).json({success:true, message:'Sync cancellation requested', status:'requested'});
        }
        catch (error) {
            console.error('Error stopping sync:', error);
            res.status(500).json({ error: 'Failed to stop sync' });
        }
    });
    // Flush all station data
    app.post("/api/admin/flush-stations", requireAdmin, async (req, res) => {
        try {
            logger.log('🗑️ Flushing all station data...');
            const counts = await pgFlushStationData();
            const stationResult = {deletedCount:counts.deletedStations};
            const syncLogResult = {deletedCount:counts.deletedSyncLogs};
            const blacklistResult = {deletedCount:counts.deletedBlacklisted};
            await publicStationCache.clearByPattern('user-favorites:');
            await refreshCommunityFavoritesCache();
            performanceCache.clearSeoHtml();
            performanceCache.clearPageData();
            logger.log('🎯 Station data flush complete! Database is now empty and ready for fresh sync.');
            // Fire-and-forget audit email summarising the wiped collections. Opt-in
            // via ADMIN_AUDIT_EMAIL_RECIPIENTS env var; safe no-op when unset.
            const actorEmail = (req.user as {
                email?: string;
            } | undefined)?.email ?? undefined;
            void import('../services/admin-audit-email')
                .then(({ emailFlushStationsCsv }) => emailFlushStationsCsv({
                counts: {
                    deletedStations: stationResult.deletedCount ?? 0,
                    deletedSyncLogs: syncLogResult.deletedCount ?? 0,
                    deletedBlacklisted: blacklistResult.deletedCount ?? 0,
                },
                actorEmail,
            }))
                .catch((err) => {
                console.error('Failed to load admin-audit-email service:', err);
            });
            res.json({
                success: true,
                message: 'All station data flushed successfully',
                deletedStations: stationResult.deletedCount,
                deletedSyncLogs: syncLogResult.deletedCount,
                deletedBlacklisted: blacklistResult.deletedCount
            });
        }
        catch (error) {
            console.error('❌ Error flushing station data:', error);
            res.status((error as any)?.statusCode || 500).json({ error: (error as any)?.statusCode === 409 ? (error as Error).message : 'Failed to flush station data' });
        }
    });
    // ANALYTICS API ENDPOINTS
    // Remove playlist files (M3U, PLS, ASX) endpoint
    app.post("/api/admin/remove-playlist-streams", requireAdmin, async (req, res) => {
        try {
            logger.log('🗑️ Starting removal of playlist files (M3U, PLS, ASX)...');
            const playlistFilter = { url: { $regex: /\.(m3u|pls|asx)(\?|$)/i } };
            // Per-extension counts so the audit email can break down what was wiped.
            const [playlistCount, m3uCount, plsCount, asxCount] = await Promise.all([
                pgCatalog().count(playlistFilter),
                pgCatalog().count({ url: { $regex: /\.m3u(\?|$)/i } }),
                pgCatalog().count({ url: { $regex: /\.pls(\?|$)/i } }),
                pgCatalog().count({ url: { $regex: /\.asx(\?|$)/i } }),
            ]);
            logger.log(`Found ${playlistCount} playlist files to remove`);
            // Capture a sample of the rows about to be deleted so the audit email
            // can list specific stations (capped to keep the attachment small).
            const sampleDocs = await pgCatalog().find(playlistFilter, { limit: 500, fields: Object.keys({ name: 1, url: 1, country: 1, countrycode: 1 }) });
            // Remove all playlist file streams
            const removalResult = await pgCatalog().remove(playlistFilter);
            logger.log(`✅ Removed ${removalResult.deletedCount} playlist streams`);
            // Get updated counts
            const remainingTotal = await pgCatalog().count({});
            const directMP3 = await pgCatalog().count({
                url: { $regex: /\.mp3(\?|$)/i }
            });
            const directAAC = await pgCatalog().count({
                url: { $regex: /\.aac(\?|$)/i }
            });
            const icecastCount = await pgCatalog().count({
                url: { $regex: /(:8000|:8080|\/stream|\/radio|shoutcast|icecast)/i }
            });
            const results = {
                removed_count: removalResult.deletedCount,
                remaining_stations: remainingTotal,
                direct_playable: {
                    mp3_streams: directMP3,
                    aac_streams: directAAC,
                    icecast_shoutcast: icecastCount,
                    total_direct: directMP3 + directAAC + icecastCount
                },
                message: `Successfully removed ${removalResult.deletedCount} playlist streams. ${remainingTotal} direct-playable stations remain.`
            };
            // Fire-and-forget audit email summarising the wiped playlist streams.
            // Opt-in via ADMIN_AUDIT_EMAIL_RECIPIENTS env var; safe no-op when unset.
            const removedCount = removalResult.deletedCount ?? 0;
            const playlistActor = (req.user as {
                email?: string;
            } | undefined)?.email ?? undefined;
            type StreamSampleDoc = {
                name?: string;
                url?: string;
                country?: string;
                countrycode?: string;
            };
            const playlistSamples = (sampleDocs as StreamSampleDoc[]).map((d) => ({
                name: d.name ?? '',
                url: d.url ?? '',
                country: d.country ?? '',
                countryCode: d.countrycode ?? '',
            }));
            void import('../services/admin-audit-email')
                .then(({ emailRemovedStreamsCsv }) => emailRemovedStreamsCsv({
                filenamePrefix: 'playlist-streams-removed',
                subjectSummary: `Removed ${removedCount} playlist stream${removedCount === 1 ? '' : 's'} (M3U/PLS/ASX)`,
                title: 'Playlist streams removed',
                summary: `${removedCount} playlist stream${removedCount === 1 ? '' : 's'} (M3U/PLS/ASX) ` +
                    `${removedCount === 1 ? 'was' : 'were'} removed. ${remainingTotal} stations remain.`,
                categories: [
                    { label: 'M3U', count: m3uCount },
                    { label: 'PLS', count: plsCount },
                    { label: 'ASX', count: asxCount },
                    { label: 'Total removed', count: removedCount },
                    { label: 'Remaining stations', count: remainingTotal },
                ],
                samples: playlistSamples,
                totalRemoved: removedCount,
                actorEmail: playlistActor,
            }))
                .catch((err) => {
                console.error('Failed to load admin-audit-email service:', err);
            });
            res.json(results);
        }
        catch (error) {
            console.error('Playlist removal error:', error);
            res.status(500).json({ error: 'Failed to remove playlist streams' });
        }
    });
    // Remove HLS/M3U8 streams endpoint (completed)
    app.post("/api/admin/remove-hls-streams", requireAdmin, async (req, res) => {
        try {
            logger.log('🗑️ Starting removal of HLS/M3U8 streams...');
            const hlsFilter = { url: { $regex: /hls|m3u8/i } };
            // Count streams to be removed (broken down for the audit email).
            const [m3u8Count, hlsRelatedCount] = await Promise.all([
                pgCatalog().count({ url: { $regex: /\.m3u8/i } }),
                pgCatalog().count(hlsFilter),
            ]);
            logger.log(`Found ${m3u8Count} .m3u8 streams and ${hlsRelatedCount} HLS-related streams to remove`);
            // Capture sample of stations to be deleted for the audit attachment.
            const hlsSampleDocs = await pgCatalog().find(hlsFilter, { limit: 500, fields: Object.keys({ name: 1, url: 1, country: 1, countrycode: 1 }) });
            // Remove all streams with HLS/M3U8 in URL
            const removalResult = await pgCatalog().remove(hlsFilter);
            logger.log(`✅ Removed ${removalResult.deletedCount} HLS/M3U8 streams`);
            // Get updated counts
            const remainingTotal = await pgCatalog().count({});
            const directMP3 = await pgCatalog().count({
                url: { $regex: /\.mp3(\?|$)/i }
            });
            const icecastCount = await pgCatalog().count({
                url: { $regex: /(:8000|:8080|\/stream|\/radio|shoutcast|icecast)/i }
            });
            const results = {
                removed_count: removalResult.deletedCount,
                remaining_stations: remainingTotal,
                direct_playable: {
                    mp3_streams: directMP3,
                    icecast_shoutcast: icecastCount,
                    total_direct: directMP3 + icecastCount
                },
                message: `Successfully removed ${removalResult.deletedCount} HLS/M3U8 streams. ${remainingTotal} direct-playable stations remain.`
            };
            // Fire-and-forget audit email summarising the wiped HLS streams. Opt-in
            // via ADMIN_AUDIT_EMAIL_RECIPIENTS env var; safe no-op when unset.
            const hlsRemovedCount = removalResult.deletedCount ?? 0;
            const hlsActor = (req.user as {
                email?: string;
            } | undefined)?.email ?? undefined;
            type HlsSampleDoc = {
                name?: string;
                url?: string;
                country?: string;
                countrycode?: string;
            };
            const hlsSamples = (hlsSampleDocs as HlsSampleDoc[]).map((d) => ({
                name: d.name ?? '',
                url: d.url ?? '',
                country: d.country ?? '',
                countryCode: d.countrycode ?? '',
            }));
            const hlsOnlyCount = Math.max(hlsRelatedCount - m3u8Count, 0);
            void import('../services/admin-audit-email')
                .then(({ emailRemovedStreamsCsv }) => emailRemovedStreamsCsv({
                filenamePrefix: 'hls-streams-removed',
                subjectSummary: `Removed ${hlsRemovedCount} HLS/M3U8 stream${hlsRemovedCount === 1 ? '' : 's'}`,
                title: 'HLS/M3U8 streams removed',
                summary: `${hlsRemovedCount} HLS/M3U8 stream${hlsRemovedCount === 1 ? '' : 's'} ` +
                    `${hlsRemovedCount === 1 ? 'was' : 'were'} removed. ${remainingTotal} stations remain.`,
                categories: [
                    { label: '.m3u8', count: m3u8Count },
                    { label: 'Other HLS-related', count: hlsOnlyCount },
                    { label: 'Total removed', count: hlsRemovedCount },
                    { label: 'Remaining stations', count: remainingTotal },
                ],
                samples: hlsSamples,
                totalRemoved: hlsRemovedCount,
                actorEmail: hlsActor,
            }))
                .catch((err) => {
                console.error('Failed to load admin-audit-email service:', err);
            });
            res.json(results);
        }
        catch (error) {
            console.error('HLS removal error:', error);
            res.status(500).json({ error: 'Failed to remove HLS streams' });
        }
    });
    // HTTPS/HTTP URL analysis endpoint
    app.get("/api/stream-https-analysis", async (req, res) => {
        try {
            logger.log('🔍 Analyzing HTTPS vs HTTP URLs across all stations...');
            const totalStations = await pgCatalog().count({});
            // Count HTTPS URLs
            const httpsCount = await pgCatalog().count({
                url: { $regex: /^https:\/\//i }
            });
            // Count HTTP URLs
            const httpCount = await pgCatalog().count({
                url: { $regex: /^http:\/\//i }
            });
            // Count resolved HTTPS URLs (urlResolved field)
            const httpsResolvedCount = await pgCatalog().count({
                urlResolved: { $regex: /^https:\/\//i }
            });
            // Count resolved HTTP URLs
            const httpResolvedCount = await pgCatalog().count({
                urlResolved: { $regex: /^http:\/\//i }
            });
            // Count stations with urlResolved field populated
            const stationsWithResolvedUrl = await pgCatalog().count({
                urlResolved: { $exists: true, $nin: [null, ""] }
            });
            // Get some HTTPS URL samples
            const httpsSamples = await pgCatalog().find({
                url: { $regex: /^https:\/\//i }
            }, { limit: 5, fields: ["name", "url", "country"] });
            // Get some HTTP URL samples
            const httpSamples = await pgCatalog().find({
                url: { $regex: /^http:\/\//i }
            }, { limit: 5, fields: ["name", "url", "country"] });
            // Get some resolved HTTPS URL samples
            const httpsResolvedSamples = await pgCatalog().find({
                urlResolved: { $regex: /^https:\/\//i }
            }, { limit: 5, fields: ["name", "url", "urlResolved", "country"] });
            const results = {
                total_stations: totalStations,
                original_urls: {
                    https_urls: httpsCount,
                    http_urls: httpCount,
                    https_percentage: ((httpsCount / totalStations) * 100).toFixed(2),
                    http_percentage: ((httpCount / totalStations) * 100).toFixed(2)
                },
                resolved_urls: {
                    stations_with_resolved: stationsWithResolvedUrl,
                    https_resolved: httpsResolvedCount,
                    http_resolved: httpResolvedCount,
                    https_resolved_percentage: stationsWithResolvedUrl > 0 ? ((httpsResolvedCount / stationsWithResolvedUrl) * 100).toFixed(2) : "0",
                    http_resolved_percentage: stationsWithResolvedUrl > 0 ? ((httpResolvedCount / stationsWithResolvedUrl) * 100).toFixed(2) : "0"
                },
                samples: {
                    https_samples: httpsSamples,
                    http_samples: httpSamples,
                    https_resolved_samples: httpsResolvedSamples
                }
            };
            logger.log('🔒 HTTPS/HTTP Analysis Results:', {
                total: results.total_stations,
                https: results.original_urls.https_urls,
                http: results.original_urls.http_urls,
                resolved: results.resolved_urls.stations_with_resolved,
                https_resolved: results.resolved_urls.https_resolved
            });
            res.json(results);
        }
        catch (error) {
            console.error('HTTPS analysis error:', error);
            res.status(500).json({ error: 'Failed to analyze HTTPS URLs' });
        }
    });
    // Stream type analysis endpoint
    app.get("/api/stream-analysis", async (req, res) => {
        try {
            logger.log('🔍 Analyzing stream types across all stations...');
            const totalStations = await pgCatalog().count({});
            // Count .m3u8 URLs (HLS streams)
            const m3u8Count = await pgCatalog().count({
                url: { $regex: /\.m3u8/i }
            });
            // Count HLS-related URLs (contains 'hls' or 'm3u8')
            const hlsRelatedCount = await pgCatalog().count({
                url: { $regex: /hls|m3u8/i }
            });
            // Count playlist URLs (.m3u, .pls, .asx)
            const playlistCount = await pgCatalog().count({
                url: { $regex: /\.(m3u|pls|asx)$/i }
            });
            // Count direct MP3 streams
            const mp3Count = await pgCatalog().count({
                url: { $regex: /\.mp3(\?|$)/i }
            });
            // Count direct AAC streams
            const aacCount = await pgCatalog().count({
                url: { $regex: /\.aac(\?|$)/i }
            });
            // Count Icecast/Shoutcast streams (common radio streaming)
            const icecastCount = await pgCatalog().count({
                url: { $regex: /(:8000|:8080|\/stream|\/radio|shoutcast|icecast)/i }
            });
            // Get sample .m3u8 URLs
            const m3u8Samples = await pgCatalog().find({
                url: { $regex: /\.m3u8/i }
            }, { limit: 10, fields: ["name", "url", "country"] });
            // Get sample HLS URLs
            const hlsSamples = await pgCatalog().find({
                url: { $regex: /hls/i }
            }, { limit: 10, fields: ["name", "url", "country"] });
            const results = {
                total_stations: totalStations,
                stream_types: {
                    m3u8_urls: m3u8Count,
                    hls_related: hlsRelatedCount,
                    playlist_files: playlistCount,
                    direct_mp3: mp3Count,
                    direct_aac: aacCount,
                    icecast_shoutcast: icecastCount
                },
                percentages: {
                    m3u8_percentage: ((m3u8Count / totalStations) * 100).toFixed(2),
                    hls_percentage: ((hlsRelatedCount / totalStations) * 100).toFixed(2),
                    mp3_percentage: ((mp3Count / totalStations) * 100).toFixed(2),
                    icecast_percentage: ((icecastCount / totalStations) * 100).toFixed(2)
                },
                samples: {
                    m3u8_stations: m3u8Samples,
                    hls_stations: hlsSamples
                }
            };
            logger.log('📊 Stream Analysis Results:', {
                total: results.total_stations,
                m3u8: results.stream_types.m3u8_urls,
                hls: results.stream_types.hls_related,
                mp3: results.stream_types.direct_mp3,
                icecast: results.stream_types.icecast_shoutcast
            });
            res.json(results);
        }
        catch (error) {
            console.error('Stream analysis error:', error);
            res.status(500).json({ error: 'Failed to analyze streams' });
        }
    });
    // Raw analytics include user/session/network metadata and are admin-only.
    app.get("/api/analytics", requireAdmin, async (req, res) => {
        try {
            const {startDate,endDate,event} = req.query;
            const from=typeof startDate==='string'?new Date(startDate):undefined;
            const to=typeof endDate==='string'?new Date(endDate):undefined;
            if ((from&&isNaN(from.getTime()))||(to&&isNaN(to.getTime()))) return void res.status(400).json({error:'Invalid date filter'});
            res.json(await pgAnalyticsEvents({from,to,event:typeof event==='string'?event:undefined,limit:Number(req.query.limit)||100}));
        } catch(error) {
            logger.error('Error fetching analytics:',error);
            res.status(500).json({error:'Failed to fetch analytics'});
        }
    });
    // Get analytics summary/stats
    app.get("/api/analytics/summary", async (req, res) => {
        try {
            // logger.log(' Fetching analytics summary...');
            const { period = '7d' } = req.query;
            // Calculate date range based on period
            let startDate = new Date();
            switch (period) {
                case '24h':
                    startDate.setHours(startDate.getHours() - 24);
                    break;
                case '7d':
                    startDate.setDate(startDate.getDate() - 7);
                    break;
                case '30d':
                    startDate.setDate(startDate.getDate() - 30);
                    break;
                default:
                    startDate.setDate(startDate.getDate() - 7);
            }
            // Get basic station stats from existing data
            const totalStations = await pgCatalog().count();
            const activeStations = await pgCatalog().count({ lastCheckOk: true });
            const brokenStations = await pgCatalog().count({ lastCheckOk: false });
            // Get top countries by station count
            const topCountries = (await pgStationFacetCounts('country')).slice(0,10);
            // Get top genres by station count
            const topGenres = (await pgListAdminGenres('',false,'stationCount',10)).rows;
            // Get top codecs
            const topCodecs = (await pgStationFacetCounts('codec')).slice(0,10);
            const summary = {
                totalStations,
                activeStations,
                brokenStations,
                healthPercentage: totalStations > 0 ? Math.round((activeStations / totalStations) * 100) : 0,
                period,
                topCountries: topCountries.map(c => ({ name: c._id, count: c.count })),
                topGenres: topGenres.map(g => ({ name: g.name, count: g.stationCount })),
                topCodecs: topCodecs.map(c => ({ name: c._id, count: c.count })),
                lastUpdated: new Date()
            };
            // logger.log(` Analytics summary - ${totalStations} total stations, ${activeStations} active`);
            res.json(summary);
        }
        catch (error) {
            // console.error('Error fetching analytics summary:', error);
            res.status(500).json({ error: 'Failed to fetch analytics summary' });
        }
    });
    // =========================================================================
    // SEO TRANSLATIONS HUB (Task #519 — 2026-05-18)
    // Five endpoints that back the /admin/seo-translations dashboard page.
    // =========================================================================
    const SEO_KEYS_ALL = [
        // station-level (7)
        'default_station_about', 'from', 'genres', 'station_additional_info',
        'live_radio', 'online_radio', 'radio_streaming',
        // homepage-level (8)
        'hero_worlds_best_radio', 'hero_over_100_countries', 'hero_listen_everywhere',
        'nav_genres', 'nav_regions', 'nav_stations',
        'popular_genres_title', 'popular_countries_title',
    ] as const;
    let inFlightApplyJob: Promise<unknown> | null = null;
    let inFlightRegenerateJob: Promise<unknown> | null = null;
    // GET /api/admin/seo-translations/coverage
    // Returns per-language coverage for the 15 required SEO keys + qualified-language state.
    app.get('/api/admin/seo-translations/coverage', deps.requireAdmin, async (_req: any, res: any) => {
        try {
            const { SEO_LANGUAGES } = await import('@workspace/seo-shared/seo-config');
            const { getQualifiedLanguagesState } = await import('../seo/qualified-languages');
            const [qualifiedState, keyDocs] = await Promise.all([
                getQualifiedLanguagesState(),
                (pgLocalization().getKeys(SEO_KEYS_ALL)),
            ]);
            const keyIdByName: Record<string, any> = {};
            (keyDocs as any[]).forEach((k) => { keyIdByName[k.key] = k._id; });
            const presentKeyIds = Object.values(keyIdByName);
            const allLangCodes = (SEO_LANGUAGES as any[]).filter((l: any) => l.enabled && isActiveUiLanguage(l.code)).map((l: any) => l.code as string);
            // One aggregation — fetch all translations for the 15 SEO keys across all languages.
            const translationRows: {
                language: string;
                key: string;
            }[] = ((await pgLocalization().listTranslations(undefined, SEO_KEYS_ALL, true)).filter((row) => allLangCodes.includes(row.language)).map((row) => ({ language: row.language, key: row.keyId.key })));
            const byLang: Record<string, Set<string>> = {};
            translationRows.forEach(({ language, key }) => {
                if (!byLang[language])
                    byLang[language] = new Set();
                byLang[language].add(key);
            });
            const qualifiedSet = new Set(qualifiedState.languages);
            const allKeys = Array.from(SEO_KEYS_ALL);
            const languages = (SEO_LANGUAGES as any[])
                .filter((l: any) => l.enabled && isActiveUiLanguage(l.code))
                .map((l: any) => {
                const completedKeys = allKeys.filter((k) => byLang[l.code]?.has(k));
                const missingKeys = allKeys.filter((k) => !byLang[l.code]?.has(k));
                return {
                    code: l.code,
                    name: l.name,
                    qualified: qualifiedSet.has(l.code),
                    completedKeys,
                    missingKeys,
                    completionPct: Math.round((completedKeys.length / allKeys.length) * 100),
                };
            })
                .sort((a: any, b: any) => b.completionPct - a.completionPct);
            res.json({ languages, totalQualified: qualifiedSet.size, qualifiedLangsState: qualifiedState });
        }
        catch (err: any) {
            logger.error('seo-translations/coverage failed:', err?.message);
            res.status(500).json({ error: 'Failed to fetch SEO translation coverage' });
        }
    });
    // POST /api/admin/seo-translations/apply
    // Upserts the pre-generated Phase C translations into PostgreSQL.
    // Translations are embedded directly so no filesystem access is needed
    // at runtime inside the Docker container.
    app.post('/api/admin/seo-translations/apply', deps.requireAdmin, async (_req: any, res: any) => {
        if (inFlightApplyJob) {
            return void res.status(409).json({ error: 'Apply job already running', code: 'apply_in_progress' });
        }
        const startMs = Date.now();
        let resolve!: () => void;
        inFlightApplyJob = new Promise<void>((r) => { resolve = r; });
        try {
            const TRANSLATIONS: Record<string, Record<string, string>> = getPhaseCTranslations();
            const ALL_KEYS = Object.keys(TRANSLATIONS.en ?? {});
            const LANG_CODES = Object.keys(TRANSLATIONS).filter(isActiveUiLanguage);
            const EN = TRANSLATIONS.en ?? {};
            // Upsert TranslationKey documents for each key.
            const keyIdMap: Record<string, any> = {};
            for (const key of ALL_KEYS) {
                const doc = (await pgLocalization().upsertKey({ key, defaultValue: EN[key] ?? '', category: 'seo', isPlural: false }, true));
                keyIdMap[key] = (doc as any)?._id;
            }
            const byLanguage: Record<string, {
                inserted: number;
                skipped: number;
            }> = {};
            let totalInserted = 0;
            let totalSkipped = 0;
            for (const lang of LANG_CODES) {
                let inserted = 0;
                let skipped = 0;
                for (const key of ALL_KEYS) {
                    const value = (TRANSLATIONS[lang]?.[key] ?? '').trim();
                    if (!value || !keyIdMap[key]) {
                        skipped++;
                        continue;
                    }
                    const existing = (await pgLocalization().findTranslation(String(keyIdMap[key]), lang));
                    if (existing && (existing as any).value?.trim()) {
                        skipped++;
                        continue;
                    }
                    {
                        await pgLocalization().upsertTranslation({ keyId: String(keyIdMap[key]), language: lang, value, isCompleted: true });
                        inserted++;
                        continue;
                    }
                }
                byLanguage[lang] = { inserted, skipped };
                totalInserted += inserted;
                totalSkipped += skipped;
            }
            res.json({
                message: `Applied Phase C translations: ${totalInserted} inserted, ${totalSkipped} skipped`,
                inserted: totalInserted,
                skipped: totalSkipped,
                byLanguage,
                durationMs: Date.now() - startMs,
            });
        }
        catch (err: any) {
            logger.error('seo-translations/apply failed:', err?.message);
            res.status(500).json({ error: 'Apply failed: ' + (err?.message ?? 'unknown') });
        }
        finally {
            resolve();
            inFlightApplyJob = null;
        }
    });
    // POST /api/admin/seo-translations/regenerate
    // Calls OpenAI gpt-4o-mini to fill any missing SEO keys.
    app.post('/api/admin/seo-translations/regenerate', deps.requireAdmin, async (req: any, res: any) => {
        if (inFlightRegenerateJob) {
            return void res.status(409).json({ error: 'Regenerate job already running', code: 'regenerate_in_progress' });
        }
        if (!process.env.OPENAI_API_KEY) {
            return void res.status(503).json({ error: 'OPENAI_API_KEY env var not set' });
        }
        const { SEO_LANGUAGES } = await import('@workspace/seo-shared/seo-config');
        const force: boolean = req.body?.force === true;
        const requestedLangs: string[] | undefined = Array.isArray(req.body?.languages) ? req.body.languages : undefined;
        const targetLangs = requestedLangs
            ? (SEO_LANGUAGES as any[]).filter((l: any) => l.enabled && isActiveUiLanguage(l.code) && requestedLangs.includes(l.code)).map((l: any) => l.code as string)
            : (SEO_LANGUAGES as any[]).filter((l: any) => l.enabled && isActiveUiLanguage(l.code)).map((l: any) => l.code as string);
        const startMs = Date.now();
        let resolve!: () => void;
        inFlightRegenerateJob = new Promise<void>((r) => { resolve = r; });
        try {
            const OpenAI = (await import('openai')).default;
            // Keep one admin regeneration request below the edge timeout;
            // the UI submits one language at a time and can retry remaining gaps.
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 0 });
            const keyDocs = (await pgLocalization().getKeys(SEO_KEYS_ALL));
            const keyIdByName: Record<string, any> = {};
            (keyDocs as any[]).forEach((k: any) => { keyIdByName[k.key] = k._id; });
            const enRows = (await pgLocalization().listTranslations('en', SEO_KEYS_ALL, true));
            const enDefaults: Record<string, string> = {};
            (enRows as any[]).forEach((t: any) => {
                if (t.keyId?.key)
                    enDefaults[t.keyId.key] = t.value;
            });
            let totalGenerated = 0;
            let totalSkipped = 0;
            let totalFailed = 0;
            const byLanguage: Record<string, {
                generated: number;
                skipped: number;
                failed: number;
            }> = {};
            const BATCH = 5;
            for (let i = 0; i < targetLangs.length; i += BATCH) {
                const batch = targetLangs.slice(i, i + BATCH);
                await Promise.all(batch.map(async (lang) => {
                    const existing = (await pgLocalization().listTranslations(lang, SEO_KEYS_ALL, true));
                    const existingKeys = new Set((existing as any[]).filter((t: any) => t.value?.trim()).map((t: any) => t.keyId?.key).filter(Boolean));
                    const missingKeys = force
                        ? (SEO_KEYS_ALL as readonly string[]).filter(() => true)
                        : (SEO_KEYS_ALL as readonly string[]).filter((k) => !existingKeys.has(k));
                    if (missingKeys.length === 0) {
                        byLanguage[lang] = { generated: 0, skipped: SEO_KEYS_ALL.length, failed: 0 };
                        totalSkipped += SEO_KEYS_ALL.length;
                        return;
                    }
                    const langName = (SEO_LANGUAGES as any[]).find((l: any) => l.code === lang)?.name ?? lang;
                    try {
                        const prompt = `Translate the following JSON object values into ${langName} (${lang}). Keep keys exactly as-is. Do not translate brand name "Mega Radio" or placeholder "{STATION_NAME}". Return only valid JSON.\n\n${JSON.stringify(Object.fromEntries(missingKeys.map((k) => [k, enDefaults[k] ?? k])))}`;
                        const resp = await openai.chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [{ role: 'user', content: prompt }],
                            response_format: { type: 'json_object' },
                            max_tokens: 1024,
                        });
                        const translated: Record<string, string> = JSON.parse(resp.choices[0]?.message?.content ?? '{}');
                        let gen = 0;
                        for (const key of missingKeys) {
                            const value = (translated[key] ?? '').trim();
                            if (!value || !keyIdByName[key])
                                continue;
                            {
                                await pgLocalization().upsertTranslation({ keyId: String(keyIdByName[key]), language: lang, value, isCompleted: true });
                                gen++;
                                continue;
                            }
                        }
                        byLanguage[lang] = { generated: gen, skipped: existingKeys.size, failed: missingKeys.length - gen };
                        totalGenerated += gen;
                        totalFailed += missingKeys.length - gen;
                    }
                    catch (e: any) {
                        byLanguage[lang] = { generated: 0, skipped: existingKeys.size, failed: missingKeys.length };
                        totalFailed += missingKeys.length;
                        logger.warn(`seo-translations/regenerate: OpenAI failed for ${lang}: ${e?.message}`);
                    }
                }));
            }
            res.json({
                message: `Regenerated SEO translations: ${totalGenerated} keys across ${targetLangs.length} languages`,
                generated: totalGenerated,
                skipped: totalSkipped,
                failed: totalFailed,
                byLanguage,
                durationMs: Date.now() - startMs,
            });
        }
        catch (err: any) {
            logger.error('seo-translations/regenerate failed:', err?.message);
            res.status(500).json({ error: 'Regenerate failed: ' + (err?.message ?? 'unknown') });
        }
        finally {
            resolve();
            inFlightRegenerateJob = null;
        }
    });
    // POST /api/admin/seo-translations/invalidate-cache
    // Forces re-computation of the qualified-languages list.
    app.post('/api/admin/seo-translations/invalidate-cache', deps.requireAdmin, async (_req: any, res: any) => {
        try {
            const { invalidateQualifiedLanguages, getQualifiedLanguagesState } = await import('../seo/qualified-languages');
            await invalidateQualifiedLanguages({ resetLkg: false });
            const fresh = await getQualifiedLanguagesState();
            res.json({
                message: `Qualified-languages cache invalidated. ${fresh.languages.length} languages now qualified.`,
                newQualifiedCount: fresh.languages.length,
                qualifiedLanguages: fresh.languages,
                source: fresh.source,
                computedAt: fresh.computedAt,
            });
        }
        catch (err: any) {
            logger.error('seo-translations/invalidate-cache failed:', err?.message);
            res.status(500).json({ error: 'Invalidate failed: ' + (err?.message ?? 'unknown') });
        }
    });
    // POST /api/admin/seo-translations/warm-all
    // Warm only published UI languages.
    app.post('/api/admin/seo-translations/warm-all', deps.requireAdmin, async (_req: any, res: any) => {
        try {
            const { performanceCache: pc } = await import('../performance-cache');
            // Reset the memoized warmup promise so it runs again even if already completed.
            (pc as any).warmupPromise = null;
            const { SEO_LANGUAGES } = await import('@workspace/seo-shared/seo-config');
            const total = (SEO_LANGUAGES as any[]).filter((l: any) => l.enabled && isActiveUiLanguage(l.code)).length;
            // Fire-and-forget — client gets immediate response.
            void pc.warmupCaches().catch((e: any) => logger.warn('warm-all failed:', e?.message));
            res.json({ message: `Warming ${total} languages in background (batches of 5, 500ms between batches)`, totalLanguages: total });
        }
        catch (err: any) {
            logger.error('seo-translations/warm-all failed:', err?.message);
            res.status(500).json({ error: 'Warm-all failed: ' + (err?.message ?? 'unknown') });
        }
    });
    // POST /api/admin/scan-frontend-strings
    // Scans the frontend source for t('key', 'default') calls and upserts new TranslationKey documents.
    app.post('/api/admin/scan-frontend-strings', deps.requireAdmin, async (_req: any, res: any) => {
        try {
            const { TranslationSyncService } = await import('../services/translation-sync');
            const result = await TranslationSyncService.syncNewKeys();
            res.json({
                message: `Scan complete: ${result.added} new keys added, ${result.existing} already existed`,
                added: result.added,
                existing: result.existing,
            });
        }
        catch (err: any) {
            logger.error('scan-frontend-strings failed:', err?.message);
            if (err?.code === 'ENOENT') {
                res.status(422).json({ error: 'Frontend source directory not found — package artifacts/megaradio/src or configure TRANSLATION_SOURCE_DIR.' });
            }
            else if (err?.status === 409) {
                res.status(409).json({ error: err.message });
            }
            else {
                res.status(500).json({ error: 'Scan failed: ' + (err?.message ?? 'unknown') });
            }
        }
    });
    // POST /api/admin/translation-keys/add-faq-keys
    // Upserts all FAQ question/answer TranslationKey documents from the seo-shared FAQ schema.
    app.post('/api/admin/translation-keys/add-faq-keys', deps.requireAdmin, async (_req: any, res: any) => {
        try {
            const { FAQ_PAGE_ITEMS } = await import('@workspace/seo-shared/faq-schema');
            const { bumpTranslationVersion } = await import('../services/translation-version');
            let added = 0;
            let existing = 0;
            for (const item of FAQ_PAGE_ITEMS as any[]) {
                const pairs = [
                    { key: item.qKey, defaultValue: item.qFallback, description: 'FAQ page question' },
                    { key: item.aKey, defaultValue: item.aFallback, description: 'FAQ page answer' },
                ];
                for (const { key, defaultValue, description } of pairs) {
                    const exists = (await pgLocalization().findKey(key));
                    if (!exists) {
                        await pgLocalization().upsertKey({ key, defaultValue, description, category: 'faq', isPlural: false }, true);
                        added++;
                    }
                    else {
                        existing++;
                    }
                }
            }
            if (added > 0) {
                await bumpTranslationVersion(`FAQ keys seeded: ${added} added`);
            }
            res.json({
                message: `FAQ keys: ${added} added, ${existing} already existed`,
                added,
                existing,
            });
        }
        catch (err: any) {
            logger.error('add-faq-keys failed:', err?.message);
            res.status(500).json({ error: 'Add FAQ keys failed: ' + (err?.message ?? 'unknown') });
        }
    });
}
