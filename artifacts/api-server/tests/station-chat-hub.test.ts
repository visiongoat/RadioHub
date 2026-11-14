import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

test("overlapping room connects keep one listener; final disconnect removes listeners and leases", async () => {
  const coordination = new EventEmitter() as any;
  let finishListen: () => void = () => {},
    released = 0,
    leasesRemoved = 0;
  coordination.query = async (sql: string) => {
    if (sql.startsWith("LISTEN"))
      await new Promise<void>((r) => (finishListen = r));
    return { rows: [] };
  };
  coordination.release = () => released++;
  const pool = {
    query: async (sql: string) => {
      if (sql.startsWith("UPDATE station_chat_sessions SET connected"))
        return {
          rows: [
            {
              station_id: "a".repeat(24),
              user_id: "b".repeat(24),
              identity_id: "b".repeat(24),
            },
          ],
        };
      if (sql.startsWith("DELETE")) leasesRemoved++;
      return { rows: [] };
    },
  };
  mock.module("../src/postgres-runtime", {
    namedExports: {
      getPostgresPool: () => pool,
      getPostgresCoordinationPool: () => ({
        connect: async () => coordination,
      }),
    },
  });
  const { StationChatHub } = await import("../src/services/station-live-chat");
  const hub = new StationChatHub();
  class Socket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    events: any[] = [];
    send(x: string) {
      this.events.push(JSON.parse(x));
    }
    close() {
      this.readyState = 3;
      this.emit("close");
    }
  }
  const a = new Socket(),
    b = new Socket();
  const one = hub.connect(a as any, "a".repeat(64)),
    two = hub.connect(b as any, "b".repeat(64));
  await new Promise((r) => setImmediate(r));
  a.close();
  finishListen();
  await Promise.all([one, two]);
  assert.equal(released, 0, "second pending join must retain LISTEN");
  assert.ok(b.events.some((x) => x.type === "connected"));
  assert.equal(coordination.listenerCount("notification"), 1);
  b.close();
  await new Promise((r) => setImmediate(r));
  assert.equal(released, 1);
  assert.equal(coordination.listenerCount("notification"), 0);
  assert.equal(coordination.listenerCount("error"), 0);
  assert.equal(leasesRemoved, 2);
  const invalid = new Socket();
  await hub.connect(invalid as any, "not-a-ticket");
  assert.equal(invalid.readyState, 3);
  mock.restoreAll();
});
