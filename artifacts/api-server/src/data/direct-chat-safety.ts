import {getPostgresPool} from '../postgres-runtime';
import {newPublicUserId} from './postgres-user-store';
export type DirectSafety={blocked:boolean;canContact:boolean};
type DB={query:Function};
export const pairBlockSql=`SELECT EXISTS(SELECT 1 FROM direct_chat_blocks WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)) blocked`;
export async function directPairBlocked(a:string,b:string,db:DB=getPostgresPool()):Promise<boolean>{
 return (await db.query(pairBlockSql,[a,b])).rows[0]?.blocked===true;
}
export async function directSafety(owner:string,target:string):Promise<DirectSafety>{
 const {rows}=await getPostgresPool().query(`SELECT EXISTS(SELECT 1 FROM direct_chat_blocks WHERE user_id=$1 AND blocked_user_id=$2) blocked,NOT EXISTS(SELECT 1 FROM direct_chat_blocks WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)) can_contact`,[owner,target]);
 return {blocked:rows[0]?.blocked===true,canContact:rows[0]?.can_contact===true};
}
export async function directBlockedPeers(owner:string):Promise<Set<string>>{
 const {rows}=await getPostgresPool().query(`SELECT CASE WHEN user_id=$1 THEN blocked_user_id ELSE user_id END id FROM direct_chat_blocks WHERE user_id=$1 OR blocked_user_id=$1`,[owner]);
 return new Set(rows.map((r:any)=>r.id));
}
export async function lockDirectPair(db:DB,a:string,b:string){
 for(const actor of [a,b].sort())await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor}:direct:${actor===a?b:a}`]);
}
export async function setDirectBlock(owner:string,target:string,blocked:boolean){
 const db=await getPostgresPool().connect();
 try{
  await db.query('BEGIN');await lockDirectPair(db,owner,target);
  if(blocked)await db.query('INSERT INTO direct_chat_blocks(user_id,blocked_user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[owner,target]);
  else await db.query('DELETE FROM direct_chat_blocks WHERE user_id=$1 AND blocked_user_id=$2',[owner,target]);
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 return directSafety(owner,target);
}
export async function reportDirectChat(owner:string,target:string,reason:'harassment'|'spam'|'other'){
 // Only received messages are disclosed, never a full private conversation.
 const {rows}=await getPostgresPool().query(`INSERT INTO direct_chat_reports(id,reporter_id,reported_user_id,reason,message_snapshot)
 SELECT $1,$2,$3,$4,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'content',content,'type',message_type,'createdAt',created_at)) FROM (SELECT id,content,message_type,created_at FROM direct_messages WHERE from_user_id=$3 AND to_user_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 5) evidence),'[]'::jsonb)
 WHERE EXISTS(SELECT 1 FROM direct_messages WHERE (from_user_id=$2 AND to_user_id=$3) OR (from_user_id=$3 AND to_user_id=$2)) RETURNING id`,[newPublicUserId(),owner,target,reason]);
 return rows.length>0;
}
export async function withAllowedDirectPair<T>(a:string,b:string,operation:(db:DB)=>Promise<T>):Promise<T>{
 const db=await getPostgresPool().connect();
 try{await db.query('BEGIN');await lockDirectPair(db,a,b);
  if(await directPairBlocked(a,b,db))throw Object.assign(Error('Conversation unavailable'),{status:403});
  const result=await operation(db);await db.query('COMMIT');return result;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
