import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { setDatabaseUrlTranslations } from '@workspace/seo-shared/url-translations';
import { createGoogleTagManager, publicMeasurementUrl, publicMeasurementReferrer, MEGARADIO_GTM_ID,
  isGoogleMeasurementConfigured, isGoogleMeasurementLocked } from '../src/lib/google-tag-manager';
import { createWebAnalyticsConsentStore, WEB_ANALYTICS_CONSENT_KEY, WEB_ANALYTICS_CONSENT_MAX_AGE_MS } from '../src/lib/web-analytics-consent';

const host = window as any;
let status: number | undefined;
let callbacks: Record<string, () => void>[];
let tcf: ((data: {eventStatus?: string}, success: boolean) => void) | undefined;
let consent: ReturnType<typeof createWebAnalyticsConsentStore>;
const runtimes: ReturnType<typeof createGoogleTagManager>[] = [];
const scriptCount = () => document.querySelectorAll('script[src*="googletagmanager"]').length;
const events = (type: string) => (host.dataLayer || []).filter((item: any) => item.event === type);
const productEvents = () => (host.dataLayer || []).filter((item: any) => item[0] === 'event').map((item: any) => ({name:item[1], params:item[2]}));
const consentReady = () => expect(consent.set('granted')).toBe(true);
const safeDefaults = () => host.dataLayer.find((item: any) => item.page_location && !item.event);
const updates = () => host.dataLayer.filter((item: any) => item[0] === 'consent' && item[1] === 'update').map((item: any) => item[2]);
const create = (overrides = {}) => {
  const runtime = createGoogleTagManager({host: window, document, enabled: true, consent,
    containerId: MEGARADIO_GTM_ID, measurementId: 'G-TEST12345', ...overrides});
  runtimes.push(runtime);
  return runtime;
};
beforeEach(() => {
  localStorage.clear();
  consent = createWebAnalyticsConsentStore({host: window});
  window.history.replaceState({}, '', '/tr/faq');
  status = 1; callbacks = []; tcf = undefined;
  host.googlefc = { callbackQueue: callbacks, getGoogleConsentModeValues: () => ({analyticsStoragePurposeConsentStatus: status}) };
  host.__tcfapi = vi.fn((_cmd, _version, callback) => { tcf = callback; });
  document.querySelectorAll('script[src*="googletagmanager"]').forEach(node => node.remove());
});
afterEach(() => {
  runtimes.splice(0).forEach(runtime => runtime.dispose());
  setDatabaseUrlTranslations(new Map());
  for (const key of ['dataLayer','gtag','googlefc','__tcfapi','__MEGARADIO_GOOGLE_ALLOWED__','__MEGARADIO_GOOGLE_ALLOWED_VALUE__','ga-disable-G-TEST12345']) delete host[key];
  for (const key of Object.keys(host).filter(key => key.startsWith('ga-disable-G-'))) delete host[key];
  document.querySelectorAll('script[src*="googletagmanager"]').forEach(node => node.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  document.cookie.split(';').forEach(cookie => { document.cookie = `${cookie.split('=')[0].trim()}=; Max-Age=0; Path=/`; });
});

it.each([
  {enabled: false}, {containerId: ''}, {containerId: 'G-OTHER'}, {containerId: 'GTM-X&evil=1'},
  {measurementId: ''}, {measurementId: 'AW-12345'},
])('does nothing for disabled or invalid release configuration: %j', config => {
  const runtime = create(config); runtime.initialize(); runtime.pageView(); runtime.event('station_play');
  expect(scriptCount()).toBe(0); expect(host.dataLayer).toBeUndefined(); expect(callbacks).toHaveLength(0);
  expect(Object.getOwnPropertyDescriptor(host, '__MEGARADIO_GOOGLE_ALLOWED_VALUE__')).toBeUndefined();
});

it('registers once and places denied defaults before any container or event', () => {
  const existing = {event: 'existing'};
  host.dataLayer = [existing];
  const runtime = create(); runtime.initialize(); runtime.initialize(); runtime.pageView();
  expect(host.dataLayer[0]).toBe(existing);
  expect(Array.from(host.dataLayer[1])).toEqual(['consent','default',{
    analytics_storage:'denied', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied',
  }]);
  expect(scriptCount()).toBe(0); expect(callbacks).toHaveLength(2);
  expect(host['ga-disable-G-TEST12345']).toBe(true);
  consentReady(); runtime.initialize(); consentReady(); runtime.pageView();
  expect(scriptCount()).toBe(1);
  const script = document.getElementById('megaradio-gtm') as HTMLScriptElement;
  expect(script.src).toBe(`https://www.googletagmanager.com/gtm.js?id=${MEGARADIO_GTM_ID}`);
  expect(script.type).not.toBe('text/partytown');
  expect(events('gtm.js')).toHaveLength(1); expect(events('megaradio_page_view')).toHaveLength(1);
  expect(host['ga-disable-G-TEST12345']).toBe(false);
});

it.each([0,1,2,3,4,undefined,5,NaN])('never infers our opt-in from CMP value: %s', value => {
  status = value; const runtime = create(); runtime.initialize();
  callbacks.forEach(entry => Object.values(entry).forEach(callback => callback()));
  runtime.pageView(); runtime.event('station_play');
  expect(scriptCount()).toBe(0); expect(events('megaradio_page_view')).toHaveLength(0); expect(productEvents()).toHaveLength(0);
});

it.each([0,1,2,3,undefined])('accepts only our explicit grant independently of CMP state %s, without granting Ads', value => {
  status = value; const runtime = create(); runtime.initialize(); consentReady();
  expect(scriptCount()).toBe(1);
  expect(updates()).toEqual([{analytics_storage:'granted'}]);
});

it('requires our opt-in but works when the CMP is missing or its analytics getter throws', () => {
  delete host.googlefc;
  const runtime = create(); runtime.initialize();
  runtime.pageView(); expect(scriptCount()).toBe(0);
  host.googlefc.getGoogleConsentModeValues = () => {throw new Error('CMP unavailable');};
  consentReady(); runtime.pageView(); expect(scriptCount()).toBe(1);
});

it('drops pre-consent events and starts with the current page, not the original page', () => {
  const runtime = create(); runtime.initialize(); runtime.event('station_play',1);
  window.history.replaceState({}, '', '/tr/istasyon/kral-fm?utm_source=ai#player'); runtime.pageView();
  consentReady();
  expect(productEvents()).toHaveLength(0);
  expect(events('megaradio_page_view')).toEqual([{event:'megaradio_page_view',page_location:`${location.origin}/tr/istasyon/kral-fm`,page_referrer:''}]);
});

it('drops historical search events and payloads until a verified opt-in', () => {
  const runtime = create(); runtime.initialize();
  runtime.event('search',8); runtime.event('station_play',1);
  expect(productEvents()).toHaveLength(0);
  consentReady(); runtime.event('search',2);
  expect(productEvents()).toEqual([expect.objectContaining({name:'search',params:expect.objectContaining({value:2,send_to:'G-TEST12345',client_surface:'web'})})]);
});

it('can observe a later initial opt-in, but never replays pre-consent events', () => {
  const runtime = create(); runtime.initialize(); runtime.event('station_play',1);
  window.history.replaceState({}, '', '/tr/faq'); consentReady(); runtime.pageView();
  expect(scriptCount()).toBe(1); expect(events('megaradio_page_view')).toHaveLength(1); expect(productEvents()).toHaveLength(0);
});

it('deduplicates repeated views but counts A to B to A, stripping query and fragment', () => {
  const runtime = create(); runtime.initialize(); consentReady(); runtime.pageView();
  window.history.replaceState({}, '', '/tr/blog?ref=private#secret'); runtime.pageView(); runtime.pageView();
  window.history.replaceState({}, '', '/tr/faq'); runtime.pageView();
  expect(events('megaradio_page_view').map((event: any) => event.page_location)).toEqual([
    `${location.origin}/tr/faq`, `${location.origin}/tr/blog`, `${location.origin}/tr/faq`,
  ]);
  expect(events('megaradio_page_view')[2].page_referrer).toBe(`${location.origin}/tr/blog`);
});

it.each([
  ['/en', '/en/radios', null], ['/tr', '/tr/radyo', null], ['/de', '/de/radios', null],
  ['/tr', '/tr/radyolar', 'radyolar'],
])('counts home to radios to home without duplicates or locking: %s %s', (home, radios, translation) => {
  if (translation) setDatabaseUrlTranslations(new Map([['tr:radios', translation]]));
  window.history.replaceState({}, '', home);
  const runtime = create(); runtime.initialize(); consentReady(); runtime.pageView();
  window.history.replaceState({}, '', `${radios}?utm_source=PRIVATE&q=RAW_SEARCH#SECRET`);
  runtime.pageView(); runtime.pageView();
  window.history.replaceState({}, '', home); runtime.pageView(); runtime.pageView();
  expect(events('megaradio_page_view')).toEqual([
    {event:'megaradio_page_view',page_location:`${location.origin}${home}`,page_referrer:''},
    {event:'megaradio_page_view',page_location:`${location.origin}${radios}`,page_referrer:`${location.origin}${home}`},
    {event:'megaradio_page_view',page_location:`${location.origin}${home}`,page_referrer:`${location.origin}${radios}`},
  ]);
  expect(host.__MEGARADIO_GOOGLE_ALLOWED__()).toBe(true);
  expect(host['ga-disable-G-TEST12345']).toBe(false); expect(scriptCount()).toBe(1);
});

it.each(['https://bing.com', 'https://www.bing.com'])('sanitizes Bing in pre-GTM defaults and the initial view: %s', origin => {
  const referrer = `${origin}/search/private?q=RAW_SEARCH&token=SECRET&utm_source=PRIVATE#SECRET_HASH`;
  vi.spyOn(document, 'referrer', 'get').mockReturnValue(referrer);
  const runtime = create(); runtime.initialize(); consentReady(); runtime.pageView();
  expect(safeDefaults()).toEqual({page_location:`${location.origin}/tr/faq`,page_referrer:origin});
  expect(host.dataLayer.indexOf(safeDefaults())).toBeLessThan(host.dataLayer.findIndex((item: any) => item.event === 'gtm.js'));
  expect(events('megaradio_page_view')).toEqual([
    {event:'megaradio_page_view',page_location:`${location.origin}/tr/faq`,page_referrer:origin},
  ]);
  window.history.replaceState({}, '', '/tr/radyo'); runtime.pageView();
  expect(events('megaradio_page_view')[1].page_referrer).toBe(`${location.origin}/tr/faq`);
  expect(JSON.stringify(host.dataLayer)).not.toMatch(/RAW_SEARCH|SECRET|PRIVATE|utm_source/);
  expect(publicMeasurementUrl(referrer, location.origin)).toBeNull();
});

it.each(['cmpuishown','useractioncomplete'])('locks this document when the CMP signals %s', eventStatus => {
  const runtime = create(); runtime.initialize(); consentReady(); tcf!({eventStatus},true);
  runtime.event('station_play',1); consentReady(); runtime.pageView();
  expect(host['ga-disable-G-TEST12345']).toBe(true); expect(host.__MEGARADIO_GOOGLE_ALLOWED__()).toBe(false);
  expect(productEvents()).toHaveLength(0); expect(events('megaradio_page_view')).toHaveLength(1);
});

it('locks before the privacy panel and cannot reenable in the same document', () => {
  const runtime = create(); runtime.initialize(); consentReady(); runtime.suspend();
  status = 1; consentReady(); runtime.event('station_play',1); runtime.pageView();
  expect(host['ga-disable-G-TEST12345']).toBe(true); expect(productEvents()).toHaveLength(0);
});

it('locks on our later denial and cannot resume after a saved regrant', () => {
  const runtime = create(); runtime.initialize(); consentReady(); expect(consent.set('denied')).toBe(true);
  consentReady(); runtime.pageView(); runtime.event('station_play',1);
  expect(host.__MEGARADIO_GOOGLE_ALLOWED__()).toBe(false);
  expect(runtime.isLocked()).toBe(true); expect(scriptCount()).toBe(1);
  expect(events('megaradio_page_view')).toHaveLength(1); expect(productEvents()).toHaveLength(0);
  expect(updates()).toEqual([{analytics_storage:'granted'}, {analytics_storage:'denied'}]);
});

it('fails closed without breaking app startup when CMP registration throws', () => {
  host.googlefc.callbackQueue = {push: () => {throw new Error('CMP callback unavailable');}};
  const runtime = create();
  expect(() => runtime.initialize()).not.toThrow();
  expect(scriptCount()).toBe(0); expect(host['ga-disable-G-TEST12345']).toBe(true);
});

it('ignores CMP analytics getters but locks a loaded tag on a TCF error', () => {
  const runtime = create(); runtime.initialize(); consentReady();
  host.googlefc.getGoogleConsentModeValues = () => {throw new Error('CMP failed');};
  runtime.event('station_play',1);
  expect(host['ga-disable-G-TEST12345']).toBe(false);
  expect(productEvents()).toHaveLength(1);
  tcf!({},false);
  expect(host.__MEGARADIO_GOOGLE_ALLOWED__()).toBe(false);
});

it('registers a delayed TCF API once without inferring analytics from its purposes', () => {
  delete host.__tcfapi;
  const runtime = create(); runtime.initialize();
  host.__tcfapi = vi.fn((_cmd, _version, callback) => { tcf = callback; });
  const notify = callbacks.find(entry => entry.CONSENT_API_READY)!.CONSENT_API_READY;
  notify(); notify(); expect(host.__tcfapi).toHaveBeenCalledTimes(1);
  tcf!({eventStatus:'tcloaded'},true); expect(scriptCount()).toBe(0);
});

it.each(['/tr/profil/ayarlar', '/en/radios/private', '/tr/radyo/private', '/tr/radyolar/private'])('does not resume after public to private to public SPA navigation: %s', path => {
  const runtime = create(); runtime.initialize(); consentReady();
  window.history.replaceState({}, '', path); runtime.pageView();
  window.history.replaceState({}, '', '/tr/radyo'); runtime.pageView();
  expect(events('megaradio_page_view')).toHaveLength(1); expect(host['ga-disable-G-TEST12345']).toBe(true);
});

it('does not start if navigation becomes private before delayed consent', () => {
  const runtime = create(); runtime.initialize();
  window.history.replaceState({}, '', '/admin/users'); consentReady();
  expect(scriptCount()).toBe(0);
});

it('sends only allowlisted event names and finite bounded numbers', () => {
  const runtime = create(); runtime.initialize(); consentReady();
  runtime.event('search',8); runtime.event('station_play',Infinity); runtime.event('login',1); runtime.event('email@example.com',1);
  expect(productEvents()).toEqual([
    expect.objectContaining({name:'search',params:expect.objectContaining({value:8})}), expect.objectContaining({name:'station_play'}),
  ]);
});

it.each(['/admin','/admin-login','/en/admin','/tr/profil/ayarlar','/en/login','/en/reset-password?token=SECRET',
  '/tr/search?q=private@email.test','/en/faq?access_token=SECRET','/en/faq?code=SECRET','/unknown','/am/faq',
  '/radios','/radyolar','/en/radios/private','/tr/radyo/private','/tr/radyolar/private','/de/radios/private',
  '/en/radios-private','/tr/radyo-ozel','/tr/radyolar-ozel','/en/radios?token=SECRET','/tr/radyo?code=SECRET'])('excludes private/unsupported URL %s', path => {
  expect(publicMeasurementUrl(path, location.origin)).toBeNull();
  window.history.replaceState({}, '', path); const runtime = create(); runtime.initialize(); expect(callbacks).toHaveLength(0); expect(scriptCount()).toBe(0);
});

it.each(['/en','/tr/faq','/de/sender/test-station','/ar/anwaa','/tr/blog/test-post',
  '/en/radios','/tr/radyo','/de/radios'])('accepts public localized URL %s without query/fragment', path => {
  expect(publicMeasurementUrl(`${path}?utm_source=AI#heading`, location.origin)).toBe(`${location.origin}${path}`);
});

it('accepts only the exact configured localized radios path through reverse translation', () => {
  setDatabaseUrlTranslations(new Map([['tr:radios', 'radyolar']]));
  expect(publicMeasurementUrl('/tr/radyolar?q=RAW_SEARCH&utm_source=PRIVATE#SECRET', location.origin)).toBe(`${location.origin}/tr/radyolar`);
  for (const path of ['/tr/radyolar/private', '/tr/radyolar-ozel', '/tr/radyolar?token=SECRET', '/tr/profil/ayarlar']) {
    expect(publicMeasurementUrl(path, location.origin)).toBeNull();
  }
});

it.each(['', '/', '/en', '/tr/radyo?q=RAW_SEARCH&utm_source=PRIVATE#SECRET',
  'tr/faq?q=RAW_SEARCH#SECRET', '/tr/profil/ayarlar', '/en/faq?token=SECRET',
  `${location.origin}/en/radios?q=RAW_SEARCH#SECRET`])('preserves same-origin public referrer sanitation: %s', raw => {
  expect(publicMeasurementReferrer(raw, location.origin)).toBe(publicMeasurementUrl(raw, location.origin));
});

it('keeps an empty document referrer empty rather than attributing it to home', () => {
  expect(publicMeasurementReferrer('', location.origin)).toBeNull();
  vi.spyOn(document, 'referrer', 'get').mockReturnValue('');
  const runtime = create(); runtime.initialize(); consentReady();
  expect(safeDefaults().page_referrer).toBe('');
  expect(events('megaradio_page_view')[0].page_referrer).toBe('');
});

it.each(['https://bing.com', 'https://www.bing.com', 'https://BING.com:443', 'https://www.bing.com:443'])('returns only the parsed allowlisted Bing origin: %s', origin => {
  expect(publicMeasurementReferrer(`${origin}/search?q=RAW_SEARCH&token=SECRET#SECRET`, location.origin)).toBe(new URL(origin).origin);
});

it.each([
  'http://bing.com/search', 'http://www.bing.com/search',
  'https://bing.com:80/search', 'https://bing.com:444/search', 'https://www.bing.com:8443/search',
  'https://images.bing.com/search', 'https://www.bing.com.evil.test/search', 'https://bing.com.evil.test/search',
  'https://evilbing.com/search', 'https://bing-com.test/search', 'https://bing.com./search',
  'https://google.com/search', 'https://evil.test/en/radios',
  'https://user@bing.com/search', 'https://:SECRET@www.bing.com/search',
  'https://user:SECRET@bing.com/search', 'https://bing.com@evil.test/search',
  'https://evil.test@www.bing.com/search',
  `${location.origin.replace('://', '://user:SECRET@')}/en/radios`,
  'javascript:alert(1)', 'data:text/plain,https://bing.com', 'ftp://bing.com/search',
  'blob:https://bing.com/id', 'https://[invalid',
])('rejects hostile referrers in the helper, defaults and initial view: %s', raw => {
  expect(publicMeasurementReferrer(raw, location.origin)).toBeNull();
  vi.spyOn(document, 'referrer', 'get').mockReturnValue(raw);
  const runtime = create(); runtime.initialize(); consentReady();
  expect(safeDefaults().page_referrer).toBe('');
  expect(events('megaradio_page_view')[0].page_referrer).toBe('');
});

it('keeps Google queues on the main thread, has no noscript tracker or legacy gtag loader', () => {
  const html = readFileSync(`${process.cwd()}/index.html`,'utf8');
  expect(html).toContain("forward: ['clarity']");
  expect(html).not.toMatch(/forward:\s*\[[^\]]*(?:dataLayer|gtag)/);
  expect(html).not.toContain('ns.html?id=GTM-');
  const analytics = readFileSync(`${process.cwd()}/src/lib/analytics.ts`,'utf8');
  expect(analytics).not.toMatch(/gtag\(|gtag\/js|8000/);
});

it('exposes configuration and document-lock queries without activating disabled build flags', () => {
  expect(typeof isGoogleMeasurementConfigured()).toBe('boolean');
  expect(isGoogleMeasurementLocked()).toBe(false);
  const disabled = create({enabled:false}); disabled.initialize();
  expect(disabled.isConfigured()).toBe(false); expect(disabled.isLocked()).toBe(false);
  expect(host.dataLayer).toBeUndefined(); expect(scriptCount()).toBe(0);
  const runtime = create(); expect(runtime.isConfigured()).toBe(true);
  runtime.suspend(); expect(runtime.isLocked()).toBe(true);
});

it.each(['/en/faq', '/tr/blog/test-post'])('starts directly on public content with a verified stored opt-in, without CMP/TCF: %s', path => {
  consentReady(); delete host.googlefc; delete host.__tcfapi;
  window.history.replaceState({}, '', path);
  const runtime = create(); runtime.initialize(); runtime.initialize(); runtime.pageView();
  expect(scriptCount()).toBe(1); expect(events('megaradio_page_view')).toHaveLength(1);
  expect(Array.from(host.dataLayer[0])).toEqual(['consent','default',{
    analytics_storage:'denied', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied',
  }]);
  expect(updates()).toEqual([{analytics_storage:'granted'}]);
  expect(host.dataLayer.indexOf(safeDefaults())).toBeLessThan(host.dataLayer.findIndex((item: any) => item[1] === 'update'));
});

it('does not treat a previously saved denial as an irrevocable lock before a new explicit opt-in', () => {
  expect(consent.set('denied')).toBe(true);
  const runtime = create(); runtime.initialize();
  expect(runtime.isLocked()).toBe(false); expect(scriptCount()).toBe(0);
  consentReady(); expect(scriptCount()).toBe(1);
});

it('locks and disables synchronously before a denial write, even when persistence fails', () => {
  const runtime = create(); runtime.initialize(); consentReady();
  document.cookie = '_ga=shared; Path=/'; document.cookie = '_ga_TEST12345=stream; Path=/';
  const original = Storage.prototype.setItem;
  let atWrite: unknown;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === WEB_ANALYTICS_CONSENT_KEY && JSON.parse(value).choice === 'denied') {
      atWrite = {locked:runtime.isLocked(),disabled:host['ga-disable-G-TEST12345'],
        consent:consent.get(),update:updates().at(-1),cookies:document.cookie};
      throw new Error('Storage blocked');
    }
    return original.call(this, key, value);
  });
  expect(consent.set('denied')).toBe(false);
  expect(atWrite).toEqual({locked:true,disabled:true,consent:'denied',update:{analytics_storage:'denied'},cookies:''});
  runtime.event('station_play',1); runtime.pageView();
  expect(productEvents()).toHaveLength(0); expect(events('megaradio_page_view')).toHaveLength(1);
});

it.each(['G-3X2WGQC0J3', 'G-OTHER999'])('cleans only _ga and the exact configured stream cookie on revocation: %s', measurementId => {
  const stream = `_ga_${measurementId.slice(2)}`;
  const other = measurementId === 'G-3X2WGQC0J3' ? '_ga_OTHER999' : '_ga_3X2WGQC0J3';
  const runtime = create({measurementId}); runtime.initialize(); consentReady();
  document.cookie = '_ga=shared; Path=/';
  document.cookie = `${stream}=stream; Path=/tr; Domain=localhost`;
  const protectedNames = [other, '_ga_NOT_THIS_STREAM', '_gid', '_gcl_au', 'auth', 'FCNEC', 'cmp_consent'];
  protectedNames.forEach(name => { document.cookie = `${name}=keep; Path=/`; });
  const writes = vi.spyOn(document, 'cookie', 'set');
  expect(consent.set('denied')).toBe(true);
  const remaining = document.cookie.split(';').map(cookie => cookie.trim().split('=')[0]);
  expect(remaining).not.toContain('_ga'); expect(remaining).not.toContain(stream);
  protectedNames.forEach(name => expect(remaining).toContain(name));
  expect(writes.mock.calls.every(([cookie]) => ['_ga', stream].includes(cookie.split('=')[0]))).toBe(true);
  expect(host[`ga-disable-${measurementId}`]).toBe(true);
  expect(updates()).toEqual([{analytics_storage:'granted'}, {analytics_storage:'denied'}]);
});

it.each(['denied', 'remove', 'clear'])('locks on cross-tab %s and never reopens on a later cross-tab grant', change => {
  const runtime = create(); runtime.initialize(); consentReady();
  if (change === 'clear') localStorage.clear();
  else if (change === 'remove') localStorage.removeItem(WEB_ANALYTICS_CONSENT_KEY);
  else localStorage.setItem(WEB_ANALYTICS_CONSENT_KEY, JSON.stringify({version:1,choice:'denied',updatedAt:Date.now()}));
  window.dispatchEvent(new StorageEvent('storage', {key:change === 'clear' ? null : WEB_ANALYTICS_CONSENT_KEY}));
  expect(runtime.isLocked()).toBe(true); expect(host['ga-disable-G-TEST12345']).toBe(true);
  localStorage.setItem(WEB_ANALYTICS_CONSENT_KEY, JSON.stringify({version:1,choice:'granted',updatedAt:Date.now()}));
  window.dispatchEvent(new StorageEvent('storage', {key:WEB_ANALYTICS_CONSENT_KEY}));
  callbacks.forEach(entry => Object.values(entry).forEach(callback => callback()));
  runtime.pageView(); runtime.event('station_play',1);
  expect(events('megaradio_page_view')).toHaveLength(1); expect(productEvents()).toHaveLength(0);
  expect(updates()).toEqual([{analytics_storage:'granted'}, {analytics_storage:'denied'}]);
});

it.each(['denied', 'clear'])('locks an external %s even if another listener subscribes before the storage event', change => {
  const runtime = create(); runtime.initialize(); consentReady();
  if (change === 'clear') localStorage.clear();
  else localStorage.setItem(WEB_ANALYTICS_CONSENT_KEY, JSON.stringify({version:1,choice:'denied',updatedAt:Date.now()}));
  const added = vi.fn();
  const unsubscribe = consent.subscribe(added);
  try {
    // Do not evaluate the gate first: that would hide a missed notification.
    expect(runtime.isLocked()).toBe(true);
    expect(host['ga-disable-G-TEST12345']).toBe(true);
    expect(updates()).toEqual([{analytics_storage:'granted'}, {analytics_storage:'denied'}]);
    expect(added).toHaveBeenCalledOnce();
    window.dispatchEvent(new StorageEvent('storage', {key:change === 'clear' ? null : WEB_ANALYTICS_CONSENT_KEY}));
    consentReady(); runtime.pageView(); runtime.event('station_play',1);
    expect(runtime.isLocked()).toBe(true); expect(host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe(false);
    expect(events('megaradio_page_view')).toHaveLength(1); expect(productEvents()).toHaveLength(0);
    expect(scriptCount()).toBe(1);
    expect(updates()).toEqual([{analytics_storage:'granted'}, {analytics_storage:'denied'}]);
  } finally { unsubscribe(); }
});

it('persists regrant for a new document without reloading or resuming the locked document', () => {
  const runtime = create(); runtime.initialize(); consentReady();
  expect(consent.set('denied')).toBe(true); consentReady();
  expect(consent.get()).toBe('granted'); expect(runtime.isLocked()).toBe(true);
  runtime.pageView(); expect(events('megaradio_page_view')).toHaveLength(1);
  runtime.dispose(); document.getElementById('megaradio-gtm')!.remove();
  delete host.dataLayer; delete host.gtag;
  const next = create({consent:createWebAnalyticsConsentStore({host:window})}); next.initialize();
  expect(next.isLocked()).toBe(false); expect(scriptCount()).toBe(1);
  expect(events('megaradio_page_view')).toHaveLength(1);
});

it.each(['decision', 'idle', 'visibility'])('locks an expired opt-in during %s without waiting for navigation', mode => {
  vi.useFakeTimers({now:Date.UTC(2026,10,3)});
  const runtime = create(); runtime.initialize(); consentReady();
  if (mode === 'idle') vi.advanceTimersByTime(WEB_ANALYTICS_CONSENT_MAX_AGE_MS);
  else {
    vi.setSystemTime(Date.now() + WEB_ANALYTICS_CONSENT_MAX_AGE_MS);
    if (mode === 'visibility') document.dispatchEvent(new Event('visibilitychange'));
    else runtime.event('station_play',1);
  }
  expect(runtime.isLocked()).toBe(true); expect(host['ga-disable-G-TEST12345']).toBe(true);
  expect(productEvents()).toHaveLength(0);
  expect(updates()).toEqual([{analytics_storage:'granted'}, {analytics_storage:'denied'}]);
});

it.each(['malformed', 'future', 'expired'])('never starts from a %s stored grant', kind => {
  const updatedAt = kind === 'future' ? Date.now() + 60_000 : Date.now() - WEB_ANALYTICS_CONSENT_MAX_AGE_MS;
  localStorage.setItem(WEB_ANALYTICS_CONSENT_KEY, kind === 'malformed' ? '{invalid' : JSON.stringify({version:1,choice:'granted',updatedAt}));
  const runtime = create(); runtime.initialize(); runtime.pageView(); runtime.event('station_play',1);
  expect(scriptCount()).toBe(0); expect(updates()).toEqual([]); expect(productEvents()).toHaveLength(0);
});

it('requires successful opt-in persistence before loading GTM', () => {
  const runtime = create(); runtime.initialize();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
  expect(consent.set('granted')).toBe(false);
  expect(runtime.isLocked()).toBe(true); expect(scriptCount()).toBe(0);
  expect(updates()).toEqual([{analytics_storage:'denied'}]);
});

it('fails closed on later storage read errors, without relying on CMP state', () => {
  const runtime = create(); runtime.initialize(); consentReady();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
  runtime.event('station_play',1);
  expect(runtime.isLocked()).toBe(true); expect(productEvents()).toHaveLength(0);
  expect(updates().at(-1)).toEqual({analytics_storage:'denied'});
});

it('keeps revocation effective if browser cookie deletion is blocked', () => {
  const runtime = create(); runtime.initialize(); consentReady();
  vi.spyOn(document, 'cookie', 'set').mockImplementation(() => { throw new Error('Cookie access blocked'); });
  expect(consent.set('denied')).toBe(true);
  expect(runtime.isLocked()).toBe(true); expect(host['ga-disable-G-TEST12345']).toBe(true);
  expect(updates().at(-1)).toEqual({analytics_storage:'denied'});
});

it('keeps an initially private document locked even when it later navigates public and grants', () => {
  window.history.replaceState({}, '', '/tr/profil/ayarlar');
  const runtime = create(); runtime.initialize();
  window.history.replaceState({}, '', '/tr/faq'); consentReady(); runtime.pageView();
  expect(runtime.isLocked()).toBe(true); expect(scriptCount()).toBe(0);
});

it('locks private SPA navigation before an initial grant and never replays events after returning public', () => {
  const runtime = create(); runtime.initialize(); runtime.event('station_play',1);
  window.history.replaceState({}, '', '/tr/profil/ayarlar'); runtime.pageView();
  window.history.replaceState({}, '', '/tr/blog'); consentReady(); runtime.pageView();
  expect(runtime.isLocked()).toBe(true); expect(scriptCount()).toBe(0);
  expect(productEvents()).toHaveLength(0);
});

it('exposes a configurable read-only live boolean getter, preserving the function contract', () => {
  const runtime = create(); runtime.initialize();
  const descriptor = Object.getOwnPropertyDescriptor(host, '__MEGARADIO_GOOGLE_ALLOWED_VALUE__')!;
  expect(descriptor.get).toBe(host.__MEGARADIO_GOOGLE_ALLOWED__);
  expect(descriptor.set).toBeUndefined(); expect(descriptor.configurable).toBe(true);
  expect(descriptor.enumerable).toBe(false); expect(descriptor).not.toHaveProperty('value');
  expect(descriptor).not.toHaveProperty('writable');
  expect(typeof host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe('boolean');
  expect(host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe(false);
  expect(runtime.isLocked()).toBe(false); expect(scriptCount()).toBe(0);
  expect(Reflect.set(host, '__MEGARADIO_GOOGLE_ALLOWED_VALUE__', true)).toBe(false);
  expect(host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe(false);
  consentReady(); runtime.initialize();
  expect(host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe(true);
  expect(host.__MEGARADIO_GOOGLE_ALLOWED__()).toBe(true);
  expect(Object.getOwnPropertyDescriptor(host, '__MEGARADIO_GOOGLE_ALLOWED_VALUE__')!.get).toBe(descriptor.get);
  expect(Reflect.set(host, '__MEGARADIO_GOOGLE_ALLOWED_VALUE__', false)).toBe(false);
  expect(host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe(true);
});

it('installs the boolean getter before appending GTM for a stored grant', () => {
  consentReady();
  const original = document.head.appendChild;
  let atAppend: unknown;
  vi.spyOn(document.head, 'appendChild').mockImplementation(function (node) {
    atAppend = {value:host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__,
      getter:Object.getOwnPropertyDescriptor(host, '__MEGARADIO_GOOGLE_ALLOWED_VALUE__')?.get,
      scriptCount:scriptCount()};
    return original.call(this, node);
  });
  const runtime = create(); runtime.initialize();
  expect(atAppend).toEqual({value:true,getter:host.__MEGARADIO_GOOGLE_ALLOWED__,scriptCount:0});
  expect(scriptCount()).toBe(1); expect(events('megaradio_page_view')).toHaveLength(1);
});

it.each(['accessor', 'snapshot'])('replaces a configurable %s with the read-only live getter', kind => {
  const setter = vi.fn();
  Object.defineProperty(host, '__MEGARADIO_GOOGLE_ALLOWED_VALUE__', kind === 'accessor'
    ? {get:() => true,set:setter,configurable:true}
    : {value:true,writable:true,configurable:true});
  const runtime = create(); runtime.initialize();
  const descriptor = Object.getOwnPropertyDescriptor(host, '__MEGARADIO_GOOGLE_ALLOWED_VALUE__')!;
  expect(descriptor.get).toBe(host.__MEGARADIO_GOOGLE_ALLOWED__);
  expect(descriptor.set).toBeUndefined(); expect(descriptor).not.toHaveProperty('value');
  expect(host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe(false);
  expect(Reflect.set(host, '__MEGARADIO_GOOGLE_ALLOWED_VALUE__', true)).toBe(false);
  expect(setter).not.toHaveBeenCalled();
  consentReady(); expect(host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe(true);
});

it.each(['denied', 'suspend', 'private'])('reads false immediately on %s and cannot reopen a locked document', change => {
  const runtime = create(); runtime.initialize(); consentReady();
  expect(host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe(true);
  if (change === 'denied') expect(consent.set('denied')).toBe(true);
  else if (change === 'suspend') runtime.suspend();
  else window.history.replaceState({}, '', '/tr/profil/ayarlar');
  // Native GTM variable evaluation itself must enforce private-route locking.
  expect(host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe(false);
  expect(host.__MEGARADIO_GOOGLE_ALLOWED__()).toBe(false);
  expect(runtime.isLocked()).toBe(true); expect(host['ga-disable-G-TEST12345']).toBe(true);
  window.history.replaceState({}, '', '/tr/faq'); consentReady(); runtime.pageView();
  expect(typeof host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe('boolean');
  expect(host.__MEGARADIO_GOOGLE_ALLOWED_VALUE__).toBe(false);
  expect(events('megaradio_page_view')).toHaveLength(1); expect(scriptCount()).toBe(1);
});

it.each([false, true])('fails closed without loading GTM if getter definition is blocked, stored grant: %s', granted => {
  if (granted) consentReady();
  const blockedHost = {location:window.location} as Window;
  Object.defineProperty(blockedHost, '__MEGARADIO_GOOGLE_ALLOWED_VALUE__', {value:false,configurable:false});
  const runtime = create({host:blockedHost});
  expect(() => runtime.initialize()).not.toThrow();
  expect(runtime.isLocked()).toBe(true);
  expect((blockedHost as any)['ga-disable-G-TEST12345']).toBe(true);
  expect((blockedHost as any).__MEGARADIO_GOOGLE_ALLOWED__()).toBe(false);
  expect((blockedHost as any).dataLayer).toBeUndefined();
  consentReady(); runtime.pageView(); runtime.event('station_play',1);
  expect(scriptCount()).toBe(0); expect(events('gtm.js')).toHaveLength(0);
  expect(events('megaradio_page_view')).toHaveLength(0); expect(productEvents()).toHaveLength(0);
});
