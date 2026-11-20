import {getPostgresPool} from '../postgres-runtime';
import {pgCreateNotification} from '../data/postgres-notification-store';
import CacheManager from '../cache';

export function mentionedUsernames(content:string):string[]{
 const names:string[]=[];
 for(const match of content.slice(0,400).matchAll(/(?:^|[^\p{L}\p{N}_.@-])@([\p{L}\p{N}_.-]{1,40})(?![\p{L}\p{N}_.-])/gu)){
  const name=match[1].normalize('NFKC').toLowerCase();if(!names.includes(name))names.push(name);if(names.length===8)break;
 }
 return names;
}
/** One bounded identity read per history page, including people no longer connected. */
export async function hydrateRoomMentions(messages:any[]):Promise<any[]>{
 const names=[...new Set(messages.flatMap(message=>mentionedUsernames(message.content||'')))].slice(0,200);
 if(!names.length)return messages;
 const stations=[...new Set(messages.map(message=>message.stationId).filter(Boolean))];
 const {rows}=await getPostgresPool().query(`SELECT id AS "_id",username,full_name AS "fullName",avatar,source->>'profileImageUrl' AS "profileImageUrl",is_public_profile AS "canOpenProfile" FROM users WHERE lower(username)=ANY($1::text[]) AND status='active' AND EXISTS(SELECT 1 FROM station_chat_messages m WHERE m.user_id=users.id AND m.station_id=ANY($2::text[]))`,[names,stations]);
 const byName=new Map(rows.map(row=>[String(row.username).normalize('NFKC').toLowerCase(),row]));
 return messages.map(message=>({...message,mentions:mentionedUsernames(message.content||'').flatMap(name=>byName.has(name)?[byName.get(name)]:[])}));
}
/** Called only for a newly committed message, never an idempotent retry. */
export async function notifyRoomMentions(message:any):Promise<void>{
 if(message.messageType==='gif')return;
 const names=mentionedUsernames(message.content||'');if(!names.length)return;
 const db=getPostgresPool();
 const {rows}=await db.query(`SELECT u.id FROM users u WHERE lower(u.username)=ANY($1::text[]) AND u.id<>$2 AND u.status='active'
  AND EXISTS(SELECT 1 FROM station_chat_messages m WHERE m.station_id=$3 AND m.user_id=u.id AND m.created_at>now()-interval '24 hours')
  AND NOT EXISTS(SELECT 1 FROM station_chat_blocks b WHERE (b.user_id=u.id AND b.blocked_user_id=$2) OR (b.user_id=$2 AND b.blocked_user_id=u.id))
  AND NOT EXISTS(SELECT 1 FROM direct_chat_blocks b WHERE (b.user_id=u.id AND b.blocked_user_id=$2) OR (b.user_id=$2 AND b.blocked_user_id=u.id)) LIMIT 8`,[names,message.userId,message.stationId]);
 if(!rows.length)return;
 const station=(await db.query('SELECT name FROM stations WHERE id=$1',[message.stationId])).rows[0];
 const name=message.sender?.fullName||message.sender?.username||'MegaRadio';
 const stationName=station?.name||'MegaRadio';
 const data={type:'station_mention',screen:'station-chat',stationId:message.stationId,stationName,messageId:message._id,userId:message.userId,userName:name,userAvatar:message.sender?.profileImageUrl||message.sender?.avatar};
 const body=`${name}, ${stationName} sohbetinde senden bahsetti.`;
 const {PushNotificationService}=await import('./pushNotificationService');
 const {chatService}=await import('./chat-service');
 for(const row of rows){
  await pgCreateNotification({userId:row.id,fromUserId:message.userId,type:'station_mention',title:stationName,message:body,data});
  await CacheManager.clearByPattern(`notifications:postgres:${row.id}:`).catch(()=>{});
  chatService.sendToUser(row.id,{type:'notification:station_mention',data});
  const viewing=(await db.query('SELECT 1 FROM station_chat_sessions WHERE user_id=$1 AND station_id=$2 AND connected AND expires_at>now() LIMIT 1',[row.id,message.stationId])).rowCount;
  if(!viewing)await PushNotificationService.sendToUserAllChannels(row.id,{title:stationName,body,data,tag:`mention-${message._id}`});
 }
}
