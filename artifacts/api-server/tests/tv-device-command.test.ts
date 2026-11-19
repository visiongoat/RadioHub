import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseTvDeviceCommand} from '../src/utils/tv-device-command';
test('relative TV volume accepts bounded finite numeric changes only',()=>{
 for(const volumeDelta of [undefined,null,'0.2',NaN,Infinity,-Infinity,0,1.01,-1.01])assert.equal(parseTvDeviceCommand({type:'cast:volume',volumeDelta}),null);
 for(const volumeDelta of [-1,-.0625,.0625,1])assert.deepEqual(parseTvDeviceCommand({type:'cast:volume',volumeDelta,station:{url:'ignored'}}),{type:'cast:volume',station:null,payload:{volumeDelta}});
 assert.equal(parseTvDeviceCommand({type:'other'}),null);
 assert.equal(parseTvDeviceCommand({type:'cast:pause'})!.type,'cast:pause');
});

test('play correlation is bounded and cannot be attached to volume or control payloads',()=>{
 const requestId='fixture-request-123456';
 assert.deepEqual(parseTvDeviceCommand({type:'cast:play',station:{_id:'radio'},requestId})!.payload,{requestId});
 for(const requestId of ['',123,'x'.repeat(81),'../../unsafe'])assert.equal(parseTvDeviceCommand({type:'cast:play',requestId}),null);
 assert.equal(parseTvDeviceCommand({type:'cast:pause',requestId})!.payload,null);
});
