import {setChatReaction,validChatReaction} from '../data/chat-reactions';
import type {Express,RequestHandler} from 'express';
import {rateLimit} from 'express-rate-limit';
import {getPostgresPool} from '../postgres-runtime';
import {newPublicUserId} from '../data/postgres-user-store';
import {groupListening} from '../services/group-listening';
import {chatService} from '../services/chat-service';
import {radioRequest,canonicalRadio} from '../utils/chat-radio';
import {getPublicStationByIdentifier} from '../data/station-read-store';
import {logger} from '../utils/logger';
import {getCachedGroupMusicGenres} from '../services/group-music-catalog';
const groupGenres=new Set(['pop','rock','jazz','electronic','classical','hip-hop','rnb','folk','turkish','world','ambient','latin']);
const idValid=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{24}$/.test(id);
async function allowedMusicStyles(genres:unknown){
 if(!Array.isArray(genres)||genres.every(g=>groupGenres.has(g)))return groupGenres;
 const catalog=await getCachedGroupMusicGenres();
 return new Set([...groupGenres,...catalog.map(g=>g.slug).filter((slug:unknown):slug is string=>typeof slug==='string')]);
}
export function groupMusicInput(genres:unknown,allowed:ReadonlySet<string>=groupGenres):string[]{
 if(!Array.isArray(genres)||genres.length>3||genres.some((genre:unknown)=>typeof genre!=='string'||!allowed.has(genre)))throw Object.assign(Error('Choose up to three music styles'),{status:400,code:'GROUP_GENRES_INVALID'});
 return [...new Set(genres)] as string[];
}
export function groupInput(body:any,actor:string,allowed:ReadonlySet<string>=groupGenres){
 const members=Array.isArray(body?.memberIds)?[...new Set(body.memberIds)]:[];
 if(typeof body?.name!=='string'||!body.name.trim()||body.name.trim().length>80||members.length<1||members.length>49||members.some(id=>!idValid(id)||id===actor))throw Object.assign(Error('Invalid group'),{status:400});
 if(body.avatar!=null&&(typeof body.avatar!=='string'||!/^\/uploads\/chat\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(body.avatar)))throw Object.assign(Error('Invalid group photo'),{status:400});
 const genres=body.genres===undefined?[]:body.genres;
 return {name:body.name.trim(),memberIds:members as string[],avatar:body.avatar||null,genres:groupMusicInput(genres,allowed)};
}
const fail=(status:number,message:string)=>Object.assign(Error(message),{status});
const profile=`jsonb_build_object('_id',u.id,'fullName',u.full_name,'username',u.username,'avatar',u.avatar,'profileImageUrl',u.source->>'profileImageUrl')`;
const messageSelect=(viewer='$2',joined='$3')=>`SELECT m.id AS "_id",m.group_id AS "groupId",m.from_user_id AS "fromUserId",m.content,m.message_type AS "messageType",m.image_url AS "imageUrl",m.created_at AS "createdAt",m.deleted_at AS "deletedAt",m.hidden_for AS "hiddenFor",m.pinned_at AS "pinnedAt",m.updated_at AS "pinUpdatedAt",m.reply_to_id AS "replyToId",CASE WHEN m.deleted_at IS NULL THEN m.reactions ELSE '[]'::jsonb END AS reactions,m.reactions_revision::int AS "reactionsRevision",
 (SELECT jsonb_build_object('_id',r.id,'fromUserId',r.from_user_id,'content',CASE WHEN r.deleted_at IS NULL THEN r.content ELSE '' END,'messageType',r.message_type,'deletedAt',r.deleted_at) FROM chat_group_messages r WHERE r.id=m.reply_to_id AND r.group_id=m.group_id AND r.created_at>=${joined} AND NOT (${viewer}=ANY(r.hidden_for))) AS "replyTo",${profile} AS sender FROM chat_group_messages m JOIN users u ON u.id=m.from_user_id`;

export function registerChatGroupRoutes(app:Express,requireAuth:RequestHandler){
 const limiter=rateLimit({windowMs:60000,max:40,keyGenerator:(req:any)=>req.session?.user?.userId||req.session?.userId||'unauthenticated',standardHeaders:true,legacyHeaders:false});
 const register=(method:'get'|'post',path:string,run:(db:any,actor:string,req:any)=>Promise<any>)=>app[method]('/api/messages/groups'+path,requireAuth,...(method==='post'?[limiter]:[]),async(req:any,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  const actor=req.session?.user?.userId||req.session?.userId;if(!actor)return void res.status(401).json({error:'Not authenticated'});
  let db:any;try{db=await getPostgresPool().connect();await db.query('BEGIN');const result=await run(db,actor,req);await db.query('COMMIT');res.json(result.data??result);if(result.presenceNotify)chatService.broadcastToUsers(result.presenceNotify,{type:'group:listening',groupId:result.groupId});if(result.change)chatService.broadcastToUsers(result.notify,{type:'group:message-updated',groupId:result.groupId,...result.change});if(result.notify)chatService.broadcastToUsers(result.notify,{type:'group:updated',groupId:result.groupId});if(result.push)for(const userId of result.push)void import('../services/pushNotificationService').then(({PushNotificationService})=>PushNotificationService.sendToUserAllChannels(userId,{title:result.title,body:result.body,data:{type:'new_message',screen:'group-chat',groupId:result.groupId},tag:`group-${result.groupId}`} as any)).catch(()=>{});}catch(error:any){await db?.query('ROLLBACK').catch(()=>{});if(!error.status)logger.error('Group chat failed:',error);res.status(error.status||500).json({error:error.status?error.message:'Unable to update group',...(error.status&&error.code==='GROUP_GENRES_INVALID'?{code:error.code}:{})});}finally{db?.release();}
 });
 const member=async(db:any,actor:string,id:string,invited=false,left=false)=>{if(!idValid(id))throw fail(400,'Invalid group ID');const result=await db.query(`SELECT g.*,m.role,m.status,m.joined_at,m.left_at FROM chat_groups g JOIN chat_group_members m ON m.group_id=g.id WHERE g.id=$1 AND m.user_id=$2 FOR UPDATE OF g,m`,[id,actor]);const row=result.rows[0];if(!row||!(invited?['active','invited',...(left?['left']:[])]:['active',...(left?['left']:[])]).includes(row.status))throw fail(404,'Group unavailable');return row;};
 const audience=async(db:any,id:string)=>(await db.query("SELECT user_id FROM chat_group_members WHERE group_id=$1 AND status IN ('active','invited')",[id])).rows.map((r:any)=>r.user_id);
 register('get','',async(db,actor)=>({groups:(await db.query(`SELECT g.id AS "_id",g.name,g.avatar,g.genres,g.created_at AS "createdAt",me.role,me.status,
 (SELECT count(*)::int FROM chat_group_members WHERE group_id=g.id AND status='active') AS "memberCount",
 CASE WHEN me.status='active' THEN last.content ELSE '' END AS "lastMessage",CASE WHEN me.status='active' THEN last.deleted_at IS NOT NULL ELSE false END AS "lastMessageDeleted",CASE WHEN me.status='active' THEN last.sender_name ELSE '' END AS "lastSender",CASE WHEN me.status='active' THEN last.from_user_id ELSE NULL END AS "lastSenderId",COALESCE(last.created_at,g.created_at) AS "lastMessageAt",
 CASE WHEN me.status='active' THEN (SELECT count(*)::int FROM chat_group_messages WHERE group_id=g.id AND from_user_id<>$1 AND deleted_at IS NULL AND NOT ($1=ANY(hidden_for)) AND created_at>GREATEST(me.read_at,me.joined_at)) ELSE 0 END AS "unreadCount"
 FROM chat_groups g JOIN chat_group_members me ON me.group_id=g.id AND me.user_id=$1 LEFT JOIN LATERAL (SELECT CASE WHEN m.deleted_at IS NULL THEN m.content ELSE '' END content,m.deleted_at,m.from_user_id,COALESCE(NULLIF(u.full_name,''),u.username) sender_name,m.created_at FROM chat_group_messages m JOIN users u ON u.id=m.from_user_id WHERE m.group_id=g.id AND m.created_at>=me.joined_at AND (me.left_at IS NULL OR m.created_at<=me.left_at) AND NOT ($1=ANY(m.hidden_for)) ORDER BY m.created_at DESC,m.id DESC LIMIT 1) last ON true WHERE me.status IN ('active','invited','left') ORDER BY COALESCE(last.created_at,g.created_at) DESC LIMIT 100`,[actor])).rows}));
 register('post','',async(db,actor,req)=>{const input=groupInput(req.body,actor,await allowedMusicStyles(req.body?.genres)),id=newPublicUserId();const eligible=await db.query(`SELECT u.id FROM users u WHERE u.id=ANY($2::text[]) AND (u.status IS NULL OR u.status='active') AND EXISTS(SELECT 1 FROM user_follows f WHERE (f.follower_id=$1 AND f.following_id=u.id) OR (f.following_id=$1 AND f.follower_id=u.id))`,[actor,input.memberIds]);if(eligible.rows.length!==input.memberIds.length)throw fail(403,'Choose followers or followed members');await db.query('INSERT INTO chat_groups(id,name,avatar,created_by,genres) VALUES($1,$2,$3,$4,$5::text[])',[id,input.name,input.avatar,actor,input.genres]);await db.query("INSERT INTO chat_group_members(group_id,user_id,role,status) VALUES($1,$2,'admin','active')",[id,actor]);await db.query("INSERT INTO chat_group_members(group_id,user_id) SELECT $1,unnest($2::text[])",[id,input.memberIds]);return {data:{groupId:id},groupId:id,notify:[actor,...input.memberIds],push:input.memberIds,title:input.name,body:'Grup sohbetine davet edildiniz.'};});
 register('get','/:id',async(db,actor,req)=>{const group=await member(db,actor,req.params.id,true,true);const members=group.status==='active'?(await db.query(`SELECT ${profile} AS user,m.role,m.status FROM chat_group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=$1 AND m.status IN ('active','invited') ORDER BY m.role,m.joined_at`,[group.id])).rows:[];const invitedBy=(await db.query(`SELECT ${profile} AS user FROM users u WHERE u.id=$1`,[group.created_by])).rows[0]?.user;return {group:{invitedBy,createdBy:group.created_by,_id:group.id,name:group.name,avatar:group.avatar,genres:group.genres||[],role:group.role,status:group.status,members:members.map((m:any)=>({...m,listening:groupListening.members(group.id,m.status==='active'?[m.user._id]:[])[0]||undefined}))}};});
 register('post','/:id/listening',async(db,actor,req)=>{
  const g=await member(db,actor,req.params.id);const {stationId,clientId,revision,listening}=req.body||{};
  if(typeof clientId!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(clientId)||!Number.isSafeInteger(revision)||revision<1||typeof listening!=='boolean'||listening&&!idValid(stationId))throw fail(400,'Invalid listening state');
  let station=null;
  if(listening){const row=await getPublicStationByIdentifier(stationId);if(!row)throw fail(404,'Station unavailable');const radio=canonicalRadio({stationId,intent:'together'},row);station={stationId:radio.stationId,name:radio.name,logo:radio.logo};}
  const changed=groupListening.update(actor,g.id,station,clientId,revision);
  return {data:{success:true},groupId:g.id,presenceNotify:changed?(await db.query("SELECT user_id FROM chat_group_members WHERE group_id=$1 AND status='active'",[g.id])).rows.map((r:any)=>r.user_id):undefined};
 });
 register('post','/:id/respond',async(db,actor,req)=>{const g=await member(db,actor,req.params.id,true);if(typeof req.body?.accept!=='boolean'||g.status!=='invited')throw fail(400,'Invitation unavailable');await db.query("UPDATE chat_group_members SET status=$3,joined_at=now(),read_at=now(),left_at=NULL WHERE group_id=$1 AND user_id=$2",[g.id,actor,req.body.accept?'active':'declined']);return {data:{success:true},groupId:g.id,notify:await audience(db,g.id)};});
 const readable=async(db:any,g:any,actor:string,id:unknown)=>{
  if(!idValid(id))throw fail(400,'Invalid message ID');
  const row=(await db.query('SELECT * FROM chat_group_messages WHERE id=$1 AND group_id=$2 AND created_at>=$3 AND NOT ($4=ANY(hidden_for)) FOR UPDATE',[id,g.id,g.joined_at,actor])).rows[0];
  if(!row)throw fail(404,'Message unavailable');return row;
 };
 const activeAudience=async(db:any,id:string)=>(await db.query("SELECT user_id FROM chat_group_members WHERE group_id=$1 AND status='active'",[id])).rows.map((r:any)=>r.user_id);
 register('get','/:id/messages',async(db,actor,req)=>{
  const g=await member(db,actor,req.params.id,false,true),before=req.query.before;
  if(before!==undefined&&!idValid(before))throw fail(400,'Invalid cursor');
  const rows=(await db.query(`${messageSelect('$4','$2')} WHERE m.group_id=$1 AND m.created_at>=$2 AND ($5::timestamptz IS NULL OR m.created_at<=$5) AND NOT ($4=ANY(m.hidden_for)) AND ($3='' OR (m.created_at,m.id)<(SELECT created_at,id FROM chat_group_messages WHERE id=$3 AND group_id=$1)) ORDER BY m.created_at DESC,m.id DESC LIMIT 51`,[g.id,g.joined_at,before||'',actor,g.left_at||null])).rows;
  const pins=(await db.query(`${messageSelect('$3','$2')} WHERE m.group_id=$1 AND m.created_at>=$2 AND ($4::timestamptz IS NULL OR m.created_at<=$4) AND NOT ($3=ANY(m.hidden_for)) AND m.deleted_at IS NULL AND m.pinned_at IS NOT NULL ORDER BY m.pinned_at DESC LIMIT 20`,[g.id,g.joined_at,actor,g.left_at||null])).rows;
  await db.query("UPDATE chat_inbox_state SET marked_unread=false WHERE user_id=$1 AND kind='group' AND target_id=$2",[actor,g.id]);
  await db.query("UPDATE chat_group_members SET read_at=now() WHERE group_id=$1 AND user_id=$2 AND status='active'",[g.id,actor]);
  return {messages:rows.slice(0,50).reverse(),hasMore:rows.length>50,pinnedMessages:pins};
 });
 register('post','/:id/messages',async(db,actor,req)=>{
  const g=await member(db,actor,req.params.id);let {content,messageType='text',imageUrl,replyToId}=req.body||{};
  if(typeof content!=='string'||!content.trim()||content.length>2000||!['text','emoji','gif','image','station'].includes(messageType))throw fail(400,'Invalid message');
  content=content.trim();
  if(replyToId!==undefined){const parent=await readable(db,g,actor,replyToId);if(parent.deleted_at)throw fail(400,'Reply unavailable');}
  if(messageType==='station'){const radio=radioRequest(content);if(!radio)throw fail(400,'Invalid radio');const station=await getPublicStationByIdentifier(radio.stationId);if(!station)throw fail(404,'Radio unavailable');content=JSON.stringify(canonicalRadio(radio,station));}
  if(messageType==='gif'&&!/^klipy:[a-zA-Z0-9_-]{1,200}$/.test(imageUrl||''))throw fail(400,'Invalid GIF');
  if(messageType==='image'&&!/^\/uploads\/chat\/[a-z0-9_-]+\.(?:jpe?g|png|gif|webp)$/i.test(imageUrl||''))throw fail(400,'Invalid image');
  const id=newPublicUserId();await db.query('INSERT INTO chat_group_messages(id,group_id,from_user_id,content,message_type,image_url,reply_to_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,g.id,actor,content,messageType,['gif','image'].includes(messageType)?imageUrl:null,replyToId||null]);
  const message=(await db.query(messageSelect()+' WHERE m.id=$1',[id,actor,g.joined_at])).rows[0],users=await activeAudience(db,g.id);
  const muted=new Set((await db.query("SELECT user_id FROM chat_inbox_state WHERE kind='group' AND target_id=$1 AND muted",[g.id])).rows.map((r:any)=>r.user_id));
  return {data:{message},groupId:g.id,notify:users,push:users.filter((id:string)=>id!==actor&&!muted.has(id)),title:g.name,body:'Grubunuzda yeni mesaj var.'};
 });
 register('post','/:id/delete',async(db,actor,req)=>{
  const g=await member(db,actor,req.params.id),{messageId,scope}=req.body||{};if(!['self','everyone'].includes(scope))throw fail(400,'Invalid deletion scope');
  const row=await readable(db,g,actor,messageId);if(scope==='everyone'&&row.from_user_id!==actor)throw fail(403,'Only the sender can delete for everyone');
  if(scope==='everyone'&&!row.deleted_at&&(!Number.isFinite(new Date(row.created_at).getTime())||Date.now()-new Date(row.created_at).getTime()>=48*60*60*1000))throw fail(409,'Delete for everyone is available for 48 hours');
  if(scope==='self')await db.query('UPDATE chat_group_messages SET hidden_for=array_append(hidden_for,$2) WHERE id=$1',[messageId,actor]);
  else {const deleted=await db.query("UPDATE chat_group_messages SET deleted_at=COALESCE(deleted_at,now()),content='',image_url=NULL,message_type='text',reply_to_id=NULL,pinned_at=NULL,updated_at=now() WHERE id=$1 AND (deleted_at IS NOT NULL OR created_at>statement_timestamp()-interval '48 hours') RETURNING id",[messageId]);if(!deleted.rows.length)throw fail(409,'Delete for everyone is available for 48 hours');}
  return {data:{success:true},groupId:g.id,notify:scope==='self'?[actor]:await activeAudience(db,g.id),change:{messageId,scope,userId:actor,deletedAt:scope==='everyone'?row.deleted_at||new Date().toISOString():undefined}};
 });
 register('post','/:id/react',async(db,actor,req)=>{
  const g=await member(db,actor,req.params.id),{messageId,emoji}=req.body||{};
  if(!validChatReaction(emoji))throw fail(400,'Invalid reaction');
  const original=await readable(db,g,actor,messageId);if(original.deleted_at)throw fail(404,'Message unavailable');
  const row=await setChatReaction(db,'group',messageId,actor,emoji,g.id);if(!row)throw fail(404,'Message unavailable');
  const message=(await db.query(messageSelect()+' WHERE m.id=$1',[messageId,actor,g.joined_at])).rows[0];
  return {data:{message},groupId:g.id,notify:await activeAudience(db,g.id),change:{messageId,reactions:message.reactions,reactionsRevision:message.reactionsRevision}};
 });
 register('post','/:id/pin',async(db,actor,req)=>{
  const g=await member(db,actor,req.params.id),{messageId,pinned}=req.body||{};if(typeof pinned!=='boolean')throw fail(400,'Invalid pin');
  const row=await readable(db,g,actor,messageId);if(row.deleted_at)throw fail(400,'Deleted message cannot be pinned');
  await db.query('UPDATE chat_group_messages SET pinned_at=CASE WHEN $2 THEN now() ELSE NULL END,updated_at=now() WHERE id=$1',[messageId,pinned]);
  const message=(await db.query(messageSelect()+' WHERE m.id=$1',[messageId,actor,g.joined_at])).rows[0];
  return {data:{message},groupId:g.id,notify:await activeAudience(db,g.id),change:{messageId,pinnedAt:message?.pinnedAt,pinUpdatedAt:message?.pinUpdatedAt}};
 });
 register('post','/:id/role',async(db,actor,req)=>{
  const g=await member(db,actor,req.params.id);if(g.role!=='admin')throw fail(403,'Admin required');
  const {userId,role}=req.body||{};
  if(!idValid(userId)||!['admin','member'].includes(role)||userId===actor)throw fail(400,'Invalid role change');
  if(userId===g.created_by&&role!=='admin')throw fail(403,'The creator remains admin');
  const changed=await db.query("UPDATE chat_group_members SET role=$3 WHERE group_id=$1 AND user_id=$2 AND status='active' RETURNING user_id",[g.id,userId,role]);
  if(!changed.rows.length)throw fail(404,'Active member not found');
  return {data:{success:true},groupId:g.id,notify:await audience(db,g.id)};
 });
 register('post','/:id/genres',async(db,actor,req)=>{
  const g=await member(db,actor,req.params.id);if(g.role!=='admin')throw fail(403,'Admin required');
  const genres=groupMusicInput(req.body?.genres,await allowedMusicStyles(req.body?.genres));
  await db.query('UPDATE chat_groups SET genres=$2::text[] WHERE id=$1',[g.id,genres]);
  return {data:{success:true},groupId:g.id,notify:await audience(db,g.id)};
 });
 register('post','/:id/photo',async(db,actor,req)=>{
  const g=await member(db,actor,req.params.id);if(g.role!=='admin')throw fail(403,'Admin required');
  const {avatar}=req.body||{};
  if(avatar!==null&&(typeof avatar!=='string'||!/^\/uploads\/chat\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(avatar)))throw fail(400,'Invalid group photo');
  await db.query('UPDATE chat_groups SET avatar=$2 WHERE id=$1',[g.id,avatar]);
  return {data:{success:true},groupId:g.id,notify:await audience(db,g.id)};
 });
 register('post','/:id/leave',async(db,actor,req)=>{const g=await member(db,actor,req.params.id);if(g.role==='admin'){const next=(await db.query("SELECT user_id FROM chat_group_members WHERE group_id=$1 AND user_id<>$2 AND status='active' ORDER BY joined_at LIMIT 1",[g.id,actor])).rows[0];if(next)await db.query("UPDATE chat_group_members SET role='admin' WHERE group_id=$1 AND user_id=$2",[g.id,next.user_id]);else await db.query("UPDATE chat_group_members SET status='declined' WHERE group_id=$1 AND status='invited'",[g.id]);}const users=await audience(db,g.id);await db.query("UPDATE chat_group_members SET status='left',left_at=now() WHERE group_id=$1 AND user_id=$2",[g.id,actor]);return {data:{success:true},groupId:g.id,notify:users};});
}
