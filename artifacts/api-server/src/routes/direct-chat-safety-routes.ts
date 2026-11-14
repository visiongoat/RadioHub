import type {Express,RequestHandler} from 'express';
import {rateLimit} from 'express-rate-limit';
import {directSafety,setDirectBlock,reportDirectChat} from '../data/direct-chat-safety';
import {pgFindUserById} from '../data/postgres-user-store';
import {chatService} from '../services/chat-service';
export function registerDirectChatSafetyRoutes(app:Express,auth:RequestHandler){
 const limit=rateLimit({windowMs:60000,max:30,keyGenerator:(req:any)=>String(req.session?.user?.userId||'anonymous'),standardHeaders:true,legacyHeaders:false});
 const actor=(req:any)=>String(req.session?.user?.userId||'');
 const validate:RequestHandler=async(req,res,next)=>{
  const owner=actor(req),target=String(req.params.partnerId||'').toLowerCase();
  if(!owner)return void res.status(401).json({error:'Not authenticated'});
  if(!/^[a-f0-9]{24}$/.test(target)||owner===target)return void res.status(400).json({error:'Invalid contact'});
  try{if(!await pgFindUserById(target))return void res.status(404).json({error:'Contact unavailable'});req.params.partnerId=target;next();}catch{res.status(503).json({error:'Safety settings unavailable'});}
 };
 app.get('/api/messages/safety/:partnerId',auth,validate,async(req,res)=>{
  try{res.json(await directSafety(actor(req),String(req.params.partnerId)));}catch{res.status(503).json({error:'Safety settings unavailable'});}
 });
 app.put('/api/messages/safety/:partnerId',auth,limit,validate,async(req,res)=>{
  if(typeof req.body?.blocked!=='boolean')return void res.status(400).json({error:'Invalid preference'});
  try{
   const owner=actor(req),target=String(req.params.partnerId),state=await setDirectBlock(owner,target,req.body.blocked);
   chatService.sendToUser(owner,{type:'chat:safety',partnerId:target,...state});
   // Neutral permission refresh only; never disclose who blocked whom.
   chatService.sendToUser(target,{type:'chat:permissions',partnerId:owner});
   res.json(state);
  }catch{res.status(503).json({error:'Safety settings unavailable'});}
 });
 app.post('/api/messages/safety/:partnerId/report',auth,limit,validate,async(req,res)=>{
  const reason=req.body?.reason;
  if(!['harassment','spam','other'].includes(reason))return void res.status(400).json({error:'Invalid reason'});
  try{
   if(!await reportDirectChat(actor(req),String(req.params.partnerId),reason))return void res.status(404).json({error:'Conversation unavailable'});
   res.json({success:true});
  }catch{res.status(503).json({error:'Report unavailable'});}
 });
}
