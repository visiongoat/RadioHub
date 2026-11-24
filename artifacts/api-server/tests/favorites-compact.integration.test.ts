import assert from 'node:assert/strict';
import {before,after,describe,it} from 'node:test';
import {createNativePostgresFixture} from './helpers/native-postgres-fixture';

describe('favorites compact SQL preserves native playback and legacy favorites',{skip:!process.env.PG_TEST_DATABASE_URL},()=>{
 let fixture:Awaited<ReturnType<typeof createNativePostgresFixture>>;
 let engagement:typeof import('../src/data/postgres-engagement-store');
 let catalog:typeof import('../src/data/station-read-store');
 const playback={urlHigh:'https://stream.invalid/hd',urlLow:'https://stream.invalid/sd',url_high:'https://legacy.invalid/hd',url_low:'https://legacy.invalid/sd',urlBackup:'https://stream.invalid/backup',url_backup:'https://legacy.invalid/backup',urlAlternatives:['https://stream.invalid/alt'],url_alternatives:['https://legacy.invalid/alt']};
 const source={...playback,genre:'pop',genres:['pop'],sslError:false,localImagePath:'/logos/radio.webp',seoArticle:'ARCHIVED_EDITORIAL_ONLY '.repeat(10000),translations:{tr:'Retained full station translation'}};
 before(async()=>{
  fixture=await createNativePostgresFixture('compact_favorites');
  engagement=await import('../src/data/postgres-engagement-store');catalog=await import('../src/data/station-read-store');
  for(const id of ['viewer','other'])await fixture.insert('users',{_id:id,email:`${id}@fixture.invalid`,username:id,fullName:id});
  for(const [id,visible]of [['newer',true],['older',true],['hidden',false]]as const){
   await fixture.insert('stations',{_id:id,stationuuid:`uuid-${id}`,name:id,slug:id,country:'Turkey',countryCode:'TR',state:'Istanbul',url:'https://stream.invalid/main',urlResolved:'https://stream.invalid/resolved',tags:'pop',codec:'AAC',bitrate:128,hls:true,lastCheckOk:visible,isListVisible:visible,source,descriptions:{en:{full:'Separate editorial description'}},logoAssets:{webp256:'https://logo.invalid/256.webp'}});
   await fixture.insert('user_favorites',{userId:'viewer',stationId:id,createdAt:id==='newer'?'2026-11-24T10:00:00Z':'2026-11-23T10:00:00Z'});
  }
 });
 after(async()=>{await fixture?.close();});
 it('real SQL projects before transfer, keeps favorite dates/order and every existing compact playback field',async()=>{
  const full=await engagement.pgFavoriteStationsForUser('viewer','newest',0,0);
  const compact=await engagement.pgFavoriteStationsForUser('viewer','newest',0,0,true);
  assert.equal(compact.total,2);assert.deepEqual(compact.stations.map(s=>s._id),['newer','older']);
  assert.deepEqual(compact.stations.map(s=>s.favoritedAt),full.stations.map(s=>s.favoritedAt));
  const card=(await catalog.listStationsFromPostgres({search:'newer',compact:true,page:1,limit:1})).stations[0];
  for(const key of ['_id','stationuuid','name','slug','countryCode','state','url','urlResolved','genre','genres','logoAssets','codec','bitrate','hls','lastCheckOk'])assert.deepEqual(compact.stations[0][key],card[key],key);
  for(const [key,value] of Object.entries(playback))assert.deepEqual(compact.stations[0][key],value,key);
  assert.equal(compact.stations[0].seoArticle,undefined);assert.equal(compact.stations[0].translations,undefined);assert.deepEqual(compact.stations[0].descriptions,{});
  assert.ok(JSON.stringify(compact).length<JSON.stringify(full).length/50,'archival source is not sent to the native list');
  assert.equal(full.stations[0].seoArticle,source.seoArticle);assert.deepEqual(full.stations[0].translations,source.translations);
 });
 it('compact mode preserves pagination, requested sort and user isolation',async()=>{
  const page=await engagement.pgFavoriteStationsForUser('viewer','oldest',1,1,true);assert.equal(page.total,2);assert.deepEqual(page.stations.map(s=>s._id),['older']);
  const empty=await engagement.pgFavoriteStationsForUser('other','newest',0,0,true);assert.equal(empty.total,0);assert.deepEqual(empty.stations,[]);
 });
});
