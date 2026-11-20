import {describe,it,expect} from 'vitest';
import {translateMissingInChunks} from '../src/lib/translation-chunks';
describe('resumable translation batches',()=>{
 it('continues in order and never resends completed rows',async()=>{
  let calls=0;const results=[{translated:20,failed:0,remaining:21},{translated:20,failed:0,remaining:1},{translated:1,failed:0,remaining:0}];const progress:number[]=[];
  expect(await translateMissingInChunks(async()=>results[calls++],n=>progress.push(n))).toEqual({translated:41,fixed:0,failed:0});expect(calls).toBe(3);expect(progress).toEqual([20,40,41]);
 });
 it('stops without repeated paid retries when the provider makes no progress',async()=>{let calls=0;expect(await translateMissingInChunks(async()=>{calls++;return {translated:0,failed:20,remaining:51};})).toEqual({translated:0,fixed:0,failed:51});expect(calls).toBe(1);});
 it('propagates network failure and permits a new call to resume the server-selected remainder',async()=>{await expect(translateMissingInChunks(async()=>{throw Error('network');})).rejects.toThrow('network');expect(await translateMissingInChunks(async()=>({translated:3,failed:0,remaining:0}))).toEqual({translated:3,fixed:0,failed:0});});
});
