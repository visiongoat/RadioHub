import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseTvDeviceCommand} from '../src/utils/tv-device-command';
test('relative TV volume accepts bounded finite numeric changes only',()=>{
 for(const volumeDelta of [undefined,null,'0.2',NaN,Infinity,-Infinity,0,1.01,-1.01])assert.equal(parseTvDeviceCommand({type:'cast:volume',volumeDelta}),null);
 for(const volumeDelta of [-1,-.0625,.0625,1])assert.deepEqual(parseTvDeviceCommand({type:'cast:volume',volumeDelta,station:{url:'ignored'}}),{type:'cast:volume',station:null,payload:{volumeDelta}});
 assert.equal(parseTvDeviceCommand({type:'other'}),null);
 assert.equal(parseTvDeviceCommand({type:'cast:pause'})!.type,'cast:pause');
});
