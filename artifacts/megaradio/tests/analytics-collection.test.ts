import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {createGoogleTagManager,MEGARADIO_GTM_ID} from '../src/lib/google-tag-manager';
import {createWebAnalyticsConsentStore} from '../src/lib/web-analytics-consent';
let runtime:ReturnType<typeof createGoogleTagManager>;
let consent:ReturnType<typeof createWebAnalyticsConsentStore>;
const host=window as any;
beforeEach(()=>{
 localStorage.clear(); window.history.replaceState({},'', '/tr/faq');
 consent=createWebAnalyticsConsentStore({host:window});
 runtime=createGoogleTagManager({host:window,document,enabled:true,consent,containerId:MEGARADIO_GTM_ID,measurementId:'G-TEST12345'});
});
afterEach(()=>{runtime.dispose();for(const k of ['dataLayer','gtag','googlefc','__MEGARADIO_GOOGLE_ALLOWED__','__MEGARADIO_GOOGLE_ALLOWED_VALUE__','ga-disable-G-TEST12345'])delete host[k];document.querySelectorAll('script[src*="googletagmanager"]').forEach(n=>n.remove());localStorage.clear();});
describe('GA4 production collection boundary',()=>{
 it('drops private search payloads and all diagnostics before explicit consent',()=>{
  runtime.initialize();runtime.structuredEvent('station_play',{station_id:'a',search_query:'private@example.com'} as any);
  expect(document.querySelectorAll('script[src*="googletagmanager"]')).toHaveLength(0);
  expect((host.dataLayer||[]).filter((x:any)=>x[0]==='event')).toHaveLength(0);
  consent.set('granted');runtime.structuredEvent('station_play',{station_id:'a',search_query:'private@example.com'} as any);
  const events=host.dataLayer.filter((x:any)=>x[0]==='event');
  expect(events).toEqual([expect.objectContaining({0:'event',1:'station_play',2:expect.objectContaining({station_id:'a',send_to:'G-TEST12345',client_surface:'web',page_title:'MegaRadio'})})]);
  expect(JSON.stringify(host.dataLayer)).not.toContain('private@example.com');
 });
 it('starts one shared container and strips private URL fields',()=>{
  runtime.initialize();consent.set('granted');runtime.initialize();runtime.pageView();
  window.history.replaceState({},'', '/tr/blog?token=private#secret');runtime.pageView();
  expect(document.querySelectorAll('script[src*="googletagmanager"]')).toHaveLength(1);
  expect(JSON.stringify(host.dataLayer)).not.toContain('token=');
  consent.set('denied');runtime.structuredEvent('station_play',{station_id:'blocked'});
  expect(JSON.stringify(host.dataLayer)).not.toContain('blocked');
 });
});

it('retains only current anonymous account context until consent and clears identity on logout',()=>{
 runtime.user('user_1755717484178_7gbab26j5');runtime.property('playback_state','playing');
 runtime.initialize();
 expect(host.dataLayer.filter((x:any)=>x[0]==='config')).toHaveLength(0);
 consent.set('granted');
 const configs=()=>host.dataLayer.filter((x:any)=>x[0]==='config').map((x:any)=>x[2]);
 expect(configs().at(-1)).toMatchObject({user_id:'user_1755717484178_7gbab26j5',send_page_view:false,user_properties:{playback_state:'playing'}});
 runtime.user('private@example.com');expect(configs()).toHaveLength(1);
 runtime.user(null);expect(configs().at(-1).user_id).toBeNull();
 runtime.structuredEvent('station_play',{station_id:'a'});
 expect(host.dataLayer.filter((x:any)=>x.event==='megaradio_event')).toHaveLength(0);
 expect(host.dataLayer.filter((x:any)=>x[0]==='event')).toHaveLength(1);
 consent.set('denied');runtime.event('station_play');
 expect(host.dataLayer.filter((x:any)=>x[0]==='event')).toHaveLength(1);
});
