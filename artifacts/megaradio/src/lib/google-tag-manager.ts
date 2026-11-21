import { getLanguageFromPath, ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { reverseTranslateUrl } from '@workspace/seo-shared/url-translations';
import { getWebAnalyticsConsent, subscribeWebAnalyticsConsent, type WebAnalyticsConsentSource } from './web-analytics-consent';

export const MEGARADIO_GTM_ID = 'GTM-WRF32ZCN';

interface GoogleConsentApi {
  callbackQueue?: { push(callback: Record<string, () => void>): unknown };
}
type GoogleWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  googlefc?: GoogleConsentApi;
  __tcfapi?: (command: string, version: number, callback: (data: { eventStatus?: string }, success: boolean) => void) => void;
  __MEGARADIO_GOOGLE_ALLOWED__?: () => boolean;
  readonly __MEGARADIO_GOOGLE_ALLOWED_VALUE__?: boolean;
};

/** Only public content paths; account routes and query/fragment values never
 * become measurement dimensions. This is not an authentication boundary. */
export function publicMeasurementUrl(raw: string, origin: string): string | null {
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return null;
    if ([...url.searchParams.keys()].some(key => /token|password|email|oauth|^code$/i.test(key))) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (!ACTIVE_SITEMAP_LANGUAGES.some(language => language === parts[0])) return null;
    const { cleanPath, language } = getLanguageFromPath(url.pathname);
    const path = reverseTranslateUrl(cleanPath, language);
    if (!/^\/(?:about|contact|applications|privacy-policy|terms-and-conditions|faq|radios)?$/.test(path)
      && !/^\/(?:blog|station|stations|genres|regions)(?:\/[\p{L}\p{N}_.%-]+)*$/u.test(path)) return null;
    return `${origin}${url.pathname}`;
  } catch { return null; }
}

/** External referrers are limited to Bing origins, never search payloads. */
export function publicMeasurementReferrer(raw: string, origin: string): string | null {
  try {
    const url = new URL(raw, origin);
    if (url.username || url.password) return null;
    if (url.origin === origin) return publicMeasurementUrl(raw, origin);
    if (url.protocol === 'https:' && (url.origin === 'https://bing.com' || url.origin === 'https://www.bing.com')) return url.origin;
    return null;
  } catch { return null; }
}

const GOOGLE_EVENTS = new Set([
  'station_play', 'genre_play', 'country_play', 'station_favorite_add',
  'station_favorite_remove', 'listening_time', 'search', 'playback_error', 'station_state_change', 'activity_heartbeat', 'app_foreground', 'app_background',
]);

export function createGoogleTagManager(options: {
  host: Window; document: Document; enabled: boolean; containerId: string; measurementId: string;
  consent?: WebAnalyticsConsentSource;
}) {
  const host = options.host as GoogleWindow;
  const doc = options.document;
  const configured = options.enabled && /^GTM-[A-Z0-9]+$/.test(options.containerId)
    && /^G-[A-Z0-9]+$/.test(options.measurementId);
  const consent = options.consent ?? { get: getWebAnalyticsConsent, subscribe: subscribeWebAnalyticsConsent };
  let initialized = false;
  let started = false;
  let locked = false;
  let lastPage: string | null = null;
  let tcfRegistered = false;
  let unsubscribe: (() => void) | undefined;
  let currentUser: string | null = null;
  const currentProperties: Record<string, string> = {};
  const disableGoogle = (disabled: boolean) => {
    if (/^G-[A-Z0-9]+$/.test(options.measurementId)) {
      (host as unknown as Record<string, unknown>)[`ga-disable-${options.measurementId}`] = disabled;
    }
  };
  const clearAnalyticsCookies = () => {
    const names = ['_ga', ...(/^G-[A-Z0-9]+$/.test(options.measurementId) ? [`_ga_${options.measurementId.slice(2)}`] : [])];
    const domains = new Set(['', host.location.hostname]);
    const hostname = host.location.hostname;
    if (!/^[\d.]+$/.test(hostname) && !hostname.includes(':')) {
      const labels = hostname.split('.');
      for (let i = 1; i < labels.length - 1; i++) domains.add(labels.slice(i).join('.'));
    }
    const paths = new Set(['/']);
    const segments = host.location.pathname.split('/').filter(Boolean);
    for (let i = 1; i <= segments.length; i++) {
      const path = `/${segments.slice(0, i).join('/')}`;
      paths.add(path); paths.add(`${path}/`);
    }
    for (const name of names) for (const domain of domains) for (const path of paths) {
      try {
        doc.cookie = `${name}=; Max-Age=0; Path=${path}${domain ? `; Domain=${domain}` : ''}`;
      } catch { /* Cookie restrictions must not prevent disabling measurement. */ }
    }
  };
  const suspend = () => {
    const wasLocked = locked;
    locked = true;
    disableGoogle(true);
    if (!wasLocked && initialized) {
      try { host.gtag?.('consent', 'update', { analytics_storage: 'denied' }); } catch { /* Remain locked. */ }
    }
    clearAnalyticsCookies();
  };
  const allowed = () => {
    if (!configured || !initialized || locked) return false;
    try {
      const path = publicMeasurementUrl(host.location.href, host.location.origin);
      if (!path || consent.get() !== 'granted') {
        if (started || !path) suspend();
        return false;
      }
      return true;
    } catch { if (started) suspend(); return false; }
  };
  const push = (value: Record<string, unknown>) => host.dataLayer?.push(value);
  const identify = () => host.gtag?.('config', options.measurementId, {
    user_id: currentUser, send_page_view: false,
    client_surface: 'web',
    ...(Object.keys(currentProperties).length ? { user_properties: { ...currentProperties } } : {}),
  });
  const sendEvent = (name: string, params: Record<string, string | number>) => {
    if (!started || !GOOGLE_EVENTS.has(name) || !allowed()) return;
    // The published container owns page_view only. Product events go directly
    // through its Google tag, once, rather than an unconfigured GTM trigger.
    host.gtag?.('event', name, {
      ...params, send_to: options.measurementId, client_surface: 'web',
      page_title: 'MegaRadio',
      page_location: publicMeasurementUrl(host.location.href, host.location.origin)!,
      page_referrer: publicMeasurementReferrer(doc.referrer, host.location.origin) || '',
    });
  };
  const pageView = () => {
    if (!started || !allowed()) return;
    const page = publicMeasurementUrl(host.location.href, host.location.origin)!;
    if (page === lastPage) return;
    const referrer = lastPage || publicMeasurementReferrer(doc.referrer, host.location.origin) || '';
    lastPage = page;
    push({ event: 'megaradio_page_view', page_location: page, page_referrer: referrer });
  };
  const start = () => {
    if (started || !allowed()) return;
    try {
    started = true;
    // Safe defaults must already exist when GTM initialization tags execute.
    push({ page_location: publicMeasurementUrl(host.location.href, host.location.origin),
      page_referrer: publicMeasurementReferrer(doc.referrer, host.location.origin) || '' });
    disableGoogle(false);
    host.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    identify();
    push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const script = doc.createElement('script');
    script.id = 'megaradio-gtm';
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${options.containerId}`;
    doc.head.appendChild(script);
    pageView();
    } catch { suspend(); }
  };
  const initialize = () => {
    if (!configured || initialized || locked) return;
    if (!publicMeasurementUrl(host.location.href, host.location.origin)) { suspend(); return; }
    initialized = true;
    try {
    disableGoogle(true);
    host.__MEGARADIO_GOOGLE_ALLOWED__ = allowed;
    Object.defineProperty(host, '__MEGARADIO_GOOGLE_ALLOWED_VALUE__', { get: allowed, set: undefined, configurable: true });
    host.dataLayer ||= [];
    host.gtag ||= function () { host.dataLayer!.push(arguments); };
    // Before React mounts AdSense. Our opt-in can update analytics only.
    host.gtag('consent', 'default', {
      analytics_storage: 'denied', ad_storage: 'denied',
      ad_user_data: 'denied', ad_personalization: 'denied',
    });
    unsubscribe = consent.subscribe(() => {
      try {
        if (consent.get() !== 'granted') suspend();
        else start();
      } catch { suspend(); }
    });
    const registerTcf = () => {
      if (tcfRegistered || typeof host.__tcfapi !== 'function') return;
      tcfRegistered = true;
      try {
        host.__tcfapi('addEventListener', 2, (data, success) => {
          if (started && (!success || data?.eventStatus === 'cmpuishown' || data?.eventStatus === 'useractioncomplete')) suspend();
        });
      } catch { suspend(); }
    };
    registerTcf();
    const api = host.googlefc ||= {};
    api.callbackQueue ||= [];
    // CMP callbacks may register a conservative stop signal, never grant/start.
    api.callbackQueue.push({ CONSENT_API_READY: registerTcf });
    api.callbackQueue.push({ CONSENT_MODE_DATA_READY: registerTcf });
    start();
    } catch { suspend(); }
  };
  return {
    initialize, suspend,
    isConfigured: () => configured,
    isLocked: () => locked,
    dispose: () => { unsubscribe?.(); unsubscribe = undefined; },
    pageView: () => { initialize(); start(); pageView(); },
    structuredEvent: (name:string,params:Record<string,string|number>={})=>{
      if(!started||!GOOGLE_EVENTS.has(name)||!allowed())return;
      const safe:Record<string,string|number>={};
      for(const key of ['screen_name','playback_state','station_id','station_name','station_country','station_genre','duration_seconds','results_count']){
        const value=params[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e9)safe[key]=value;
        else if(typeof value==='string')safe[key]=value.slice(0,100);
      }
      sendEvent(name,safe);
    },
    user:(id:string|null)=>{
      if(id!==null&&!/^(?:[a-f0-9]{24}|user_[a-zA-Z0-9_-]{1,90})$/i.test(id))return;
      currentUser=id;
      if(started&&allowed())identify();
    },
    property:(name:string,value:string)=>{
      if(!['current_screen','current_station','playback_state'].includes(name))return;
      currentProperties[name]=value.slice(0,36);
      if(started&&allowed())host.gtag?.('set','user_properties',{[name]:currentProperties[name]});
    },
    event: (name: string, value?: number) => {
      // Drop pre-consent events; never queue callbacks with historical payloads.
      if (!started || !GOOGLE_EVENTS.has(name) || !allowed()) return;
      sendEvent(name, typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9 ? { value } : {});
    },
  };
}

// Separate activation gate: an owned container is not a verified GA4 setup.
// Disabled mode never falls back to the old consent-unaware gtag.js loader.
const runtime = typeof window === 'undefined' ? undefined : createGoogleTagManager({
  host: window, document,
  enabled: import.meta.env.VITE_GTM_ENABLED === 'true',
  containerId: import.meta.env.VITE_GTM_CONTAINER_ID ?? MEGARADIO_GTM_ID,
  measurementId: import.meta.env.VITE_GA_MEASUREMENT_ID || '',
});
export const initializeGoogleTagManager = () => runtime?.initialize();
export const suspendGoogleMeasurement = () => runtime?.suspend();
export const isGoogleMeasurementConfigured = (): boolean => runtime?.isConfigured() ?? false;
export const isGoogleMeasurementLocked = (): boolean => runtime?.isLocked() ?? false;
export const googlePageView = () => runtime?.pageView();
export const googleEvent = (name: string, value?: number) => runtime?.event(name, value);

export const googleStructuredEvent=(name:string,params:Record<string,string|number>={})=>runtime?.structuredEvent(name,params);
export const googleUser=(id:string|null)=>runtime?.user(id);
export const googleProperty=(name:string,value:string)=>runtime?.property(name,value);
