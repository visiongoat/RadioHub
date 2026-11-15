import {getPostgresPool} from '../postgres-runtime';
import {lockDirectPair} from './direct-chat-safety';
export const blockedContactsSql=`WITH own_blocks AS (
 SELECT blocked_user_id id,true direct,false station FROM direct_chat_blocks WHERE user_id=$1
 UNION ALL SELECT blocked_user_id,false,true FROM station_chat_blocks WHERE user_id=$1
), peers AS (SELECT id,bool_or(direct) direct,bool_or(station) station FROM own_blocks GROUP BY id)
 SELECT u.id AS "_id",u.username,u.full_name AS "fullName",u.avatar,p.direct,p.station
 FROM peers p JOIN users u ON u.id=p.id WHERE p.id>$2 ORDER BY p.id LIMIT 51`;
export async function blockedContacts(owner:string,after='',db:{query:Function}=getPostgresPool()){
 const {rows}=await db.query(blockedContactsSql,[owner,after]);
 const items=rows.slice(0,50);return {items,nextCursor:rows.length>50?items[items.length-1]._id:null};
}
/** Delete only this owner's preferences. The other participant's block survives. */
export async function unblockContact(owner:string,target:string,pool=getPostgresPool()){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await lockDirectPair(db,owner,target);
  await db.query('DELETE FROM direct_chat_blocks WHERE user_id=$1 AND blocked_user_id=$2',[owner,target]);
  await db.query('DELETE FROM station_chat_blocks WHERE user_id=$1 AND blocked_user_id=$2',[owner,target]);
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
