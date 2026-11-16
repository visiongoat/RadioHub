import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";

test("join bursts coalesce presence; message bursts bound DB work and resync; slow sockets disconnect", async () => {
  const station = "a".repeat(24), actor = "b".repeat(24);
  const listener = new EventEmitter() as any;
  listener.query = async () => ({rows: []});
  listener.release = () => {};
  let counts = 0, messageReads = 0, releaseMessage: (() => void) | undefined;
  const pool = { query: async (sql: string) => {
    if (sql.startsWith("UPDATE station_chat_sessions SET connected"))
      return {rows: [{station_id: station, user_id: actor, identity_id: actor}]};
    if (sql.includes("count(DISTINCT identity_id)")) {
      counts++;
      return {rows: [{station_id: station, count: 300}]};
    }
    if (sql.includes("WHERE m.id=$1")) {
      messageReads++;
      await new Promise<void>(resolve => { releaseMessage = resolve; });
      return {rows: [{_id: "c".repeat(24), stationId: station, userId: actor}]};
    }
    return {rows: []};
  }};
  mock.module("../src/postgres-runtime", {namedExports: {
    getPostgresPool: () => pool,
    getPostgresCoordinationPool: () => ({connect: async () => listener}),
  }});
  const {StationChatHub} = await import("../src/services/station-live-chat");
  const hub = new StationChatHub();
  class Socket extends EventEmitter {
    readyState = 1; bufferedAmount = 0; events: any[] = []; code = 0;
    send(data: string) { this.events.push(JSON.parse(data)); }
    close(code = 1000) { this.code = code; this.readyState = 3; this.emit("close"); }
  }
  const sockets = Array.from({length: 300}, () => new Socket());
  const started = performance.now();
  try {
    await Promise.all(sockets.map(socket => hub.connect(socket as any, "a".repeat(64))));
    assert.equal(counts, 0, "join does not fan out one presence query per connection");
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(counts, 1);
    assert.ok(sockets.every(socket => socket.events.filter(e => e.type === "presence").length === 1));
    const send = (event: object) => listener.emit("notification", {
      channel: "mega_station_chat", payload: JSON.stringify({stationId: station, event}),
    });
    for (let i = 0; i < 10000; i++) send({type: "changed", messageId: "c".repeat(24)});
    assert.equal(messageReads, 1, "busy room has one message lookup in flight");
    releaseMessage!();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messageReads, 1, "overflow requests one resync instead of draining thousands of reads");
    assert.ok(sockets.every(socket => socket.events.some(e => e.type === "resync")));
    sockets[0].bufferedAmount = 256 * 1024 + 1;
    send({type: "deleted", messageId: "d".repeat(24)});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sockets[0].code, 1013);
    assert.ok(sockets[1].events.some(e => e.type === "deleted"));
    console.log(JSON.stringify({mockSockets: 300, notifications: 10000, presenceQueries: counts,
      concurrentMessageReads: messageReads, elapsedMs: Math.round(performance.now() - started)}));
  } finally {
    sockets.forEach(socket => socket.close());
    await new Promise(resolve => setImmediate(resolve));
    mock.restoreAll();
  }
});
