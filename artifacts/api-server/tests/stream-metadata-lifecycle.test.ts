import {mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
const bodies:PassThrough[]=[],signals:AbortSignal[]=[];
class Request {signal:AbortSignal;constructor(_url:string,options:any){this.signal=options.signal;}}
mock.module('node-fetch',{defaultExport:async(request:Request)=>{signals.push(request.signal);const body=new PassThrough();bodies.push(body);return {ok:true,headers:{get:(key:string)=>({'icy-metaint':'16','icy-name':'Different broadcast identity','icy-genre':'Pop'}[key])},body};},namedExports:{Request}});
mock.module(new URL('../src/utils/logger.ts',import.meta.url).href,{namedExports:{logger:{log(){},error(){},warn(){}}}});
const {StreamMetadataService}=await import('../src/services/stream-metadata');
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function frame(title:string){const raw=Buffer.from(`StreamTitle='${title}';`);const n=Math.ceil(raw.length/16),meta=Buffer.alloc(n*16);raw.copy(meta);return Buffer.concat([Buffer.alloc(16),Buffer.from([n]),meta]);}
test('station headers never become songs; real title arrives, then stream end clears the cached track',async()=>{
 const service=new StreamMetadataService(),url='https://fixture.test/one';
 try{
 const response=service.getStationMetadata({url});await tick();assert.equal(service.getMetadata(url).title,undefined);
 bodies.at(-1)!.write(frame('Artist - Song - Live'));
 assert.deepEqual(await response,{title:'Song - Live',artist:'Artist',station:'Different broadcast identity',genre:'Pop'});
 bodies.at(-1)!.emit('end');assert.equal(service.getMetadata(url).title,undefined);assert.equal(service.getMetadata(url).artist,undefined);
 }finally{service.cleanup();}
});
test('a silent transport refreshes its cached song, but activity preserves a long unchanged song',async()=>{
 const service=new StreamMetadataService(),url='https://fixture.test/two';
 try{
 const first=service.getStationMetadata({url});await tick();bodies.at(-1)!.write(frame('Artist - Long Song'));await first;
 const conn=(service as any).connections.get(url);conn.sockets.add('listener');conn.lastUpdate=Date.now()-3600000;
 assert.equal((await service.getStationMetadata({url})).title,'Long Song','song age alone cannot expire a live stream');
 const oldSignal=signals.at(-1)!;conn.lastActivity=Date.now()-45001;assert.equal(service.getMetadata(url).title,undefined);
 const next=service.getStationMetadata({url});await tick();assert.equal(oldSignal.aborted,true);assert.equal((service as any).connections.get(url).sockets.has('listener'),true);assert.equal(service.getMetadata(url).title,undefined);
 bodies.at(-1)!.write(frame('Artist - Fresh Song'));assert.equal((await next).title,'Fresh Song');
 bodies.at(-1)!.emit('error',Error('Connection lost'));assert.equal(service.getMetadata(url).title,undefined);
 }finally{service.cleanup();}
});
