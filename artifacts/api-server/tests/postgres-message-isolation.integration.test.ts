import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import {readFile} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const connectionString = process.env.PG_TEST_DATABASE_URL;
const schema = `message_isolation_${randomBytes(8).toString('hex')}`;
let admin: pg.Pool;
let pool: pg.Pool;
let store: typeof import('../src/data/postgres-message-store');
let notifications: typeof import('../src/data/postgres-notification-store');
const id = (n: number) => n.toString(16).padStart(24, '0');
beforeEach(async () => { if (pool) await pool.query('UPDATE direct_messages SET is_read=false,read_at=NULL'); });
before(async () => {
  if (!connectionString) return;
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.pathname, '/radiohub_test');
  admin = new pg.Pool({ connectionString, ssl: false, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new pg.Pool({ connectionString, ssl: false, max: 2, options: `-c search_path=${schema}` });
  await pool.query(`CREATE TABLE direct_messages (
    id text PRIMARY KEY,from_user_id text NOT NULL,to_user_id text NOT NULL, content text,
    message_type text DEFAULT 'text',image_url text,is_read boolean DEFAULT false,read_at timestamptz,
    created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`);
  for(const name of ['0044_chat_message_deletion.sql','0045_chat_reply_pin.sql'])await pool.query(await readFile(new URL('../../../lib/db/migrations/'+name,import.meta.url),'utf8'));
  await pool.query(`CREATE TABLE chat_inbox_state(user_id text,kind text,target_id text,marked_unread boolean DEFAULT false,archived boolean DEFAULT false,deleted boolean DEFAULT false,updated_at timestamptz DEFAULT now())`);
  await pool.query(`INSERT INTO direct_messages(id,from_user_id,to_user_id,content,created_at)
    VALUES ($1,'a','b','a to b','2026-01-01'),($2,'b','a','b to a','2026-01-02'),
    ($3,'c','d','unrelated secret','2026-01-03'),($4,'b','a','same timestamp','2026-01-02')`, [id(1),id(2),id(3),id(4)]);
  mock.module(new URL('../src/postgres-runtime.ts', import.meta.url).href, { namedExports: { getPostgresPool: () => pool } });
  mock.module(new URL('../src/data/postgres-user-store.ts', import.meta.url).href, { namedExports: { newPublicUserId: () => id(99) } });
  await pool.query('CREATE TABLE direct_chat_blocks(user_id text,blocked_user_id text,PRIMARY KEY(user_id,blocked_user_id))');
  store = await import('../src/data/postgres-message-store');
  notifications = await import('../src/data/postgres-notification-store');
  await pool.query(`CREATE TABLE user_notifications(id text PRIMARY KEY,user_id text,from_user_id text,type text,title text,message text,
    data jsonb DEFAULT '{}',is_read boolean DEFAULT false,read_at timestamptz,expires_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`);
});

test('notification receipts preserve unread arrivals and enforce recipient ownership', { skip: !connectionString }, async () => {
  await notifications.pgCreateNotification({id:id(50),userId:'a',fromUserId:'b',type:'new_message',title:'Message',message:'Preview'});
  await notifications.pgCreateNotification({id:id(51),userId:'c',fromUserId:'d',type:'new_message',title:'Other',message:'Private'});
  assert.equal(await notifications.pgMarkNotificationRead('a',id(51)), null);
  // At this point the latest incoming message has not been displayed/read.
  assert.equal(await notifications.pgMarkConversationNotificationsRead('a','b'), 0);
  await store.pgMarkMessagesRead('a','b');
  assert.equal(await notifications.pgMarkConversationNotificationsRead('a','b'), 1);
  const page = await notifications.pgListNotifications('a',-3,-10);
  assert.equal(page.pagination.page,1); assert.equal(page.pagination.limit,1);
  assert.equal(page.notifications.length,1); assert.equal(page.notifications[0].read,true);
  assert.equal(page.unreadCount,0);
  assert.equal((await notifications.pgListNotifications('c',1,1000)).notifications[0].read,false);
});
after(async () => {
  await pool?.end();
  if (admin) {
    assert.match(schema, /^message_isolation_[a-f0-9]{16}$/);
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
  mock.restoreAll();
});

test('conversation cursors cannot resolve another conversation and ties paginate without losing messages', { skip: !connectionString }, async () => {
  assert.deepEqual(await store.pgConversationMessages('a','b',id(3),100), []);
  const first = await store.pgConversationMessages('a','b',undefined,1);
  assert.deepEqual(first.map(m => m._id), [id(4)]);
  assert.deepEqual((await store.pgConversationMessages('a','b',id(4),1)).map(m => m._id), [id(2)]);
  assert.deepEqual((await store.pgConversationMessages('a','b',id(2),100)).map(m => m._id), [id(1)]);
  assert.equal(await store.pgHasConversation('a','b'), true);
  assert.equal(await store.pgHasConversation('a','c'), false);
});

test('read receipts affect only displayed incoming IDs; unseen concurrent and other-conversation messages stay unread', { skip: !connectionString }, async () => {
  const displayed = await store.pgConversationMessages('a','b',undefined,10);
  await store.pgCreateMessage({ id:id(5),fromUserId:'b',toUserId:'a',content:'Arrived after snapshot',messageType:'text' });
  assert.equal(await store.pgMarkMessagesRead('a','b',[...displayed.map(m => m._id),id(3)]), 2);
  const rows = (await pool.query('SELECT id,is_read FROM direct_messages ORDER BY id')).rows;
  assert.deepEqual(rows.map(r => [r.id,r.is_read]), [[id(1),false],[id(2),true],[id(3),false],[id(4),true],[id(5),false]]);
  assert.equal(await store.pgMarkMessagesRead('a','b',[]), 0);
  assert.equal(await store.pgUnreadMessageCount('a'), 1);
});

test('category filtering precedes pagination; known types appear while expired and unknown records remain excluded', { skip: !connectionString }, async () => {
  const types=['follow','unfollow','new_message','new_station','favorite_station','favorite_update','system','promotional','comment_reply'];
  const now=new Date();
  for (const [i,type] of types.entries()) await notifications.pgCreateNotification({id:id(60+i),userId:'categories',type,title:type,message:type,createdAt:now});
  for (const [i,type,days] of [[70,'new_message',8],[71,'follow',11],[72,'system',31],[73,'unknown',0]] as const)
    await notifications.pgCreateNotification({id:id(i),userId:'categories',type,title:'Excluded',message:'Excluded',createdAt:new Date(Date.now()-days*86400000)});
  await notifications.pgCreateNotification({id:id(74),userId:'categories',type:'system',title:'Expired',message:'Expired',expiresAt:new Date(Date.now()-1000)});
  const all=await notifications.pgListNotifications('categories',1,1);
  assert.equal(all.notifications[0].type,'comment_reply'); assert.equal(all.pagination.total,9);
  assert.deepEqual(all.categoryCounts,{all:9,social:3,stations:3,system:3});
  assert.equal(all.unreadCount,9);
  const stations=await notifications.pgListNotifications('categories',1,1,'stations');
  assert.equal(stations.notifications[0].type,'favorite_update'); assert.equal(stations.pagination.total,3); assert.equal(stations.pagination.totalPages,3);
  assert.equal((await notifications.pgListNotifications('categories',2,1,'stations')).notifications[0].type,'favorite_station');
  await assert.rejects(notifications.pgListNotifications('categories',1,20,'unknown' as any),/Invalid notification category/);
});
