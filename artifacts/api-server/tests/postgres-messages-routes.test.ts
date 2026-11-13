import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ipKeyGenerator } from "express-rate-limit";

const userId = "507f1f77bcf86cd799439011";
const partnerId = "507f1f77bcf86cd799439012";
const nextPageContactId = "507f1f77bcf86cd799439013";
const privateUser = {
  _id: partnerId, isPublicProfile: true, username: "listener", fullName: "Radio Listener",
  avatar: "/avatar.png", profileImageUrl: "/profile.png",
  email: "private@example.test", passwordHash: "secret-password-hash",
  resetPasswordToken: "secret-reset-token", resetPasswordExpires: new Date(),
  googleId: "private-social-id", role: "admin",
  pushSubscription: { endpoint: "private-push-endpoint" },
  subscription: { purchaseToken: "private-purchase-token" },
  source: { nestedSecret: "must-not-leave-server" },
};
const publicFields = ["_id", "avatar", "fullName", "profileImageUrl", "username"];
const deletionCalls:any[]=[];
const readCalls: unknown[][] = [];
const notificationReadCalls: unknown[][] = [];
const followPageCalls: unknown[][] = [];
const sent: Array<{ userId: string; payload: any }> = [];
const broadcasts: Array<{ userIds: string[]; payload: any }> = [];
const socketHandlers: Record<string, (...args: any[]) => any> = {};
let connectionHandler: (...args: any[]) => any;
let requestedLimit: number;
let follows = true;
let hasHistory = false;
let deletionCreatedAt=()=>new Date(Date.now()-60000).toISOString();

mock.module(new URL('../src/data/station-read-store.ts',import.meta.url).href,{namedExports:{getPublicStationByIdentifier:async(id:string)=>id.endsWith('999')?null:{_id:id,name:'Canonical Radio',country:'Austria',favicon:'https://example.test/logo.png'}}});
mock.module("express-rate-limit", {
  namedExports: { ipKeyGenerator, rateLimit: () => (_req: any, _res: any, next: () => void) => next() },
});
mock.module("fs/promises", { defaultExport: { mkdir: async () => {} } });
mock.module(new URL("../src/utils/logger.ts", import.meta.url).href, {
  namedExports: { logger: { log() {}, warn() {}, error() {} } },
});
mock.module(new URL('../src/cache.ts', import.meta.url).href, {
  defaultExport: { get: async () => null, set: async () => {}, clearByPattern: async () => {} },
  namedExports: { CacheManager: { clearByPattern: async () => {} } },
});
mock.module(new URL("../src/data/postgres-user-store.ts", import.meta.url).href, {
  namedExports: { newPublicUserId:()=>"507f1f77bcf86cd799439020",userStore: "postgres", pgFindUserById: async (id: string) => ({ ...privateUser, _id: id }) },
});
mock.module(new URL("../src/services/user-engagement-service.ts", import.meta.url).href, {
  namedExports: { engagementStore: "postgres" },
});
mock.module(new URL("../src/data/postgres-engagement-store.ts", import.meta.url).href, {
  namedExports: {
    pgIsFollowing: async () => follows,
    pgFollowPage: async (...args: any[]) => {
      followPageCalls.push(args);
      const [, direction, page] = args;
      return { [direction]: [{ user: { _id: page === 1 ? partnerId : nextPageContactId } }],
        pagination: { page, pages: 2 } };
    },
  },
});
mock.module(new URL("../src/data/postgres-message-store.ts", import.meta.url).href, {
  namedExports: {
    messageStore: "postgres",
    pgPinnedChatMessages:async()=>[],
    pgPinChatMessage:async(viewer:string,id:string,pinned:boolean)=>id.endsWith('999')?null:{_id:id,fromUserId:userId,toUserId:partnerId,content:'Pinned',pinnedAt:pinned?new Date().toISOString():null},
    pgConversationMessages: async (_user: string, _partner: string, _before: any, limit: number) => {
      requestedLimit = limit;
      return [{ _id: '507f1f77bcf86cd799439010', content: 'Older' }, { _id: "507f1f77bcf86cd799439014", content: "Hello" }];
    },
    pgConversations: async () => [],
    pgCreateMessage: async (input: any) => ({ ...input, _id: "507f1f77bcf86cd799439014", createdAt: new Date() }),
    pgMarkMessagesRead: async (...args: unknown[]) => { readCalls.push(args); return 1; },
    pgMessageContacts: async () => [],
    pgUnreadMessageCount: async () => 0,
    pgHasConversation: async () => hasHistory,
    pgDeleteChatMessage: async(...args:any[])=>{deletionCalls.push(args);return {deletedAt:args[2]==='everyone'?'2026-11-09T12:00:00Z':null};},
    pgChatMessageById: async(id:string) => id.endsWith('998')?{_id:id,fromUserId:partnerId,toUserId:userId,messageType:'text'}: id.endsWith('999')?{_id:id,fromUserId:'other',toUserId:'unrelated',messageType:'station'}:{_id:id,fromUserId:userId,toUserId:partnerId,messageType:'station',createdAt:deletionCreatedAt()},
  },
});
mock.module(new URL("../src/data/postgres-notification-store.ts", import.meta.url).href, {
  namedExports: {
    notificationStore: "postgres",
    pgMarkConversationNotificationsRead: async (...args: unknown[]) => { notificationReadCalls.push(args); return 1; },
    pgUpsertMessageNotification: async () => ({}),
  },
});
mock.module(new URL("../src/services/chat-service.ts", import.meta.url).href, {
  namedExports: { chatService: {
    isOnline: () => true,
    sendToUser: (id: string, payload: any) => { sent.push({ userId: id, payload }); },
    getActiveConversation: () => userId,
    isViewingConversation: () => true,
    addClient: () => ({}),
    removeClient() {},
    setActiveConversation() {},
    getOnlineUsers: () => [userId],
    broadcastToUsers: (ids: string[], payload: any) => { broadcasts.push({ userIds: ids, payload }); },
  } },
});

let server: Server;
let baseUrl: string;
let rateKey: (request: any) => string;
before(async () => {
  const { registerMessagesRoutes, messageRateLimitKey } = await import("../src/routes/messages-routes.ts");
  rateKey = messageRateLimitKey;
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.session = { user: { userId } }; next(); });
  registerMessagesRoutes(app, {
    on(event: string, handler: (...args: any[]) => any) { if (event === "connection") connectionHandler = handler; },
  } as any, { requireAuth: (_req: any, _res: any, next: () => void) => next() });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test('message limits use user identity or a normalized IPv6 subnet rather than a rotatable host address', () => {
  assert.equal(rateKey({session:{user:{userId}},ip:'2001:db8::1'}),userId);
  assert.equal(rateKey({ip:'2001:db8:abcd:1200::1'}),rateKey({ip:'2001:db8:abcd:12ff::2'}));
  assert.notEqual(rateKey({ip:'2001:db8:abcd:1200::1'}),rateKey({ip:'2001:db8:abcd:1300::1'}));
  assert.equal(rateKey({ip:'::ffff:192.0.2.1'}),rateKey({ip:'192.0.2.1'}));
});
after(async () => {
  // Run the registered socket lifecycle even though the transport is a stub.
  // All HTTP bodies are consumed below; close any remaining keep-alive sockets
  // before restoring module mocks. The runner can then terminate naturally.
  socketHandlers.close?.();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
  await new Promise<void>(resolve => setImmediate(resolve));
  mock.restoreAll();
});

test("conversation responses expose only public partner fields and preserve pagination contract", async () => {
  const response = await fetch(`${baseUrl}/api/messages/conversation/${partnerId}?limit=-3`);
  assert.equal(response.status, 200);
  const body: any = await response.json();
  assert.equal(requestedLimit, 2, 'one lookahead record determines hasMore without a phantom final page');
  assert.equal(body.hasMore, true);
  assert.equal(body.partner.online, true);
  assert.deepEqual(Object.keys(body.partner).sort(), [...publicFields, "online"].sort());
  assert.equal(body.partner._id, partnerId);
  assert.deepEqual(notificationReadCalls.at(-1), [userId, partnerId]);
  assert.deepEqual(readCalls.at(-1), [userId, partnerId, ['507f1f77bcf86cd799439014']]);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test("message WebSocket sender payload never exposes credentials or source fields", async () => {
  sent.length = 0;
  const response = await fetch(`${baseUrl}/api/messages/send`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toUserId: partnerId, content: "Hello", messageType: "text" }),
  });
  assert.equal(response.status, 200);
  const body: any = await response.json();
  assert.equal(body.success, true);
  const delivered = sent.filter(item => item.payload.type === "chat:message");
  assert.equal(delivered.length, 2, "recipient delivery and sender echo");
  for (const { payload } of delivered) {
    assert.deepEqual(Object.keys(payload.sender).sort(), publicFields);
    assert.equal(payload.sender._id, userId);
    assert.equal(payload.message.content, "Hello");
  }
});

test("PostgreSQL WebSocket read receipts persist without calling MongoDB", async () => {
  const ticketResponse = await fetch(`${baseUrl}/api/messages/ws-ticket`);
  const { ticket } = await ticketResponse.json() as any;
  await connectionHandler({
    send() {}, close() {},
    on(event: string, callback: (...args: any[]) => any) { socketHandlers[event] = callback; },
  }, { url: `/ws/chat?ticket=${ticket}`, headers: { host: "localhost" } });
  readCalls.length = 0;
  await socketHandlers.message(Buffer.from(JSON.stringify({ type: "chat:read", fromUserId: partnerId })));
  assert.deepEqual(readCalls, [[userId, partnerId, undefined]]);
  await socketHandlers.message(Buffer.from(JSON.stringify({ type: "chat:read", fromUserId: { bad: "id" } })));
  assert.equal(readCalls.length, 1, "invalid IDs must not reach persistence");
});

test('conversation access does not disclose unrelated private users; past participants retain their history', async () => {
  follows = false; hasHistory = false;
  try {
    let response = await fetch(`${baseUrl}/api/messages/conversation/${partnerId}`);
    assert.equal(response.status, 403); await response.json();
    hasHistory = true;
    response = await fetch(`${baseUrl}/api/messages/conversation/${partnerId}`);
    assert.equal(response.status, 200); assert.equal((await response.json() as any).hasMore, false);
  } finally { follows = true; hasHistory = false; }
});

test('invalid cursors and remote image URLs are rejected before persistence', async () => {
  for (const query of ['before=invalid', 'before=bad&before=also-bad']) {
    const response = await fetch(`${baseUrl}/api/messages/conversation/${partnerId}?${query}`);
    assert.equal(response.status, 400); await response.json();
  }
  const response = await fetch(`${baseUrl}/api/messages/send`, { method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({toUserId:partnerId, content:'Photo',messageType:'image',imageUrl:'https://tracker.example/pixel.png'}) });
  assert.equal(response.status, 400); await response.json();
});

test('presence lookup never enumerates non-contact users', async () => {
  const response = await fetch(`${baseUrl}/api/messages/online-status?userIds=${partnerId}`);
  assert.equal(response.status, 200); assert.deepEqual((await response.json() as any).status, {});
});

test('GIF messages persist only provider references and emit the GIF type to both participants', async () => {
  sent.length = 0;
  const response = await fetch(`${baseUrl}/api/messages/send`, {method:'POST',headers:{'Content-Type':'application/json'},
    body: JSON.stringify({toUserId:partnerId,content:'GIF',messageType:'gif',imageUrl:'klipy:radio-123'})});
  assert.equal(response.status, 200); await response.json();
  for (const {payload} of sent.filter(item => item.payload.type === 'chat:message')) {
    assert.equal(payload.message.messageType, 'gif'); assert.equal(payload.message.imageUrl,'klipy:radio-123');
  }
  for (const imageUrl of ['https://tracker.example/image.gif','data:image/gif;base64,AA','klipy:../private','klipy:x?y=1','klipy:'+'x'.repeat(201)]) {
    const rejected = await fetch(`${baseUrl}/api/messages/send`, {method:'POST',headers:{'Content-Type':'application/json'},
      body: JSON.stringify({toUserId:partnerId,content:'GIF',messageType:'gif',imageUrl})});
    assert.equal(rejected.status,400); await rejected.json();
  }
  assert.equal(sent.filter(item => item.payload.type === 'chat:message').length,2);
  follows = false;
  try {
    const forbidden = await fetch(`${baseUrl}/api/messages/send`, {method:'POST',headers:{'Content-Type':'application/json'},
      body: JSON.stringify({toUserId:partnerId,content:'GIF',messageType:'gif',imageUrl:'klipy:radio-123'})});
    assert.equal(forbidden.status,403); await forbidden.json();
  } finally { follows = true; }
});

test("PostgreSQL presence broadcasts include subsequent contact pages", async () => {
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(followPageCalls.filter(args => args[2] === 2).length, 2);
  assert.deepEqual(broadcasts.at(-1)?.userIds.sort(), [partnerId, nextPageContactId].sort());
  assert.equal(broadcasts.at(-1)?.payload.online, true);
});

test("new conversations require an open recipient profile", async () => {
  privateUser.isPublicProfile = false;
  try { const response = await fetch(`${baseUrl}/api/messages/send`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({toUserId:partnerId,content:'Hello'})}); assert.equal(response.status,403); }
  finally { privateUser.isPublicProfile = true; }
});
test("existing recipients can reply without following back", async () => {
  follows = false; hasHistory = true;
  try { const response = await fetch(`${baseUrl}/api/messages/send`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({toUserId:partnerId,content:'A reply'})}); assert.equal(response.status,200); }
  finally { follows = true; hasHistory = false; }
});

test('voice messages preserve media type and accept only app upload paths',async()=>{
 const send=(imageUrl:string)=>fetch(`${baseUrl}/api/messages/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({toUserId:partnerId,content:'Voice message',messageType:'audio',imageUrl})});
 const accepted=await send('/uploads/chat/voice-abc123.m4a');assert.equal(accepted.status,200);assert.equal((await accepted.json()).message.messageType,'audio');
 for(const value of ['https://evil.test/a.mp3','/uploads/chat/voice-a.svg','/uploads/chat/../voice-a.webm']){const rejected=await send(value);assert.equal(rejected.status,400);}
});

test('station messages use canonical catalog metadata and reject missing radios',async()=>{
 const send=(content:any)=>fetch(`${baseUrl}/api/messages/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({toUserId:partnerId,content:JSON.stringify(content),messageType:'station'})});
 const result=await send({version:1,stationId:userId,name:'Fake name',url:'https://evil.test',intent:'gift'});assert.equal(result.status,200);const radio=JSON.parse((await result.json()).message.content);assert.equal(radio.name,'Canonical Radio');assert.equal('url' in radio,false);
 assert.equal((await send({version:1,stationId:'invalid',intent:'gift'})).status,400);
 assert.equal((await send({version:1,stationId:'507f1f77bcf86cd799439999',intent:'gift'})).status,404);
});
test('listening updates require participation and stale requests cannot revive paused playback',async()=>{
 const request=(messageId:string,revision:number,listening:boolean)=>fetch(`${baseUrl}/api/messages/listening`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId,clientId:'fixture-device',revision,listening})});
 assert.equal((await request('507f1f77bcf86cd799439999',1,true)).status,404);
 assert.equal((await request('not-an-id',1,true)).status,400);
 assert.equal((await request(userId,1,true)).status,200);
 assert.equal((await request(userId,3,false)).status,200);
 assert.equal((await request(userId,2,true)).status,200);
 const page=await (await fetch(`${baseUrl}/api/messages/conversation/${partnerId}`)).json();assert.equal(page.listening.length,0);
});

test('message deletion is participant scoped, sender-only for everyone and broadcasts only to the intended viewers',async()=>{
 const id='507f1f77bcf86cd799439014',incoming='507f1f77bcf86cd799439998',outside='507f1f77bcf86cd799439999';
 const post=(messageId:string,scope:string)=>fetch(baseUrl+'/api/messages/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messageId,scope})});
 const before=deletionCalls.length;
 assert.equal((await post(outside,'self')).status,404);assert.equal((await post(incoming,'everyone')).status,403);
 assert.equal((await post(id,'invalid')).status,400);assert.equal((await post('invalid','self')).status,400);assert.equal(deletionCalls.length,before);
 assert.equal((await post(id,'self')).status,200);assert.deepEqual(broadcasts.at(-1)?.userIds,[userId]);
 assert.equal((await post(id,'everyone')).status,200);assert.deepEqual(broadcasts.at(-1)?.userIds,[userId,partnerId]);assert.equal(broadcasts.at(-1)?.payload.messageId,id);assert.equal(broadcasts.at(-1)?.payload.type,'chat:deleted');
 assert.equal((await post(incoming,'self')).status,200);assert.deepEqual(broadcasts.at(-1)?.userIds,[userId]);
});

test('recall rejects messages older than 48 hours without mutation or broadcast; self delete remains available',async()=>{
 const id='507f1f77bcf86cd799439014',post=(scope:string)=>fetch(baseUrl+'/api/messages/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messageId:id,scope})});
 deletionCreatedAt=()=>new Date(Date.now()-48*60*60*1000-1).toISOString();
 try {const calls=deletionCalls.length,events=broadcasts.length,response=await post('everyone');assert.equal(response.status,409);assert.equal((await response.json()).code,'DELETE_WINDOW_EXPIRED');assert.equal(deletionCalls.length,calls);assert.equal(broadcasts.length,events);assert.equal((await post('self')).status,200);}finally{deletionCreatedAt=()=>new Date(Date.now()-60000).toISOString();}
});
test('pin and reply endpoints reject invalid IDs and references outside the conversation',async()=>{
 follows=true;hasHistory=true;
 const post=(path:string,body:any)=>fetch(baseUrl+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('/api/messages/pin',{messageId:'invalid',pinned:true})).status,400);
 assert.equal((await post('/api/messages/pin',{messageId:'507f1f77bcf86cd799439999',pinned:true})).status,404);
 assert.equal((await post('/api/messages/pin',{messageId:'507f1f77bcf86cd799439014',pinned:true})).status,200);
 assert.equal(broadcasts.at(-1)?.payload.type,'chat:pinned');
 assert.deepEqual(broadcasts.at(-1)?.userIds,[userId,partnerId]);
 assert.equal((await post('/api/messages/send',{toUserId:partnerId,content:'Reply',messageType:'text',replyToId:'bad'})).status,400);
 assert.equal((await post('/api/messages/send',{toUserId:partnerId,content:'Reply',messageType:'text',replyToId:'507f1f77bcf86cd799439999'})).status,404);
 const reply=await post('/api/messages/send',{toUserId:partnerId,content:'Reply',messageType:'text',replyToId:'507f1f77bcf86cd799439998'});
 assert.equal(reply.status,200);const data=await reply.json();assert.equal(data.message.replyToId,'507f1f77bcf86cd799439998');assert.equal(data.message.replyTo.fromUserId,partnerId);
});
