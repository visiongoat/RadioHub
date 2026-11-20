import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
let settings: Record<string,boolean> = {};
mock.module(new URL('../src/data/postgres-user-store.ts',import.meta.url).href,{namedExports:{pgFindUserById:async()=>({notificationSettings:settings}),pgGetUserPushSubscription:async()=>null,pgListUserPushSubscriptions:async()=>[],pgSetUserPushSubscription:async()=>{}}});
mock.module(new URL('../src/data/postgres-push-store.ts',import.meta.url).href,{namedExports:{pgPushDevices:async function*(){}}});
const {PushNotificationService}=await import('../src/services/pushNotificationService');
let deliveries=0;
PushNotificationService.sendToUser=async()=>{deliveries++;return true;};
PushNotificationService.sendToMobileUser=async()=>{deliveries++;return true;};
const payload=(type:string)=>({title:'Fixture',body:'Fixture',data:{type}});
test('master and per-category preferences gate both mobile and web push channels',async()=>{
 settings={pushEnabled:false};assert.equal(await PushNotificationService.sendToUserAllChannels('fixture',payload('new_message')),false);assert.equal(deliveries,0);
 settings={messages:false};assert.equal(await PushNotificationService.sendToUserAllChannels('fixture',payload('station_mention')),false);assert.equal(deliveries,0);assert.equal(await PushNotificationService.sendToUserAllChannels('fixture',payload('new_message')),false);assert.equal(deliveries,0);
 settings={followers:false};assert.equal(await PushNotificationService.sendToUserAllChannels('fixture',payload('follow')),false);assert.equal(deliveries,0);
 settings={messages:false,followers:true};assert.equal(await PushNotificationService.sendToUserAllChannels('fixture',payload('follow')),true);assert.equal(deliveries,2);
 settings={};assert.equal(await PushNotificationService.sendToUserAllChannels('fixture',payload('new_message')),true);assert.equal(deliveries,4);
});

test('radio/favorite/recommendation helpers cannot bypass master or category preferences',async()=>{
 deliveries=0;settings={pushEnabled:false};
 assert.equal(await PushNotificationService.sendNowPlayingNotification('fixture',{name:'Fixture'}),false);
 assert.equal(await PushNotificationService.sendFavoriteAddedNotification('fixture',{stationId:'fixture',name:'Fixture'}),false);
 assert.equal(await PushNotificationService.sendStationRecommendation('fixture',[{name:'Fixture'}]),false);
 assert.equal(deliveries,0);
 settings={nowPlaying:false};assert.equal(await PushNotificationService.sendNowPlayingNotification('fixture',{name:'Fixture'}),false);
 settings={favorites:false};assert.equal(await PushNotificationService.sendFavoriteAddedNotification('fixture',{stationId:'fixture',name:'Fixture'}),false);
 settings={};assert.equal(await PushNotificationService.sendStationRecommendation('fixture',[{name:'Fixture'}]),false);
 assert.equal(deliveries,0);
 settings={recommendations:true};assert.equal(await PushNotificationService.sendStationRecommendation('fixture',[{name:'Fixture'}]),true);assert.equal(deliveries,2);
});
