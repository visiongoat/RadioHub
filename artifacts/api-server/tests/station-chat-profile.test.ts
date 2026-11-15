import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stationChatProfilePreview} from '../src/services/station-chat-profile';
test('public chat profile returns aggregates only after eligibility, with actual minute units',async()=>{
 let aggregates=0;
 const sources={query:async(sql:string)=>{assert.match(sql,/is_public_profile IS TRUE/);assert.match(sql,/blocked_user_id=\$2/);return {rows:[{id:'a'.repeat(24),favorite_count:17}]};},counts:async()=>{aggregates++;return {followersCount:128,followingCount:63};},minutes:async()=>{aggregates++;return 122.5;}};
 const data=await stationChatProfilePreview('a'.repeat(24),'b'.repeat(24),sources);
 assert.deepEqual(data,{_id:'a'.repeat(24),isPublicProfile:true,followersCount:128,followingCount:63,favoriteStationsCount:17,totalListeningMinutes:122.5});assert.equal(aggregates,2);
 assert.equal('email' in data,false);assert.equal('recentlyPlayedStations' in data,false);
 aggregates=0;
 await assert.rejects(()=>stationChatProfilePreview('a'.repeat(24),'b'.repeat(24),{...sources,query:async()=>({rows:[]})}),(error:any)=>error.status===404);assert.equal(aggregates,0,'private, blocked or absent users never load stats');
 await assert.rejects(()=>stationChatProfilePreview('../users','',sources),(error:any)=>error.status===404);assert.equal(aggregates,0);
});
