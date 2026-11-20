import {getPostgresPool} from '../postgres-runtime';
import {directPairBlocked} from './direct-chat-safety';
import path from 'node:path';
import fs from 'node:fs/promises';
export const privateChatDirectory=()=>path.resolve(process.cwd(),'private','chat-view-once');
const fail=(status:number,message:string)=>Object.assign(Error(message),{status});
export const viewOnceId=(value:unknown)=>typeof value==='string'&&/^view-once:[a-f0-9]{32}$/.test(value)?value.slice(10):null;
/** Claim exactly once while the message transaction is open. A reference cannot be forwarded. */
export async function claimViewOnce(db:{query:Function},owner:string,reference:string,kind:'direct'|'group',target:string,message:string,recipients:string[]){
 const id=viewOnceId(reference);if(!id)throw fail(400,'Invalid photo');
 const result=await db.query(`UPDATE chat_view_once_media SET kind=$3,target_id=$4,message_id=$5,recipients=$6::text[] WHERE id=$1 AND owner_id=$2 AND message_id IS NULL AND expires_at>now() RETURNING id`,[id,owner,kind,target,message,[...new Set(recipients.filter(id=>id!==owner))]]);
 if(!result.rows.length)throw fail(409,'Photo unavailable');
}
/** Private, bounded PostgreSQL bytes survive deploys; no public URL or thumbnail exists. A successful atomic claim returns bytes once per recipient. */
export async function openViewOnce(actor:string,id:string):Promise<Buffer>{
 if(!/^[a-f0-9]{32}$/.test(id))throw fail(404,'Photo unavailable');
 const db=await getPostgresPool().connect();
 try{
  await db.query('BEGIN');
  const media=(await db.query('SELECT * FROM chat_view_once_media WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!media||media.owner_id===actor||!media.recipients.includes(actor))throw fail(404,'Photo unavailable');
  if(new Date(media.expires_at).getTime()<=Date.now()||media.opened_by.includes(actor))throw fail(410,'Photo already opened');
  if(media.kind==='direct'){
   if(await directPairBlocked(actor,media.owner_id,db))throw fail(403,'Photo unavailable');
   if(!(await db.query('SELECT id FROM direct_messages WHERE id=$1 AND to_user_id=$2 AND deleted_at IS NULL AND NOT ($2=ANY(hidden_for))',[media.message_id,actor])).rows.length)throw fail(404,'Photo unavailable');
  }else if(media.kind==='group'){
   if(!(await db.query(`SELECT m.id FROM chat_group_messages m JOIN chat_group_members g ON g.group_id=m.group_id AND g.user_id=$2 AND g.status='active' WHERE m.id=$1 AND m.created_at>=g.joined_at AND m.deleted_at IS NULL AND NOT ($2=ANY(m.hidden_for))`,[media.message_id,actor])).rows.length)throw fail(404,'Photo unavailable');
  }else throw fail(404,'Photo unavailable');
  const bytes=media.photo_bytes as Buffer|null;if(!bytes?.length)throw fail(410,'Photo expired');
  const opened=[...media.opened_by,actor],complete=media.recipients.every((id:string)=>opened.includes(id));
  await db.query('UPDATE chat_view_once_media SET opened_by=$2::text[],photo_bytes=CASE WHEN $3 THEN NULL ELSE photo_bytes END WHERE id=$1',[id,opened,complete]);
  await db.query('COMMIT');return bytes;
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
let cleanup:Promise<void>|undefined;
export function cleanupViewOnce(){return cleanup??=(async()=>{
 const {rows}=await getPostgresPool().query(`DELETE FROM chat_view_once_media WHERE id IN (SELECT id FROM chat_view_once_media WHERE expires_at<=now() ORDER BY expires_at LIMIT 100) RETURNING file_name`);
 for(const row of rows)await fs.unlink(path.join(privateChatDirectory(),path.basename(row.file_name))).catch(()=>{});
})().finally(()=>{cleanup=undefined;});}
