import https from 'node:https';
/** Exact Expo endpoints, bounded response and timeout; never log tokens or message contents. */
export async function expoPushRequest(path:'send'|'getReceipts',payload:unknown):Promise<any>{
 return new Promise(resolve=>{
  const body=JSON.stringify(payload);
  const request=https.request({hostname:'exp.host',path:`/--/api/v2/push/${path}`,method:'POST',timeout:10000,
   headers:{Accept:'application/json','Accept-Encoding':'identity','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},response=>{
    let data='',bytes=0;
    response.on('data',chunk=>{bytes+=chunk.length;if(bytes>262144){response.destroy();resolve(null);}else data+=chunk;});
    response.on('end',()=>{if(response.statusCode!==200)return resolve(null);try{resolve(JSON.parse(data));}catch{resolve(null);}});
    response.on('error',()=>resolve(null));
   });
  request.on('error',()=>resolve(null));request.on('timeout',()=>{request.destroy();resolve(null);});request.end(body);
 });
}
