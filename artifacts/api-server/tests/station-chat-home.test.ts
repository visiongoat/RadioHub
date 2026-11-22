import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createNativePostgresFixture } from "./helpers/native-postgres-fixture";

describe("Retained Home room discovery SQL", { skip: !process.env.PG_TEST_DATABASE_URL }, () => {
  let f: Awaited<ReturnType<typeof createNativePostgresFixture>>;
  const other = "b".repeat(24), alice = "1".repeat(24), bob = "2".repeat(24);
  before(async () => {
    f = await createNativePostgresFixture("station_home_retention");
    await f.pool.query(`INSERT INTO stations(id,station_uuid,name,slug,url,country,country_code,is_list_visible) VALUES($1,$1,'DE radio','de-radio','https://radio.test/de','Germany','DE',true)`, [other]);
    await f.pool.query(`INSERT INTO users(id,username,email,full_name,is_public_profile) VALUES($1,'alice','alice@test.test','Alice',true),($2,'bob','bob@test.test','Bob',true)`, [alice,bob]);
    await f.pool.query(`UPDATE users SET avatar='https://images.test/bob.png',source=jsonb_build_object('profileImageUrl','https://images.test/bob-profile.png') WHERE id=$1`,[bob]);
    await f.pool.query(`INSERT INTO station_chat_messages(id,station_id,user_id,client_id,content) VALUES($1,$2,$3,$4,'Hello Germany')`, ["d".repeat(24),other,bob,randomUUID()]);
    await f.pool.query(`INSERT INTO station_chat_home_previews(message_id,decision,display_name,reviewed_content) VALUES($1,'approved','Bob','Hello Germany')`,["d".repeat(24)]);
  });
  after(async () => { await f?.close(); });
  afterEach(async () => {
    const { closePostgres } = await import("../src/postgres-runtime");
    await closePostgres();
  });
    test("cached retained rooms immediately exclude deleted, reported, sanctioned and hidden history", async () => {
      const { activeStationRooms } = await import("../src/services/station-chat-home");
      const quiet = "e".repeat(24), retained = "f".repeat(24);
      await f.pool.query(`INSERT INTO stations(id,station_uuid,name,slug,url,country,country_code,is_list_visible) VALUES($1,$1,'FR quiet','fr-quiet','https://radio.test/fr','France','FR',true)`, [quiet]);
      await f.pool.query(`INSERT INTO station_chat_messages(id,station_id,user_id,client_id,content,created_at) VALUES($1,$2,$3,$4,'Retained conversation',now()-interval '23 hours')`, [retained,quiet,alice,randomUUID()]);
      const visible = async (expected: boolean) => {
        for (const country of ["FR", ""]) {
          const rooms = (await activeStationRooms(country, "")).rooms;
          assert.equal(rooms.some(room => room.station._id === quiet), expected, `scope ${country || "Global"}`);
        }
      };
      await visible(true);
      await f.pool.query("UPDATE station_chat_messages SET deleted_at=now() WHERE id=$1", [retained]);
      await visible(false);
      await f.pool.query("UPDATE station_chat_messages SET deleted_at=NULL WHERE id=$1", [retained]);
      await visible(true);
      await f.pool.query(`INSERT INTO station_chat_reports(id,station_id,message_id,reporter_id,reported_user_id,content_snapshot,reason) VALUES('retained-report',$1,$2,$3,$4,'Retained conversation','review')`, [quiet,retained,bob,alice]);
      await visible(false);
      await f.pool.query("UPDATE station_chat_reports SET status='dismissed' WHERE id='retained-report'");
      await visible(true);
      await f.pool.query(`INSERT INTO station_chat_sanctions(user_id,expires_at,reason) VALUES($1,now()+interval '1 hour','review')`, [alice]);
      await visible(false);
      await f.pool.query("UPDATE station_chat_sanctions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [alice]);
      await visible(true);
      await f.pool.query("UPDATE stations SET is_list_visible=false WHERE id=$1", [quiet]);
      await visible(false);
      await f.pool.query("UPDATE stations SET is_list_visible=true WHERE id=$1", [quiet]);
      await visible(true);
      await f.pool.query("DELETE FROM station_chat_messages WHERE id=$1", [retained]);
      await visible(false);
      await f.pool.query("DELETE FROM stations WHERE id=$1", [quiet]);
    });
    test("retained author avatars survive presence, deduplicate and replace by latest message", async()=>{
      const {activeStationRooms}=await import("../src/services/station-chat-home");
      const carol="3".repeat(24),dave="4".repeat(24);
      await f.pool.query(`INSERT INTO users(id,username,email,full_name,is_public_profile) VALUES($1,'carol','carol@test.test','Carol',true),($2,'dave','dave@test.test','Dave',true)`,[carol,dave]);
      for(const [i,user] of [alice,carol,dave,alice].entries())await f.pool.query(`INSERT INTO station_chat_messages(id,station_id,user_id,client_id,content,created_at) VALUES($1,$2,$3,$4,'Chat participant',now()-($5::int*interval '1 minute'))`,[randomUUID(),other,user,randomUUID(),10-i]);
      let room=(await activeStationRooms('DE','')).rooms[0];
      assert.equal(room.activeCount,0);assert.equal(room.participantCount,4);
      assert.deepEqual(room.participants.map((p:any)=>p._id),[bob,alice,dave]);
      assert.equal(room.messages[0].userId,bob);
      assert.equal(room.messages[0].name,'Bob');
      assert.equal(room.messages[0].avatar,'https://images.test/bob.png');
      assert.equal(room.messages[0].profileImageUrl,'https://images.test/bob-profile.png');
      assert.equal(room.messages[0].content,'Hello Germany');
      await f.pool.query('INSERT INTO station_chat_blocks(user_id,blocked_user_id) VALUES($1,$2)',[alice,bob]);
      room=(await activeStationRooms('DE',alice)).rooms[0];
      assert.equal(room.participantCount,3);assert.deepEqual(room.participants.map((p:any)=>p._id),[alice,dave,carol]);
      assert.ok(room.messages.every((m:any)=>m.userId!==bob),'blocked authors never appear in Home preview fields');
      await f.pool.query('DELETE FROM station_chat_blocks WHERE user_id=$1',[alice]);
    });
    test("Global diversifies the bounded discovery pool beyond one country's first 128 rooms", async () => {
      const { activeStationRooms } = await import("../src/services/station-chat-home");
      await f.pool.query(`INSERT INTO stations(id,station_uuid,name,slug,url,country,country_code,is_list_visible)
        SELECT substring(md5('home-pool-'||i),1,24),md5('home-pool-uuid-'||i),'Pool '||i,'home-pool-'||i,'https://radio.test/pool',CASE WHEN i=140 THEN 'Turkey' ELSE 'France' END,CASE WHEN i=140 THEN 'TR' ELSE 'FR' END,true FROM generate_series(1,140) i`);
      await f.pool.query(`INSERT INTO station_chat_messages(id,station_id,user_id,client_id,content,created_at)
        SELECT md5('home-pool-message-'||i),substring(md5('home-pool-'||i),1,24),$1,md5('home-pool-client-'||i)::uuid,'Retained pool conversation',now()-interval '23 hours' FROM generate_series(1,140) i`, [alice]);
      const global = (await activeStationRooms("", "")).rooms;
      assert.equal(global.length, 32);
      assert.ok(global.some(room => room.station.countryCode === "TR"), "a busy country cannot consume the whole 128-room candidate pool");
      assert.ok(global.some(room => room.station.countryCode === "DE"));
      assert.ok(global.every(room => room.participants.length >= 1 && room.participants.length <= 3), "retained public authors remain after all sessions leave");
      const france = (await activeStationRooms("France", "")).rooms;
      assert.equal(france.length, 32);
      assert.ok(france.every(room => room.station.countryCode === "FR" && room.count === 0));
      await f.pool.query("DELETE FROM stations WHERE slug LIKE 'home-pool-%'");
    });
});
