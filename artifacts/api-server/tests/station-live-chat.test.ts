import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  roomId,
  roomText,
  roomContent,
  ticketHash,
} from "../src/services/station-live-chat";
import { createNativePostgresFixture } from "./helpers/native-postgres-fixture";
test("room input preserves Unicode/emoji, rejects links, control-only, oversized and baseline abuse", () => {
  assert.equal(roomText("  İstanbul’dan selam 👋  "), "İstanbul’dan selam 👋");
  assert.equal(roomText("日本のラジオ 🎶"), "日本のラジオ 🎶");
  assert.equal(roomText("Aile 👨‍👩‍👧‍👦"), "Aile 👨‍👩‍👧‍👦");
  assert.equal(roomText("می‌توانم"), "می‌توانم");
  for (const input of [
    "",
    "\u200B",
    "a".repeat(401),
    "http://spam.test",
    "www.spam.test",
    "siktir",
    "FUCK",
  ])
    assert.throws(() => roomText(input));
  assert.equal(roomText("Scunthorpe’dan selam"), "Scunthorpe’dan selam");
  assert.equal(roomId("a".repeat(24)), true);
  assert.equal(roomId("../users"), false);
  assert.equal(ticketHash("token").length, 64);
  assert.deepEqual(
    roomContent({ content: "klipy:hello-world", messageType: "gif" }),
    { content: "klipy:hello-world", messageType: "gif" },
  );
  for (const body of [
    { content: "https://other.test/x.gif", messageType: "gif" },
    { content: "not-provider-reference", messageType: "gif" },
    { content: "hello", messageType: "photo" },
  ])
    assert.throws(() => roomContent(body));
});
describe(
  "live room native PostgreSQL contracts",
  { skip: !process.env.PG_TEST_DATABASE_URL },
  () => {
    let f: Awaited<ReturnType<typeof createNativePostgresFixture>>,
      runtime: typeof import("../src/services/station-live-chat");
    const station = "aa".repeat(12),
      other = "bb".repeat(12),
      alice = "11".repeat(12),
      bob = "22".repeat(12),
      token = ticketHash("session");
    before(async () => {
      f = await createNativePostgresFixture("station_live_chat");
      runtime = await import("../src/services/station-live-chat");
      await f.pool.query(
        `INSERT INTO stations(id,station_uuid,name,slug,url,country,country_code) VALUES($1,$1,'Test Radio','test-room','https://radio.test/live','Austria','AT'),($2,$2,'Other Radio','other-room','https://other.test/live','Germany','DE')`,
        [station, other],
      );
      await f.pool.query(
        `INSERT INTO users(id,username,email,full_name) VALUES($1,'alice','alice@room.test','Alice'),($2,'bob','bob@room.test','Bob')`,
        [alice, bob],
      );
      await f.pool.query(
        "INSERT INTO station_chat_sessions(token_hash,station_id,user_id,identity_id,connected,expires_at) VALUES($1,$2,$3,$3,true,now()+interval '5 minutes')",
        [token, station, alice],
      );
    });
    after(async () => f?.close());
    test("messages are durable, retry-idempotent, rate-limited, room-scoped and blocked per viewer", async () => {
      const id = randomUUID(),
        message = await runtime.sendRoomMessage(station, alice, {
          content: "Merhaba 👋",
          clientId: id,
        });
      assert.equal(message.sender.fullName, "Alice");
      assert.equal(
        (
          await runtime.sendRoomMessage(station, alice, {
            content: "Merhaba 👋",
            clientId: id,
          })
        )._id,
        message._id,
      );
      await assert.rejects(() =>
        runtime.sendRoomMessage(other, alice, {
          content: "Merhaba 👋",
          clientId: id,
        }),
      );
      await assert.rejects(
        () =>
          runtime.sendRoomMessage(station, alice, {
            content: "Fast second message",
            clientId: randomUUID(),
          }),
        (e: any) => e.status === 429,
      );
      assert.equal((await runtime.roomPage(other, bob)).messages.length, 0);
      assert.equal((await runtime.roomPage(station, bob)).messages.length, 1);
      await f.pool.query(
        "INSERT INTO station_chat_blocks(user_id,blocked_user_id) VALUES($1,$2)",
        [bob, alice],
      );
      assert.equal((await runtime.roomPage(station, bob)).messages.length, 0);
      assert.equal((await runtime.roomPage(station, alice)).messages.length, 1);
      await assert.rejects(
        () =>
          runtime.sendRoomMessage(station, bob, {
            content: "No lease",
            clientId: randomUUID(),
          }),
        (e: any) => e.status === 403,
      );
      await f.pool.query(
        "INSERT INTO station_chat_sanctions(user_id,expires_at,reason) VALUES($1,now()+interval '1 hour','test')",
        [alice],
      );
      await assert.rejects(
        () =>
          runtime.sendRoomMessage(station, alice, {
            content: "Cannot write",
            clientId: randomUUID(),
          }),
        (e: any) => e.status === 403,
      );
    });
    test("GIF reference persists with its type, retries once, and arbitrary media is rejected by DB", async () => {
      await f.pool.query(
        "DELETE FROM station_chat_sanctions WHERE user_id=$1",
        [alice],
      );
      await f.pool.query(
        "UPDATE station_chat_messages SET created_at=now()-interval '10 seconds' WHERE user_id=$1",
        [alice],
      );
      const clientId = randomUUID(),
        body = { content: "klipy:hello-wave", messageType: "gif", clientId };
      const gif = await runtime.sendRoomMessage(station, alice, body);
      assert.equal(gif.messageType, "gif");
      assert.equal(
        (await runtime.sendRoomMessage(station, alice, body))._id,
        gif._id,
      );
      assert.equal(
        (await runtime.roomPage(station, alice)).messages.find(
          (x) => x._id === gif._id,
        )?.messageType,
        "gif",
      );
      await assert.rejects(() =>
        runtime.sendRoomMessage(station, alice, {
          ...body,
          messageType: "text",
        }),
      );
      await assert.rejects(() =>
        f.pool.query(
          "INSERT INTO station_chat_messages(id,station_id,user_id,client_id,content,message_type) VALUES($1,$2,$3,$4,'https://evil.test/file.gif','gif')",
          ["dd".repeat(12), station, alice, randomUUID()],
        ),
      );
      await f.pool.query(
        "UPDATE station_chat_messages SET deleted_at=now(),content='Silinen mesaj' WHERE id=$1",
        [gif._id],
      );
      assert.equal(
        (await runtime.roomPage(station, alice)).messages.some(
          (x) => x._id === gif._id,
        ),
        false,
      );
    });
    test("page cursor respects station and 24-hour window; empty rooms are valid", async () => {
      await f.pool.query(
        "INSERT INTO station_chat_messages(id,station_id,user_id,client_id,content,created_at) VALUES($1,$2,$3,$4,'old',now()-interval '25 hours')",
        ["cc".repeat(12), station, alice, randomUUID()],
      );
      assert.equal(
        (await runtime.roomPage(station, alice)).messages.some(
          (x) => x.content === "old",
        ),
        false,
      );
      assert.deepEqual(await runtime.roomPage(other, ""), {
        messages: [],
        hasMore: false,
      });
    });
  },
);
