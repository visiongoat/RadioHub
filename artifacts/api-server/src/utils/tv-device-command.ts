export function parseTvDeviceCommand(input:any):{type:string;station:any;payload:any}|null {
 const type=input?.type;
 if(type==='cast:volume'){
  const delta=input.volumeDelta;
  if(typeof delta!=='number'||!Number.isFinite(delta)||Math.abs(delta)>1||delta===0)return null;
  return {type,station:null,payload:{volumeDelta:delta}};
 }
 if(type==='cast:play'&&input.requestId!==undefined){
  if(typeof input.requestId!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(input.requestId))return null;
  return {type,station:input.station,payload:{requestId:input.requestId}};
 }
 return ['cast:play','cast:pause','cast:resume','cast:stop'].includes(type)?{type,station:input.station,payload:null}:null;
}
