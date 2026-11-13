import {setChatReaction,validChatReaction} from '../data/chat-reactions';
import {registerChatInboxRoutes} from './chat-inbox-routes';
import {getPostgresPool} from '../postgres-runtime';
import {registerChatGroupRoutes} from './chat-group-routes';
import { chatListening } from '../services/chat-listening';
import { radioRequest, canonicalRadio } from '../utils/chat-radio';
import { getPublicStationByIdentifier } from '../data/station-read-store';
import { chatAudioExtension, validChatAudioPath } from '../utils/chat-audio';
import type { Express } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import multer from "multer";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { type WebSocketServer, type WebSocket } from 'ws';
import { chatService } from "../services/chat-service";
import { logger } from "../utils/logger";
import { CacheManager } from '../cache';
import { notificationStore, pgMarkConversationNotificationsRead, pgUpsertMessageNotification, } from "../data/postgres-notification-store";
import { pgFindUserById, userStore } from "../data/postgres-user-store";
import { engagementStore } from "../services/user-engagement-service";
import { pgFollowPage, pgIsFollowing } from "../data/postgres-engagement-store";
import { messageStore, pgPinChatMessage, pgPinnedChatMessages, pgDeleteChatMessage, pgChatMessageById, pgConversationMessages, pgConversations, pgCreateMessage, pgMarkMessagesRead, pgMessageContacts, pgUnreadMessageCount, pgHasConversation } from "../data/postgres-message-store";
function normalizeIp(ip: string | undefined): string {
    if (!ip)
        return 'unknown';
    // Treat an IPv4-mapped socket as IPv4 before applying the IPv6 subnet key.
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
export const messageRateLimitKey = (req: any): string =>
    req.session?.user?.userId || ipKeyGenerator(normalizeIp(req.ip));
// 20 messages per minute per user — allows normal chat while blocking spam
const messageSendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    keyGenerator: messageRateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many messages sent. Please slow down." },
});
// 10 image uploads per 5 minutes per user
const imageUploadLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    keyGenerator: messageRateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many image uploads. Please wait a moment." },
});
// ─── In-memory WS ticket store (userId, expires in 60s) ───────────────────────
const wsTickets = new Map<string, {
    userId: string;
    expiresAt: number;
}>();
// Per-user live ticket tracking — revoke previous ticket when a user requests a new one
// (bounds memory at O(users) instead of O(ticket requests/minute)).
const userActiveTicket = new Map<string, string>();
// Hard cap to protect against malicious auth-then-request-ticket loops from many accounts.
const WS_TICKETS_MAX = 20000;
// Single helper: always delete ticket from both maps atomically to keep lifecycles symmetric.
function deleteWsTicket(ticket: string): void {
    const data = wsTickets.get(ticket);
    if (!data)
        return;
    wsTickets.delete(ticket);
    if (userActiveTicket.get(data.userId) === ticket) {
        userActiveTicket.delete(data.userId);
    }
}
function issueWsTicket(userId: string): string {
    // Revoke any previous ticket for this user (only one pending ticket at a time)
    const prior = userActiveTicket.get(userId);
    if (prior)
        deleteWsTicket(prior);
    // Evict oldest if over hard cap (Map iteration order = insertion order).
    // Use symmetric deletion so userActiveTicket's reverse mapping is also cleared.
    if (wsTickets.size >= WS_TICKETS_MAX) {
        const oldest = wsTickets.keys().next().value;
        if (oldest !== undefined)
            deleteWsTicket(oldest);
    }
    const ticket = crypto.randomBytes(32).toString("hex");
    wsTickets.set(ticket, { userId, expiresAt: Date.now() + 60000 });
    userActiveTicket.set(userId, ticket);
    return ticket;
}
// Cleanup expired tickets every 2 minutes — also sweeps orphaned userActiveTicket entries
// whose ticket no longer exists in wsTickets (defensive invariant cleanup).
// unref() so this background timer never blocks process exit during shutdown.
const _ticketCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ticket, data] of wsTickets) {
        if (data.expiresAt < now)
            deleteWsTicket(ticket);
    }
    for (const [uid, ticket] of userActiveTicket) {
        if (!wsTickets.has(ticket))
            userActiveTicket.delete(uid);
    }
}, 120000);
if (typeof (_ticketCleanupTimer as any).unref === 'function')
    (_ticketCleanupTimer as any).unref();
// ─── Session userId helper ─────────────────────────────────────────────────────
function getSessionUserId(req: any): string | null {
    return req.session?.user?.userId || req.session?.userId || null;
}
function publicChatUser(user: any): any | null {
    if (!user)
        return null;
    return {
        _id: String(user._id ?? user.id),
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar,
        profileImageUrl: user.profileImageUrl,
    };
}
async function markConversationNotificationsRead(userId: string, partnerId: string): Promise<void> {
    {
        await pgMarkConversationNotificationsRead(userId, partnerId);
        await CacheManager.clearByPattern(`notifications:postgres:${userId}:`).catch(() => {});
    }
}
// ─── Follow check helper ───────────────────────────────────────────────────────
async function canChat(userA: string, userB: string): Promise<boolean> {
    {
        const [aFollowsB, bFollowsA] = await Promise.all([
            pgIsFollowing(userA, userB), pgIsFollowing(userB, userA),
        ]);
        return aFollowsB || bFollowsA;
    }
}
// Starting a conversation requires following an open profile. Existing participants
// may reply without following the sender back; reading old history remains allowed.
async function canSendConversation(senderId: string, recipientId: string): Promise<boolean> {
    if (await pgHasConversation(senderId, recipientId)) return true;
    const [follows, recipient] = await Promise.all([pgIsFollowing(senderId, recipientId), pgFindUserById(recipientId)]);
    return follows && recipient?.isPublicProfile === true;
}
async function canReadConversation(userId: string, partnerId: string): Promise<boolean> {
    return await canChat(userId, partnerId) || await pgHasConversation(userId, partnerId);
}
// ─── Route registration ───────────────────────────────────────────────────────
export function registerMessagesRoutes(app: Express, chatWss: WebSocketServer, deps: any) {
    const { requireAuth } = deps;
    app.use('/api/messages', (_req, res, next) => {
        res.setHeader('Cache-Control', 'private, no-store');
        next();
    });
    registerChatGroupRoutes(app,requireAuth);
    registerChatInboxRoutes(app,requireAuth);
    // ── GET /api/messages/ws-ticket ─────────────────────────────────────────────
    // Returns a one-time ticket for WebSocket auth (expires in 60s)
    app.get("/api/messages/ws-ticket", requireAuth, (req, res) => {
        const userId = getSessionUserId(req);
        if (!userId)
            return void res.status(401).json({ error: "Not authenticated" });
        const ticket = issueWsTicket(userId);
        res.json({ ticket });
    });
    // ── GET /api/messages/contacts ──────────────────────────────────────────────
    // Returns people the current user can chat with (follows them or they follow back)
    app.get("/api/messages/contacts", requireAuth, async (req, res) => {
        try {
            const userId = getSessionUserId(req);
            if (!userId)
                return void res.status(401).json({ error: "Not authenticated" });
            {
                const contacts = (await pgMessageContacts(userId)).map((contact) => ({
                    ...contact, online: chatService.isOnline(String(contact._id)),
                }));
                return void res.json({ contacts });
            }
        }
        catch (err) {
            logger.error("Failed to fetch contacts:", err);
            res.status(500).json({ error: "Failed to fetch contacts" });
        }
    });
    // ── GET /api/messages/conversations ─────────────────────────────────────────
    app.get("/api/messages/conversations", requireAuth, async (req, res) => {
        try {
            const rawId = getSessionUserId(req);
            if (!rawId)
                return void res.status(401).json({ error: "Not authenticated" });
            {
                const conversations = (await pgConversations(rawId)).map((conversation) => ({
                    ...conversation, online: chatService.isOnline(conversation.partnerId),
                }));
                return void res.json({ conversations });
            }
        }
        catch (error) {
            logger.error("Failed to fetch conversations:", error);
            res.status(500).json({ error: "Failed to fetch conversations" });
        }
    });
    // ── GET /api/messages/unread-count ──────────────────────────────────────────
    app.get("/api/messages/unread-count", requireAuth, async (req, res) => {
        try {
            const rawId = getSessionUserId(req);
            if (!rawId)
                return void res.status(401).json({ error: "Not authenticated" });
            {
                return void res.json({ count: await pgUnreadMessageCount(rawId) });
            }
        }
        catch {
            res.status(500).json({ error: "Failed to fetch unread count" });
        }
    });
    // ── GET /api/messages/conversation/:partnerId ────────────────────────────────
    app.get("/api/messages/conversation/:partnerId", requireAuth, async (req, res) => {
        try {
            const rawId = getSessionUserId(req);
            if (!rawId)
                return void res.status(401).json({ error: "Not authenticated" });
            {
                const partnerId = req.params.partnerId.toLowerCase();
                if (!/^[0-9a-f]{24}$/i.test(partnerId))
                    return void res.status(400).json({ error: "Invalid partner ID" });
                const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 50, 100));
                const before = req.query.before;
                if (before !== undefined && (typeof before !== 'string' || !/^[0-9a-f]{24}$/i.test(before)))
                    return void res.status(400).json({ error: 'Invalid message cursor' });
                if (!await canReadConversation(rawId, partnerId))
                    return void res.status(403).json({ error: 'Conversation not available' });
                const [pageMessages, partner] = await Promise.all([
                    pgConversationMessages(rawId, partnerId, before as string | undefined, limit + 1),
                    pgFindUserById(partnerId),
                ]);
                const messages = pageMessages.slice(-limit);
                await pgMarkMessagesRead(rawId, partnerId, messages.map(message => message._id));
                await markConversationNotificationsRead(rawId, partnerId);
                chatService.sendToUser(partnerId, { type: "chat:read", byUserId: rawId });
                return void res.json({
                    messages,
                    partner: partner ? { ...publicChatUser(partner), online: chatService.isOnline(partnerId) } : null,
                    hasMore: pageMessages.length > limit,
                    canSend: await canSendConversation(rawId, partnerId),
                    listening: chatListening.between(rawId,partnerId),
                    pinnedMessages:await pgPinnedChatMessages(rawId,partnerId),
                });
            }
        }
        catch (error) {
            logger.error("Failed to fetch messages:", error);
            res.status(500).json({ error: "Failed to fetch messages" });
        }
    });
    // Voice notes use bounded memory uploads and server-selected file extensions.
    const voiceUpload = multer({ storage: multer.memoryStorage(), limits: {fileSize:8*1024*1024,files:1}, fileFilter:(_req,file,cb)=>cb(null,/^audio\/(?:webm|mp4|x-m4a|ogg)(?:;|$)/i.test(file.mimetype)) });
    app.post('/api/messages/upload-audio',requireAuth,imageUploadLimiter,(req:any,res)=>{
      voiceUpload.single('audio')(req,res,async(error:any)=>{
        if(error)return void res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({error:'Voice upload failed'});
        const bytes=req.file?.buffer;
        const ext=bytes&&chatAudioExtension(bytes);
        if(!ext)return void res.status(400).json({error:'Unsupported voice format'});
        const directory=path.resolve(process.cwd(),'public','uploads','chat');
        const filename=`voice-${crypto.randomBytes(16).toString('hex')}.${ext}`;
        try{await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,filename),bytes,{flag:'wx'});res.json({audioUrl:`/uploads/chat/${filename}`});}
        catch{res.status(500).json({error:'Voice upload failed'});}
      });
    });
    // ── POST /api/messages/upload-image ─────────────────────────────────────────
    const chatUploadsDir = path.resolve(process.cwd(), 'public', 'uploads', 'chat');
    fs.mkdir(chatUploadsDir, { recursive: true }).catch(() => { });
    const chatUpload = multer({
        storage: multer.diskStorage({
            destination: chatUploadsDir,
            filename: (_req, file, cb) => {
                const ext = path.extname(file.originalname) || '.jpg';
                cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
            }
        }),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
            cb(null, file.mimetype.startsWith('image/'));
        }
    });
    app.post("/api/messages/upload-image", requireAuth, imageUploadLimiter, chatUpload.single('image'), async (req: any, res) => {
        try {
            if (!req.file)
                return void res.status(400).json({ error: 'No image uploaded' });
            // Magic-byte validation — MIME header can be spoofed; file bytes cannot.
            const fh = await fs.open(req.file.path, 'r');
            const buf = Buffer.alloc(12);
            await fh.read(buf, 0, 12, 0);
            await fh.close();
            const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
            const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
            const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
            const isWebP = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
                && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
            if (!isJpeg && !isPng && !isGif && !isWebP) {
                await fs.unlink(req.file.path).catch(() => { });
                return void res.status(400).json({ error: 'Invalid image format' });
            }
            const imageUrl = `/uploads/chat/${req.file.filename}`;
            res.json({ imageUrl });
        }
        catch (error) {
            if (req.file?.path)
                await fs.unlink(req.file.path).catch(() => { });
            logger.error("Chat image upload failed:", error);
            res.status(500).json({ error: "Upload failed" });
        }
    });
    app.post('/api/messages/react',requireAuth,messageSendLimiter,async(req,res)=>{
      try{
        const actor=getSessionUserId(req);if(!actor)return void res.status(401).json({error:'Not authenticated'});
        const {messageId,emoji}=req.body||{};
        if(typeof messageId!=='string'||!/^[a-f0-9]{24}$/i.test(messageId)||!validChatReaction(emoji))return void res.status(400).json({error:'Invalid reaction request'});
        const row=await setChatReaction(getPostgresPool(),'direct',messageId.toLowerCase(),actor,emoji);
        if(!row)return void res.status(404).json({error:'Message unavailable'});
        const message=await pgChatMessageById(row.id);if(!message)return void res.status(404).json({error:'Message unavailable'});
        chatService.broadcastToUsers([message.fromUserId,message.toUserId],{type:'chat:reaction',message});
        res.setHeader('Cache-Control','private, no-store');res.json({message});
      }catch(error){logger.error('Chat reaction failed:',error);res.status(500).json({error:'Unable to react to message'});}
    });
    app.post('/api/messages/pin',requireAuth,messageSendLimiter,async(req,res)=>{
      try{
        const userId=getSessionUserId(req);if(!userId)return void res.status(401).json({error:'Not authenticated'});
        const {messageId,pinned}=req.body||{};
        if(typeof messageId!=='string'||!/^[a-f0-9]{24}$/i.test(messageId)||typeof pinned!=='boolean')return void res.status(400).json({error:'Invalid pin request'});
        const message=await pgPinChatMessage(userId,messageId.toLowerCase(),pinned);if(!message)return void res.status(404).json({error:'Message not found'});
        chatService.broadcastToUsers([message.fromUserId,message.toUserId],{type:'chat:pinned',message});
        res.json({message});
      }catch(error){logger.error('Chat pin failed:',error);res.status(500).json({error:'Unable to pin message'});}
    });
    app.post('/api/messages/delete',requireAuth,messageSendLimiter,async(req,res)=>{
      try{
        const userId=getSessionUserId(req);if(!userId)return void res.status(401).json({error:'Not authenticated'});
        const {messageId,scope}=req.body||{};
        if(typeof messageId!=='string'||!/^[a-f0-9]{24}$/i.test(messageId)||!['self','everyone'].includes(scope))return void res.status(400).json({error:'Invalid deletion request'});
        const id=messageId.toLowerCase(),message=await pgChatMessageById(id);
        if(!message||![message.fromUserId,message.toUserId].includes(userId))return void res.status(404).json({error:'Message not found'});
        if(scope==='everyone'&&message.fromUserId!==userId)return void res.status(403).json({error:'Only the sender can delete for everyone'});
        if(scope==='everyone'&&!message.deletedAt&&(!Number.isFinite(new Date(message.createdAt).getTime())||Date.now()-new Date(message.createdAt).getTime()>=48*60*60*1000))return void res.status(409).json({error:'Delete for everyone is available for 48 hours',code:'DELETE_WINDOW_EXPIRED'});
        const deleted=await pgDeleteChatMessage(userId,id,scope);if(!deleted)return void res.status(scope==='everyone'?409:404).json({error:scope==='everyone'?'Deletion window expired':'Message not found',...(scope==='everyone'?{code:'DELETE_WINDOW_EXPIRED'}:{})});
        chatListening.removeMessage(id,scope==='everyone'?[message.fromUserId,message.toUserId]:[userId]);
        await markConversationNotificationsRead(scope==='everyone'?message.toUserId:userId,scope==='everyone'?message.fromUserId:message.fromUserId===userId?message.toUserId:message.fromUserId);
        const payload={type:'chat:deleted',messageId:id,scope,fromUserId:message.fromUserId,toUserId:message.toUserId,deletedAt:deleted.deletedAt};
        chatService.broadcastToUsers(scope==='everyone'?[message.fromUserId,message.toUserId]:[userId],payload);
        res.json({success:true,...payload});
      }catch(error){logger.error('Chat deletion failed:',error);res.status(500).json({error:'Unable to delete message'});}
    });
    // ── POST /api/messages/send ──────────────────────────────────────────────────
    app.post("/api/messages/send", requireAuth, messageSendLimiter, async (req, res) => {
        try {
            const fromUserId = getSessionUserId(req);
            if (!fromUserId)
                return void res.status(401).json({ error: "Not authenticated" });
            const { toUserId, content, messageType, imageUrl,replyToId } = req.body || {};
            if (!toUserId || typeof content !== 'string' || !content.trim()) {
                return void res.status(400).json({ error: "toUserId and content are required" });
            }
            if (content.trim().length > 2000) {
                return void res.status(400).json({ error: "Message too long (max 2000 chars)" });
            }
            if (typeof toUserId !== 'string' || !/^[a-f0-9]{24}$/i.test(toUserId)) {
                return void res.status(400).json({ error: 'Invalid toUserId' });
            }
            const targetId = toUserId.toLowerCase();
            if (targetId.toString() === fromUserId) {
                return void res.status(400).json({ error: "Cannot message yourself" });
            }
            const allowed = await canSendConversation(fromUserId, targetId.toString());
            if (!allowed) {
                return void res.status(403).json({
                    error: "Follow this public profile before starting a conversation",
                });
            }
            const targetUser: any = await pgFindUserById(targetId.toString());
            if (!targetUser || (targetUser.status && targetUser.status !== 'active')) {
                return void res.status(404).json({ error: "User not found" });
            }
            const validType = ['text', 'image', 'emoji', 'gif', 'audio', 'station'].includes(messageType) ? messageType : 'text';
            if (validType === 'image' && (typeof imageUrl !== 'string' || !/^\/uploads\/chat\/[a-z0-9_-]+\.(?:jpe?g|png|gif|webp)$/i.test(imageUrl)))
                return void res.status(400).json({ error: 'Invalid uploaded image URL' });
            // GIFs store a KLIPY reference, never arbitrary external media URLs.
            if (validType === 'audio' && !validChatAudioPath(imageUrl)) return void res.status(400).json({error:'Invalid voice URL'});
            if (validType === 'gif' && (typeof imageUrl !== 'string' || !/^klipy:[a-zA-Z0-9_-]{1,200}$/.test(imageUrl)))
                return void res.status(400).json({ error: 'Invalid GIF reference' });
            let storedContent=content.trim();
            if(validType==='station'){
              const radio=radioRequest(storedContent);if(!radio)return void res.status(400).json({error:'Invalid shared radio'});
              const station=await getPublicStationByIdentifier(radio.stationId);if(!station)return void res.status(404).json({error:'Radio unavailable'});
              storedContent=JSON.stringify(canonicalRadio(radio,station));
            }
            let replyTo:any;
            if(replyToId!==undefined){
              if(typeof replyToId!=='string'||!/^[a-f0-9]{24}$/i.test(replyToId))return void res.status(400).json({error:'Invalid reply'});
              const original=await pgChatMessageById(replyToId.toLowerCase());
              if(!original||original.deletedAt||original.hiddenFor?.includes(fromUserId)||!((original.fromUserId===fromUserId&&original.toUserId===targetId)||(original.toUserId===fromUserId&&original.fromUserId===targetId)))return void res.status(404).json({error:'Reply message unavailable'});
              replyTo={_id:original._id,fromUserId:original.fromUserId,content:original.content,messageType:original.messageType};
            }
            const messageInput = {
                fromUserId, toUserId: targetId.toString(), content: storedContent,replyToId:replyTo?._id,
                messageType: validType, imageUrl: (validType === 'image' || validType === 'gif' || validType === 'audio') && imageUrl ? imageUrl : undefined,
            };
            let message: any;
            {
                try {
                    message = await pgCreateMessage({
                        ...messageInput, ...(message?._id ? { id: message._id.toString() } : {}),
                        ...(message?.createdAt ? { createdAt: message.createdAt } : {}),
                    });
                }
                catch (error) {
                    throw error;
                }
            }
            if(replyTo)message.replyTo=replyTo;
            const sender: any = await pgFindUserById(fromUserId);
            const wsPayload = {
                type: "chat:message",
                message: {
                    _id: message._id.toString(),
                    fromUserId,
                    toUserId: targetId.toString(),
                    content: message.content,
                    messageType: message.messageType || 'text',
                    imageUrl: message.imageUrl,
                    replyToId:message.replyToId,replyTo:message.replyTo,
                    read: false,
                    createdAt: message.createdAt,
                },
                sender: publicChatUser(sender),
            };
            chatService.sendToUser(targetId.toString(), wsPayload);
            chatService.sendToUser(fromUserId, { ...wsPayload, echo: true });
            // Only notify if recipient is NOT currently viewing this conversation
            const isViewingConversation = chatService.isViewingConversation(targetId.toString(), fromUserId);
            const muted=!isViewingConversation && (await getPostgresPool().query("SELECT 1 FROM chat_inbox_state WHERE user_id=$1 AND kind='direct' AND target_id=$2 AND muted",[targetId.toString(),fromUserId])).rows.length>0;
            if (!isViewingConversation && !muted) {
                try {
                    // Upsert: one unread notification per sender (10 messages → 1 notification)
                    const notificationInput = {
                        userId: targetId.toString(), fromUserId,
                        title: "Yeni mesaj",
                        message: `${sender?.fullName || sender?.username || "Someone"} size mesaj yazdı`,
                        createdAt: new Date(),
                    };
                    {
                        await pgUpsertMessageNotification({
                            ...notificationInput,
                        });
                        await CacheManager.clearByPattern(`notifications:postgres:${targetId}:`).catch(() => {});
                    }
                    // WEB PUSH (2026-07-04): also notify the recipient's browser when
                    // they're not viewing the conversation — until now new messages
                    // produced only an in-app socket event + DB row, so users away
                    // from the tab never saw anything on their PC. Fire-and-forget;
                    // sendToUserAllChannels covers web push AND mobile push tokens.
                    void import('../services/pushNotificationService')
                        .then(({ PushNotificationService }) => PushNotificationService.sendToUserAllChannels(targetId.toString(), {
                        title: sender?.fullName || sender?.username || 'Mega Radio',
                        body: 'Yeni bir mesajınız var.',
                        data: { type: 'new_message', screen: 'messages', fromUserId, userName: sender?.fullName || sender?.username || 'MegaRadio' },
                        url: '/profile/messages',
                        tag: `dm-${fromUserId}`,
                    } as any))
                        .catch(() => { });
                    chatService.sendToUser(targetId.toString(), {
                        type: "notification:new_message",
                        fromUser: { _id: fromUserId, username: sender?.username, fullName: sender?.fullName, avatar: sender?.avatar || sender?.profileImageUrl },
                        preview: content.trim().substring(0, 60),
                    });
                }
                catch { }
            }
            res.json({ success: true, message });
        }
        catch (error) {
            logger.error("Failed to send message:", error);
            res.status(500).json({ error: "Failed to send message" });
        }
    });
    // ── GET /api/messages/search-users ──────────────────────────────────────────
    app.get("/api/messages/search-users", requireAuth, async (req, res) => {
        try {
            const q = (req.query.q as string)?.trim();
            if (!q || q.length < 2)
                return void res.json({ users: [] });
            const userId = getSessionUserId(req);
            if (!userId)
                return void res.status(401).json({ error: "Not authenticated" });
            {
                const users = (await pgMessageContacts(userId, q)).slice(0, 10).map((user) => ({
                    ...user, online: chatService.isOnline(String(user._id)),
                }));
                return void res.json({ users });
            }
        }
        catch {
            res.status(500).json({ error: "Search failed" });
        }
    });
    // ── GET /api/messages/online-status ─────────────────────────────────────────
    app.get("/api/messages/online-status", requireAuth, async (req, res) => {
        try {
            const rawIds = req.query.userIds;
            if (rawIds !== undefined && typeof rawIds !== 'string')
                return void res.status(400).json({ error: 'Invalid user IDs' });
            const userIds = [...new Set((rawIds || '').split(',').filter(Boolean))];
            if (userIds.length > 100 || userIds.some(id => !/^[a-f0-9]{24}$/i.test(id)))
                return void res.status(400).json({ error: 'Invalid user IDs' });
            const contacts = new Set((await pgMessageContacts(getSessionUserId(req)!)).map(contact => String(contact._id)));
            const status: Record<string, boolean> = {};
            for (const uid of userIds)
                if (contacts.has(uid)) status[uid] = chatService.isOnline(uid);
            res.json({ status });
        }
        catch (error) {
            logger.error("Failed to check online status:", error);
            res.status(500).json({ error: "Failed to check online status" });
        }
    });
    // Listening is presence, never a durable message or a playback command.
    const listeningLimiter=rateLimit({windowMs:60000,max:60,keyGenerator:messageRateLimitKey,standardHeaders:true,legacyHeaders:false});
    app.post('/api/messages/listening',requireAuth,listeningLimiter,async(req,res)=>{
      const userId=getSessionUserId(req);if(!userId)return void res.status(401).json({error:'Not authenticated'});
      const {messageId,clientId,revision,listening}=req.body||{};
      if(typeof messageId!=='string'||!/^[a-f0-9]{24}$/i.test(messageId)||typeof clientId!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(clientId)||!Number.isSafeInteger(revision)||revision<1||typeof listening!=='boolean')return void res.status(400).json({error:'Invalid listening state'});
      try{
       const message=await pgChatMessageById(messageId);
       if(!message||message.deletedAt||message.hiddenFor?.includes(userId)||message.messageType!=='station'||(message.fromUserId!==userId&&message.toUserId!==userId))return void res.status(404).json({error:'Shared radio unavailable'});
       const partnerId=message.fromUserId===userId?message.toUserId:message.fromUserId;
       if(chatListening.update(userId,partnerId,messageId,clientId,revision,listening,Date.now(),radioRequest(message.content)?.stationId)){
         const entries=chatListening.between(userId,partnerId);
         chatService.sendToUser(partnerId,{type:'chat:listening',userId,participants:[userId,partnerId],entries});
         chatService.sendToUser(userId,{type:'chat:listening',userId,participants:[userId,partnerId],entries});
       }
       res.json({success:true});
      }catch{res.status(500).json({error:'Listening state unavailable'});}
    });
    // ── WebSocket Handler at /ws/chat ────────────────────────────────────────────
    chatWss.on("connection", async (socket: WebSocket, request) => {
        try {
            const url = new URL(request.url || "", `http://${request.headers.host}`);
            const ticket = url.searchParams.get("ticket");
            if (!ticket) {
                socket.send(JSON.stringify({ type: "error", message: "Missing ticket" }));
                socket.close(4001, "No ticket provided");
                return;
            }
            const ticketData = wsTickets.get(ticket);
            if (!ticketData || ticketData.expiresAt < Date.now()) {
                deleteWsTicket(ticket);
                socket.send(JSON.stringify({ type: "error", message: "Invalid or expired ticket" }));
                socket.close(4002, "Invalid ticket");
                return;
            }
            const userId = ticketData.userId;
            deleteWsTicket(ticket);
            const onlineContacts = (await pgMessageContacts(userId)).filter(contact => chatService.isOnline(String(contact._id))).map(contact => String(contact._id));
            const client = chatService.addClient(userId, socket);
            let activeRevision = 0;
            broadcastOnlineStatus(userId, true);
            socket.send(JSON.stringify({
                type: "chat:connected",
                userId,
                onlineUsers: onlineContacts,
            }));
            socket.on("message", async (rawData) => {
                try {
                    const msg = JSON.parse(rawData.toString());
                    switch (msg.type) {
                        case "chat:typing": {
                            if (typeof msg.toUserId !== 'string' || !/^[0-9a-f]{24}$/i.test(msg.toUserId) || !await canSendConversation(userId, msg.toUserId))
                                break;
                            chatService.sendToUser(msg.toUserId, {
                                type: "chat:typing",
                                fromUserId: userId,
                            });
                            break;
                        }
                        case "chat:read": {
                            if (typeof msg.fromUserId !== "string" || !/^[0-9a-f]{24}$/i.test(msg.fromUserId))
                                break;
                            if (msg.messageIds !== undefined && (!Array.isArray(msg.messageIds) || msg.messageIds.length > 100 || msg.messageIds.some((id: unknown) => typeof id !== 'string' || !/^[0-9a-f]{24}$/i.test(id))))
                                break;
                            {
                                await pgMarkMessagesRead(userId, msg.fromUserId, msg.messageIds);
                                await markConversationNotificationsRead(userId, msg.fromUserId);
                            }
                            chatService.sendToUser(msg.fromUserId, {
                                type: "chat:read",
                                byUserId: userId,
                            });
                            break;
                        }
                        case "chat:active": {
                            // User opened/closed a conversation — track it to suppress duplicate notifications
                            const revision = ++activeRevision;
                            const withId = msg.withUserId || null;
                            if (withId !== null && (typeof withId !== 'string' || !/^[0-9a-f]{24}$/i.test(withId) || !await canReadConversation(userId, withId)))
                                break;
                            if (revision !== activeRevision || socket.readyState !== 1) break;
                            chatService.setActiveConversation(userId, withId, client);
                            // Immediately mark any pending notifications from that partner as read
                            if (withId) {
                                try {
                                    {
                                        await markConversationNotificationsRead(userId, withId);
                                    }
                                }
                                catch { }
                            }
                            break;
                        }
                        case "chat:ping": {
                            socket.send(JSON.stringify({ type: "chat:pong" }));
                            break;
                        }
                    }
                }
                catch (err) {
                    logger.error("CHAT WS message error:", err);
                }
            });
            socket.on("close", () => {
                chatService.setActiveConversation(userId, null, client);
                chatService.removeClient(userId, client);
                if (!chatService.isOnline(userId)) {
                    broadcastOnlineStatus(userId, false);
                }
            });
            socket.on("error", (err) => {
                logger.error(`CHAT WS error for user ${userId}:`, err);
                chatService.setActiveConversation(userId, null, client);
                chatService.removeClient(userId, client);
                if (!chatService.isOnline(userId)) {
                    broadcastOnlineStatus(userId, false);
                }
            });
        }
        catch (e: any) {
            // Never let a malformed chat WS upgrade crash the process
            console.error('⚠️ WS chat connection handler error (caught):', e?.message || e);
            try {
                socket.close(1011, 'internal error');
            }
            catch { }
        }
    });
    // ── Helper: broadcast online status to contacts ─────────────────────────────
    async function broadcastOnlineStatus(userId: string, online: boolean) {
        try {
            {
                // Fetch every page: the contacts search deliberately caps its result at
                // 100, which would silently omit presence updates for larger graphs.
                const contactIds = new Set<string>();
                await Promise.all((["following", "followers"] as const).map(async (direction) => {
                    let page = 1;
                    while (true) {
                        const result = await pgFollowPage(userId, direction, page, 500);
                        for (const entry of result[direction])
                            contactIds.add(String(entry.user._id));
                        if (page >= result.pagination.pages || !result[direction].length)
                            break;
                        page++;
                    }
                }));
                contactIds.delete(userId);
                chatService.broadcastToUsers([...contactIds], { type: "chat:online_status", userId, online });
                return;
            }
        }
        catch { }
    }
}
