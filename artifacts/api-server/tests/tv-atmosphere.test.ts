import assert from 'node:assert/strict';
import {test} from 'node:test';
import express from 'express';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {serveStatic} from '../src/serve-static';
import {createAtmosphereWeatherLoader,registerTvAtmosphereRoutes} from '../src/routes/tv-atmosphere-routes';

const forecast=(temperature=18)=>new Response(JSON.stringify({properties:{timeseries:[{data:{instant:{details:{air_temperature:temperature}},next_1_hours:{summary:{symbol_code:'partlycloudy_day'}}}}]}}));
test('weather proxy coalesces callers, rounds coordinates, identifies itself and caches provider data',async()=>{
  let calls=0,url='',agent='';
  const load=createAtmosphereWeatherLoader(async(input,options)=>{calls++;url=String(input);agent=String((options?.headers as Record<string,string>)?.['User-Agent']);return forecast();});
  const values=await Promise.all([load(47.9,16.8),load(47.9,16.8)]);
  assert.equal(calls,1);assert.equal(values[0]?.temperature,18);assert.deepEqual(values[0],values[1]);
  assert.match(url,/lat=47.9&lon=16.8$/);assert.match(agent,/MegaRadioTV.*themegaradio.com/);
  await load(47.9,16.8);assert.equal(calls,1);
});
test('upstream rejection, malformed data and network errors never produce fabricated weather',async()=>{
  for(const fetcher of [async()=>new Response('',{status:429}),async()=>forecast(NaN),async()=>{throw new Error('offline');}])assert.equal(await createAtmosphereWeatherLoader(fetcher)(0,0),null);
});
test('at most four distinct provider requests are in flight',async()=>{
  const releases:Array<()=>void>=[];
  const load=createAtmosphereWeatherLoader(async()=>{await new Promise<void>(r=>releases.push(r));return forecast();});
  const pending=[1,2,3,4].map(n=>load(n,n));
  assert.equal(await load(5,5),null);releases.forEach(r=>r());await Promise.all(pending);
});
test('route rejects arrays, missing, nonfinite, out-of-range and URL input before upstream access',async()=>{
  const app=express();let calls=0;
  registerTvAtmosphereRoutes(app,async()=>{calls++;return {temperature:18,symbol:'clearsky_day'};});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/tv/atmosphere/weather`;
  try{
    for(const query of ['', '?lat=Infinity&lon=0','?lat=91&lon=0','?lat=0&lon=181','?lat=https://evil&lon=0','?lat=1&lat=2&lon=0'])assert.equal((await fetch(base+query)).status,400);
    assert.equal(calls,0);
    const response=await fetch(base+'?lat=47.94&lon=16.83');assert.equal(response.status,200);assert.equal(calls,1);assert.match(response.headers.get('cache-control')||'',/1800/);
    assert.equal((await response.json()).attribution,'MET Norway · CC BY 4.0');
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test('remote video delivery supports byte ranges, immutable cache and anonymous media CORS',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'mega-atmosphere-http-'));
  await mkdir(path.join(dir,'media/tv-atmospheres/v1'),{recursive:true});
  await writeFile(path.join(dir,'media/tv-atmospheres/v1/test-720.mp4'),Buffer.alloc(100,42));
  const app=express();serveStatic(app,dir);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  try{
    const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/media/tv-atmospheres/v1/test-720.mp4`,{headers:{Range:'bytes=0-9',Origin:'null'}});
    assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-9/100');
    assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.match(response.headers.get('cache-control')||'',/immutable/);
    assert.equal((await response.arrayBuffer()).byteLength,10);
  }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
