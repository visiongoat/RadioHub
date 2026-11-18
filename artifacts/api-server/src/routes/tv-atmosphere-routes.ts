import type {Express} from 'express';

type Weather={temperature:number;symbol:string};
type Entry={value:Weather;expires:number};
/** Public bounded weather proxy: fixed upstream, coarse coordinates, no identity or IP retention. */
export function createAtmosphereWeatherLoader(fetcher:typeof fetch=fetch, now=Date.now){
  const cache=new Map<string,Entry>(),pending=new Map<string,Promise<Weather|null>>();
  return async(lat:number,lon:number):Promise<Weather|null>=>{
    const key=`${lat.toFixed(1)},${lon.toFixed(1)}`;
    const hit=cache.get(key);if(hit&&hit.expires>now())return hit.value;
    if(pending.has(key))return pending.get(key)!;
    if(pending.size>=4)return null;
    const work=(async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
      try{
        const response=await fetcher(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(1)}&lon=${lon.toFixed(1)}`,{
          signal:controller.signal,headers:{'User-Agent':'MegaRadioTV/1.0 https://themegaradio.com'},redirect:'error',
        });
        if(!response.ok)return null;
        const data=await response.json() as any;
        const hour=data?.properties?.timeseries?.[0]?.data;
        const temperature=hour?.instant?.details?.air_temperature;
        const symbol=hour?.next_1_hours?.summary?.symbol_code||hour?.next_6_hours?.summary?.symbol_code;
        if(typeof temperature!=='number'||!Number.isFinite(temperature)||Math.abs(temperature)>80||typeof symbol!=='string'||!/^\w{1,70}$/.test(symbol))return null;
        const value={temperature,symbol};
        if(cache.size>=128)cache.delete(cache.keys().next().value!);
        const upstreamExpiry=Date.parse(response.headers.get('expires')||'');
        cache.set(key,{value,expires:Math.max(now()+30*60*1000,Number.isFinite(upstreamExpiry)?upstreamExpiry:0)});
        return value;
      }catch{return null;}finally{clearTimeout(timer);pending.delete(key);}
    })();
    pending.set(key,work);return work;
  };
}

export function registerTvAtmosphereRoutes(app:Express,load=createAtmosphereWeatherLoader()){
  app.get('/api/tv/atmosphere/weather',async(req,res)=>{
    const {lat,lon}=req.query;
    if(typeof lat!=='string'||typeof lon!=='string'||!/^[-+]?\d{1,3}(\.\d{1,4})?$/.test(lat)||!/^[-+]?\d{1,3}(\.\d{1,4})?$/.test(lon)||Math.abs(Number(lat))>90||Math.abs(Number(lon))>180){res.status(400).json({error:'invalid_coordinates'});return;}
    const value=await load(Math.round(Number(lat)*10)/10,Math.round(Number(lon)*10)/10);
    if(!value){res.set('Cache-Control','no-store').status(503).json({error:'weather_unavailable'});return;}
    res.set('Cache-Control','public, max-age=1800').json({...value,attribution:'MET Norway · CC BY 4.0'});
  });
}
