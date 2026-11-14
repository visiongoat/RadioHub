import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
const catalog=[{slug:'folk',stationCount:30},{slug:'arabesk',stationCount:12},{slug:'folk-music',stationCount:15},{slug:'hidden',stationCount:10,cleanupDemotion:true},{slug:'empty',stationCount:0}];
let fullReads=0,homeReads=0;const cache=new Map<string,unknown>();
mock.module(new URL('../src/data/postgres-taxonomy-store.ts',import.meta.url).href,{namedExports:{
 pgPublicGenres:async()=>{homeReads++;return [catalog[0]];},
 pgGenres:async(country?:string,dynamic?:boolean)=>{fullReads++;assert.equal(country,undefined);assert.equal(dynamic,true);return catalog;},
}});
mock.module(new URL('../src/seo/genre-whitelist-store.ts',import.meta.url).href,{namedExports:{getMergedWhitelist:()=>new Set(['folk'])}});
mock.module(new URL('../src/public-station-cache.ts',import.meta.url).href,{namedExports:{publicStationCache:{
 getOrSetSingleFlight:async(key:string,compute:()=>Promise<unknown>,options:{ttl:number})=>{assert.equal(options.ttl,60);if(!cache.has(key))cache.set(key,compute());return cache.get(key);},
 clearByPattern:async()=>{},
}}});
const {getCachedGroupMusicGenres}=await import('../src/services/group-music-catalog');
const {getCachedPublicGenres}=await import('../src/services/public-genre-navigation');
test('group interests use full picker catalog without widening curated home navigation',async()=>{
 const [a,b]=await Promise.all([getCachedGroupMusicGenres(),getCachedGroupMusicGenres()]);
 assert.deepEqual(a.map(g=>g.slug),['folk','arabesk','folk-music']);assert.deepEqual(b,a);
 assert.equal(fullReads,1);assert.deepEqual((await getCachedPublicGenres()).map(g=>g.slug),['folk']);assert.equal(homeReads,1);
});
