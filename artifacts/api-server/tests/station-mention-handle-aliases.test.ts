import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';

let old = 'user_1755000000000_abc123456';
const queries: Array<{ sql: string; params: any[] }> = [];
const deliveries: any[] = [];
const db = { query: async (sql: string, params: any[] = []) => {
  queries.push({ sql, params });
  if (sql.startsWith('SELECT name FROM stations')) return { rows: [{ name: 'Fixture Radio' }] };
  if (sql.startsWith('SELECT 1 FROM station_chat_sessions')) return { rows: [{}], rowCount: 1 };
  if (sql.includes("source->'profileAliases'")) return { rows: [{ id: 'recipient', _id: 'recipient', username: 'sahin_yogurtcu', fullName: 'Şahin Yoğurtcu', canOpenProfile: false, usernameAliases: [old, 'forged_custom_alias', 5] }] };
  return { rows: [] };
} };
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => db } });
mock.module('../src/data/postgres-notification-store', { namedExports: { pgCreateNotification: async (value: any) => { deliveries.push(value); } } });
mock.module('../src/cache', { defaultExport: { clearByPattern: async () => {} } });
mock.module('../src/services/pushNotificationService', { namedExports: { PushNotificationService: { sendToUserAllChannels: async () => { throw new Error('Visible room must not receive push'); } } } });
mock.module('../src/services/chat-service', { namedExports: { chatService: { sendToUser() {} } } });
const { hydrateRoomMentions, notifyRoomMentions } = await import('../src/services/station-chat-mentions');
beforeEach(() => { old = 'user_1755000000000_abc123456'; queries.length = 0; deliveries.length = 0; });
after(() => mock.restoreAll());

test('old stored mentions hydrate the same current identity with filtered aliases and unchanged profile privacy', async () => {
  const [message] = await hydrateRoomMentions([{ stationId: 'room', content: `Hi @${old}` }]);
  assert.equal(message.mentions[0]._id, 'recipient');
  assert.equal(message.mentions[0].username, 'sahin_yogurtcu');
  assert.equal(message.mentions[0].fullName, 'Şahin Yoğurtcu');
  assert.deepEqual(message.mentions[0].usernameAliases, [old]);
  assert.equal(message.mentions[0].canOpenProfile, false);
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /EXISTS.*station_chat_messages/);
  assert.deepEqual(queries[1].params, [[old], ['room']]);
});

test('ordinary or ambiguous usernames never trigger a legacy JSON alias scan', async () => {
  await hydrateRoomMentions([{ stationId: 'room', content: 'Hi @chosen_name @user_123' }]);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].sql.includes("source->'profileAliases'"), false);
});

test('new messages using the old handle retain recipient membership, block and visibility guards', async () => {
  await notifyRoomMentions({ _id: 'message', userId: 'sender', stationId: 'room', content: `@${old}`, sender: { fullName: 'Sender' } });
  assert.equal(deliveries.length, 1); assert.equal(deliveries[0].userId, 'recipient');
  const aliases = queries.find(query => query.sql.startsWith('SELECT u.id') && query.sql.includes("source->'profileAliases'"))!;
  assert.match(aliases.sql, /station_chat_blocks/); assert.match(aliases.sql, /direct_chat_blocks/);
  assert.match(aliases.sql, /m\.station_id=\$3/); assert.match(aliases.sql, /interval '24 hours'/);
  assert.deepEqual(aliases.params, [[old], 'sender', 'room']);
});

test('native email-derived aliases preserve canonical mention identity and the same recipient guards', async () => {
  old = 'yogurtcusahin5me_mv748druv2w7';
  const [message] = await hydrateRoomMentions([{ stationId: 'room', content: `Hi @${old}` }]);
  assert.equal(message.mentions[0].username, 'sahin_yogurtcu');
  assert.deepEqual(message.mentions[0].usernameAliases, [old]);
  assert.equal(message.mentions[0].canOpenProfile, false);
  await notifyRoomMentions({ _id: 'native-message', userId: 'sender', stationId: 'room', content: `@${old}`, sender: { fullName: 'Sender' } });
  assert.equal(deliveries.length, 1); assert.equal(deliveries[0].userId, 'recipient');
  const aliases = queries.find(query => query.sql.startsWith('SELECT u.id') && query.sql.includes("source->'profileAliases'"))!;
  assert.match(aliases.sql, /station_chat_blocks/); assert.match(aliases.sql, /direct_chat_blocks/);
  assert.match(aliases.sql, /interval '24 hours'/);
});
