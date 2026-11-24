import assert from 'node:assert/strict';
import {mock,test} from 'node:test';

// Exercise the actual catalog SQL builder and mapper without any DB connection.
let favoriteQuery: ((sql:string,values:unknown[])=>Promise<any>)|undefined;
mock.module('../src/postgres-runtime',{namedExports:{getPostgresPool:()=>({query:(sql:string,values:unknown[])=>{if(!favoriteQuery)throw new Error('No database access in projection contract test');return favoriteQuery(sql,values);}})}});
const {listStationsFromPostgres}=await import('../src/data/station-read-store');
const playback={
 urlHigh:'https://stream.invalid/hd',urlLow:'https://stream.invalid/sd',
 url_high:'https://legacy.invalid/hd',url_low:'https://legacy.invalid/sd',
 urlBackup:'https://stream.invalid/backup',url_backup:'https://legacy.invalid/backup',
 urlAlternatives:['https://stream.invalid/alt-1','https://stream.invalid/alt-2'],
 url_alternatives:['https://legacy.invalid/alt'],
};
const source={...playback,localImagePath:'/logo.webp',genre:'pop',
 seoArticle:'ARCHIVED_ARTICLE_NOT_FOR_PLAYBACK'.repeat(1000),descriptions:{en:'Large article'}};

test('production public compact cards retain their original source whitelist without archived SEO',async()=>{
 let reads=0;
 const result=await listStationsFromPostgres({page:1,limit:64,compact:true},async(sql,values)=>{
  reads++;
  assert.match(sql,/COALESCE\(\(SELECT jsonb_object_agg\(k,source->k\)/);
  const projection=sql.match(/FROM unnest\(ARRAY\[([^\]]+)\]::text\[\]\) AS k/);
  assert.ok(projection,'compact SQL must explicitly whitelist source fields');
  const keys=[...projection[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
  assert.deepEqual(keys,['localImagePath','logo','genre','genres','sslError','mood','countrycode'],'default catalog projection is unchanged');
  for(const key of Object.keys(playback))assert.ok(!keys.includes(key),`${key} is added only by native favorites opt-in`);
  assert.ok(keys.includes('localImagePath'));assert.ok(keys.includes('genre'));
  assert.ok(!keys.includes('seoArticle'));assert.ok(!keys.includes('descriptions'));
  assert.doesNotMatch(sql,/selected AS \(SELECT \*/);
  assert.deepEqual(values.slice(-2),[64,0]);
  const projected=Object.fromEntries(keys.filter(key=>key in source).map(key=>[key,source[key as keyof typeof source]]));
  return {rows:[{id:'radio-1',url:'https://stream.invalid/main',url_resolved:'https://stream.invalid/resolved',source:projected,_total:1}]} as any;
 });
 assert.equal(reads,1);assert.equal(result.stations[0].url,'https://stream.invalid/main');
 assert.equal(result.stations[0].urlResolved,'https://stream.invalid/resolved');
 for(const key of Object.keys(playback))assert.equal(result.stations[0][key],undefined,'legacy public compact whitelist remains unchanged');
 assert.equal(result.stations[0].seoArticle,undefined);assert.deepEqual(result.stations[0].descriptions,{});
});

test('full catalog readers retain existing source/detail behavior',async()=>{
 const result=await listStationsFromPostgres({page:1,limit:1},async(sql)=>{
  assert.match(sql,/selected AS \(SELECT \*,row_number\(\)/);
  assert.doesNotMatch(sql,/jsonb_object_agg\(k,source->k\)/);
  return {rows:[{id:'radio-1',source,descriptions:source.descriptions,_total:1}]} as any;
 });
 assert.equal(result.stations[0].seoArticle,source.seoArticle);
 assert.deepEqual(result.stations[0].descriptions,source.descriptions);
});

test('compact favorites reuse the actual catalog projection before transfer and retain favorite order/playback',async()=>{
 const {pgFavoriteStationsForUser}=await import('../src/data/postgres-engagement-store');
 const calls:string[]=[];favoriteQuery=async(sql,values)=>{
  calls.push(sql);
  if(sql.includes('count(*)'))return {rows:[{count:'2'}]};
  assert.match(sql,/SELECT s\.id,s\.station_uuid/);assert.doesNotMatch(sql,/SELECT s\.\*/);
  assert.match(sql,/ORDER BY f\.created_at DESC LIMIT \$2 OFFSET \$3/);assert.deepEqual(values,['viewer',2,0]);
  assert.match(sql,/jsonb_object_agg\(k,s\.source->k\)/);
  const keys=[...sql.match(/FROM unnest\(ARRAY\[([^\]]+)\]::text\[\]\) AS k/)![1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
  for(const key of Object.keys(playback))assert.ok(keys.includes(key),key);
  assert.ok(!keys.includes('seoArticle')&&!keys.includes('descriptions'));
  return {rows:[{id:'newer',station_uuid:'uuid-newer',country_code:'TR',state:'Istanbul',hls:true,url:'https://stream.invalid/main',url_resolved:'https://stream.invalid/resolved',source:Object.fromEntries(keys.filter(key=>key in source).map(key=>[key,source[key as keyof typeof source]])),favorited_at:'2026-11-24T10:00:00Z'},{id:'older',source:{},favorited_at:'2026-11-23T10:00:00Z'}]};
 };
 try{const result=await pgFavoriteStationsForUser('viewer','newest',1,2,true);assert.equal(calls.length,2,'one list read and count, never one detail read per station');assert.equal(result.total,2);assert.deepEqual(result.stations.map(s=>s._id),['newer','older']);assert.equal(result.stations[0].favoritedAt,'2026-11-24T10:00:00Z');assert.equal(result.stations[0].stationuuid,'uuid-newer');assert.equal(result.stations[0].countryCode,'TR');assert.equal(result.stations[0].state,'Istanbul');assert.equal(result.stations[0].hls,true);for(const[key,value]of Object.entries(playback))assert.deepEqual(result.stations[0][key],value);assert.equal(result.stations[0].seoArticle,undefined);assert.deepEqual(result.stations[0].descriptions,{});assert.ok(JSON.stringify(result.stations[0]).length<JSON.stringify(source).length/10);}finally{favoriteQuery=undefined;}
});

test('legacy favorites keep their full DTO and existing sort without compact opt-in',async()=>{
 const {pgFavoriteStationsForUser}=await import('../src/data/postgres-engagement-store');favoriteQuery=async sql=>{
  if(sql.includes('count(*)'))return{rows:[{count:'1'}]};assert.match(sql,/SELECT s\.\*,f\.created_at AS favorited_at/);assert.match(sql,/ORDER BY s\.name ASC/);assert.doesNotMatch(sql,/jsonb_object_agg/);return{rows:[{id:'full',source,favorited_at:'legacy-date'}]};
 };
 try{const result=await pgFavoriteStationsForUser('viewer','name',0,0);assert.equal(result.stations[0].seoArticle,source.seoArticle);assert.equal(result.stations[0].favoritedAt,'legacy-date');}finally{favoriteQuery=undefined;}
});
