import {randomUUID} from 'node:crypto';
import {getPostgresPool} from '../postgres-runtime';
import {expoPushRequest} from './expo-push-client';

export async function recordPushTicket(device:{id:string;token:string},ticket:any):Promise<boolean>{
 if(ticket?.status==='error'){
  const code=typeof ticket.details?.error==='string'?ticket.details.error.slice(0,100):'UnknownTicketError';
  await getPostgresPool().query("INSERT INTO push_receipts(ticket_id,push_token_id,state,error_code,checked_at) VALUES($1,$2,'error',$3,now())",['error:'+randomUUID(),device.id,code]);
  if(ticket.details?.error==='DeviceNotRegistered')await getPostgresPool().query('UPDATE push_tokens SET is_active=false,updated_at=now() WHERE id=$1 AND token=$2',[device.id,device.token]);
  return false;
 }
 if(ticket?.status!=='ok'||typeof ticket.id!=='string'||!ticket.id)return false;
 await getPostgresPool().query('INSERT INTO push_receipts(ticket_id,push_token_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[ticket.id,device.id]);
 return true;
}
let draining=false;
export async function drainPushReceipts():Promise<void>{
 if(draining)return;draining=true;
 try{
  const db=getPostgresPool();
  await db.query("UPDATE push_receipts SET state='expired',checked_at=now() WHERE state='pending' AND created_at<now()-interval '23 hours'");
  const {rows}=await db.query(`WITH due AS(SELECT ticket_id FROM push_receipts WHERE state='pending' AND next_check_at<=now() ORDER BY next_check_at LIMIT 300 FOR UPDATE SKIP LOCKED)
   UPDATE push_receipts p SET next_check_at=now()+interval '5 minutes',attempts=attempts+1 FROM due WHERE p.ticket_id=due.ticket_id RETURNING p.ticket_id,p.push_token_id`);
  if(rows.length){
   const result=await expoPushRequest('getReceipts',{ids:rows.map(row=>row.ticket_id)});
   for(const row of rows){
    const receipt=result?.data?.[row.ticket_id];if(!['ok','error'].includes(receipt?.status))continue;
    const code=typeof receipt.details?.error==='string'?receipt.details.error.slice(0,100):null;
    await db.query("UPDATE push_receipts SET state=$2,error_code=$3,checked_at=now() WHERE ticket_id=$1 AND state='pending'",[row.ticket_id,receipt.status==='ok'?'provider_accepted':'error',code]);
    if(code==='DeviceNotRegistered')await db.query(`UPDATE push_tokens SET is_active=false,updated_at=now() WHERE id=$1 AND updated_at<=(SELECT created_at FROM push_receipts WHERE ticket_id=$2)`,[row.push_token_id,row.ticket_id]);
   }
  }
  await db.query("DELETE FROM push_receipts WHERE created_at<now()-interval '7 days'");
 }finally{draining=false;}
}
let worker:ReturnType<typeof setInterval>|undefined;
export function startPushReceiptWorker():void{
 if(worker)return;
 const tick=()=>void drainPushReceipts().catch(()=>console.warn('[push] Receipt status temporarily unavailable'));
 tick();worker=setInterval(tick,60000);worker.unref();
}
