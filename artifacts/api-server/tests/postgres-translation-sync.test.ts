import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import pg from "pg";
import express from "express";
import type { Server } from "node:http";
import { PostgresLocalizationStore } from "../src/data/postgres-localization-store";
import {
  PostgresTranslationSyncStore,
  type TranslationSyncWriter,
} from "../src/data/postgres-translation-sync-store";

describe(
  "Native PostgreSQL translation synchronization",
  { skip: !process.env.PG_TEST_DATABASE_URL },
  () => {
    const schema = `translation_sync_${process.pid}_${randomBytes(6).toString("hex")}`;
    const connection = {
      connectionString: process.env.PG_TEST_DATABASE_URL,
      ssl:
        process.env.PG_TEST_SSL === "require"
          ? { rejectUnauthorized: true }
          : false,
    };
    const admin = new pg.Pool({ ...connection, max: 1 });
    // A held leader must not exhaust the one-client data pool needed for reads.
    const pool = new pg.Pool({
      ...connection,
      max: 1,
      options: `-c search_path=${schema},public`,
    });
    const coordination = new pg.Pool({
      ...connection,
      max: 2,
      options: `-c search_path=${schema},public`,
      application_name: schema,
    });
    const store = new PostgresLocalizationStore(pool);
    const sync = new PostgresTranslationSyncStore(coordination);
    let service: typeof import("../src/services/translation-sync").TranslationSyncService;
    let server: Server | undefined;
    let base = "";
    let created = false;
    let providerCalls = 0;
    let answer: (input: any) => Promise<unknown>;
    const priorKey = process.env.OPENAI_API_KEY;
    const response = (value: unknown) => ({
      choices: [
        { message: { content: value === null ? null : JSON.stringify(value) } },
      ],
    });
    const definitions = ["first_key", "second_key"].map((key) => ({
      key,
      defaultValue: "English " + key,
      filePath: "fixture.tsx",
      lineNumber: 1,
    }));

    before(async () => {
      assert.match(schema, /^translation_sync_\d+_[a-f0-9]{12}$/);
      await admin.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      const directory = path.resolve(
        import.meta.dirname,
        "../../../lib/db/migrations",
      );
      for (const file of (await readdir(directory))
        .filter((file) => /^\d+.*\.sql$/.test(file))
        .sort())
        await pool.query(await readFile(path.join(directory, file), "utf8"));
      mock.module("../src/postgres-runtime", {
        namedExports: {
          getPostgresPool: () => pool,
          getPostgresCoordinationPool: () => coordination,
        },
      });
      mock.module("../src/data/postgres-localization-store", {
        namedExports: { pgLocalization: () => store },
      });
      mock.module("../src/data/postgres-translation-sync-store", {
        namedExports: { pgTranslationSync: () => sync },
      });
      mock.module("openai", {
        defaultExport: class {
          constructor(options: {timeout?:number;maxRetries?:number}) { providerOptions = options; }
          chat = {
            completions: {
              create: async (input: unknown) => {
                providerCalls++;
                return answer(input);
              },
            },
          };
        },
      });
      const cache = {
        clearByPattern: async () => 0,
        get: async () => null,
        set: async () => {},
        del: async () => {},
      };
      mock.module("../src/cache", {
        defaultExport: cache,
        namedExports: { CacheManager: cache, CacheKeys: {} },
      });
      mock.module("../src/services/sync", {
        namedExports: { syncService: {} },
      });
      service = (await import("../src/services/translation-sync"))
        .TranslationSyncService;
      mock.method(service, "scanFrontendForKeys", async () => definitions);
      const { registerTranslationAdminRoutes } =
        await import("../src/routes/translation-admin-routes");
      const app = express();
      app.use(express.json());
      const requireAdmin = (req: any, res: any, next: () => void) =>
        req.headers["x-fixture-admin"] === "true"
          ? next()
          : res.status(401).end();
      registerTranslationAdminRoutes(app, {
        requireAdmin,
        requireAuth: requireAdmin,
      });
      server = await new Promise<Server>((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      });
      base = `http://127.0.0.1:${(server.address() as any).port}`;
    });
    beforeEach(async () => {
      await pool.query(
        "TRUNCATE translation_keys,translations,translation_languages,translation_metadata CASCADE",
      );
      await store.saveTranslationLanguage({
        code: "tr",
        name: "Turkish",
        isEnabled: true,
      });
      process.env.OPENAI_API_KEY = "fixture-not-a-real-key";
      providerCalls = 0;
      answer = async (input) =>
        response(
          Object.fromEntries(
            JSON.parse(input.messages[1].content).map((key: any) => [
              key.key,
              "Türkçe " + key.key,
            ]),
          ),
        );
    });
    after(async () => {
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
      if (server)
        await new Promise<void>((resolve, reject) =>
          server!.close((error) => (error ? reject(error) : resolve())),
        );
      mock.restoreAll();
      await Promise.all([pool.end(), coordination.end()]);
      try {
        if (created) {
          assert.match(schema, /^translation_sync_\d+_[a-f0-9]{12}$/);
          await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
      } finally {
        await admin.end();
      }
    });

    let providerOptions: {timeout?:number;maxRetries?:number} = {};
    const adminTranslate = async (missingOnly = false, maxKeys?:number) => {
      const result = await fetch(
        `${base}/api/admin/translation-languages/tr/translate`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-fixture-admin": "true",
          },
          body: JSON.stringify({ missingOnly, ...(maxKeys===undefined?{}:{maxKeys}) }),
        },
      );
      return { status: result.status, body: (await result.json()) as any };
    };
    const textResponse = (content: string) => ({
      choices: [{ message: { content } }],
    });

    it("bounded missing-only requests resume without retranslating saved rows",async()=>{
      await service.syncNewKeys();
      answer=async(input)=>textResponse(input.messages[1].content.includes('first_key:')?'first_key: Bir':'second_key: İki');
      const first=await adminTranslate(true,1);assert.equal(providerOptions.timeout,25_000);assert.equal(providerOptions.maxRetries,0);assert.equal(first.status,200);assert.equal(first.body.stats.translated,1);assert.equal(first.body.stats.remaining,1);
      const second=await adminTranslate(true,1);assert.equal(second.body.stats.translated,1);assert.equal(second.body.stats.remaining,0);
      const done=await adminTranslate(true,1);assert.equal(done.body.stats.translated,0);assert.equal(done.body.stats.remaining,0);assert.equal(providerCalls,2);
      for(const invalid of [0,61,1.5])assert.equal((await adminTranslate(true,invalid)).status,400);
      assert.equal((await adminTranslate(false,1)).status,400);
    });

    it("admin missing-only fills absent/blank rows and records one atomic version increment", async () => {
      await service.syncNewKeys();
      const key = await store.findKey("first_key");
      await store.upsertTranslation({
        keyId: key._id,
        language: "tr",
        value: "  ",
        isCompleted: true,
      });
      answer = async () => textResponse("first_key: Bir\nsecond_key: İki");
      const result = await adminTranslate(true);
      assert.equal(result.status, 200);
      assert.equal(result.body.stats.translated, 1);
      assert.equal(result.body.stats.fixed, 1);
      assert.equal(result.body.stats.failed, 0);
      assert.equal((await store.getMetadata()).languagesVersion, 3);
      assert.equal((await store.listTranslations("tr")).length, 2);
    });

    it("admin missing-only preserves existing completed copy; explicit repair mode can fix unchanged English copy", async () => {
      await service.syncNewKeys();
      for (const key of await store.getKeys())
        await store.upsertTranslation({
          keyId: key._id,
          language: "tr",
          value: key.defaultValue,
          isCompleted: true,
        });
      answer = async () => textResponse("first_key: Bir\nsecond_key: İki");
      assert.equal((await adminTranslate(true)).body.stats.fixed, 0);
      assert.equal(providerCalls, 0);
      const repaired = await adminTranslate(false);
      assert.equal(repaired.status, 200);
      assert.equal(repaired.body.stats.fixed, 2);
      assert.equal((await store.getMetadata()).languagesVersion, 3);
    });

    it("admin repair compare-and-swap preserves an edit made during the provider request", async () => {
      await service.syncNewKeys();
      for (const key of await store.getKeys())
        await store.upsertTranslation({
          keyId: key._id,
          language: "tr",
          value: key.defaultValue,
          isCompleted: true,
        });
      answer = async () => {
        const key = await store.findKey("first_key");
        await store.upsertTranslation({
          keyId: key._id,
          language: "tr",
          value: "Human correction",
          isCompleted: true,
        });
        return textResponse("first_key: AI must not win\nsecond_key: İki");
      };
      const result = await adminTranslate(false);
      assert.equal(result.status, 200);
      assert.equal(result.body.stats.fixed, 1);
      assert.equal(
        (await store.getTranslations("tr")).first_key,
        "Human correction",
      );
    });

    it("admin counts missing response lines and empty content as failures", async () => {
      await service.syncNewKeys();
      answer = async () => textResponse("");
      const empty = await adminTranslate();
      assert.equal(empty.status, 200);
      assert.equal(empty.body.stats.failed, 2);
      answer = async () => textResponse("first_key: Bir");
      const result = await adminTranslate();
      assert.equal(result.status, 200);
      assert.equal(result.body.stats.translated, 1);
      assert.equal(result.body.stats.failed, 1);
    });

    it("admin responds only after releasing database ownership, including completed no-op retries", async () => {
      await service.syncNewKeys();
      answer = async () => textResponse("first_key: Bir\nsecond_key: Iki");
      const originalWithLeader = sync.withLeader.bind(sync);
      const originalJson = express.response.json;
      let ownershipReleased = false;
      const responseOwnership: boolean[] = [];
      const leaderMock = mock.method(sync, "withLeader", async <T>(operation: (writer: TranslationSyncWriter) => Promise<T>) => {
        const result = await originalWithLeader(operation);
        ownershipReleased = true;
        return result;
      });
      const jsonMock = mock.method(express.response, "json", function (this: express.Response, body: any) {
        responseOwnership.push(ownershipReleased);
        return originalJson.call(this, body);
      });
      try {
        const translated = await adminTranslate(true);
        assert.equal(translated.status, 200);
        assert.equal(translated.body.stats.translated, 2);
        ownershipReleased = false;
        const complete = await adminTranslate(true);
        assert.equal(complete.status, 200);
        assert.equal(complete.body.stats.translated, 0);
        assert.equal(providerCalls, 1);
        assert.deepEqual(responseOwnership, [true, true]);
      } finally {
        jsonMock.mock.restore();
        leaderMock.mock.restore();
      }
    });

    it("admin native SQL failure rolls the whole batch back and returns HTTP 500", async () => {
      await service.syncNewKeys();
      await pool.query(
        "ALTER TABLE translations ADD CONSTRAINT admin_sync_reject CHECK (value <> 'reject')",
      );
      answer = async () => textResponse("first_key: Bir\nsecond_key: reject");
      try {
        assert.equal((await adminTranslate()).status, 500);
        assert.deepEqual(await store.listTranslations("tr"), []);
        assert.equal((await store.getMetadata()).languagesVersion, 2);
      } finally {
        await pool.query(
          "ALTER TABLE translations DROP CONSTRAINT admin_sync_reject",
        );
      }
    });

    it("admin shares PostgreSQL singleton ownership with automated sync and rejects disabled languages", async () => {
      await service.syncNewKeys();
      await sync.withLeader(async () => {
        assert.equal((await adminTranslate()).status, 409);
      });
      await pool.query(
        "UPDATE translation_languages SET is_enabled=false WHERE code='tr'",
      );
      assert.equal((await adminTranslate()).status, 409);
      assert.equal(providerCalls, 0);
    });

    it("creates keys and translations with atomic version bumps using a one-client data pool", async () => {
      assert.deepEqual(await service.runFullSync(), {
        keysAdded: 2,
        keysExisting: 0,
        translated: 2,
        failed: 0,
        languages: 1,
      });
      assert.equal((await store.getMetadata()).languagesVersion, 3);
      assert.equal(providerCalls, 1);
      assert.equal(
        (await store.listTranslations("tr")).every((row) => row.isCompleted),
        true,
      );
      assert.equal(service.isCurrentlyRunning(), false);
    });

    it("retries failed and incomplete translations when no new keys were discovered", async () => {
      await service.syncNewKeys();
      const keys = await store.getKeys();
      await store.upsertTranslation({
        keyId: keys[0]._id,
        language: "tr",
        value: "Draft",
        isCompleted: false,
      });
      await store.upsertTranslation({
        keyId: keys[1]._id,
        language: "tr",
        value: "   ",
        isCompleted: true,
      });
      assert.deepEqual(await service.runFullSync(), {
        keysAdded: 0,
        keysExisting: 2,
        translated: 2,
        failed: 0,
        languages: 1,
      });
      assert.equal(providerCalls, 1);
      assert.equal(
        (await store.listTranslations("tr")).every((row) =>
          row.value.startsWith("Türkçe"),
        ),
        true,
      );
    });

    it("counts empty provider content as failed and succeeds on the next retry", async () => {
      answer = async () => response(null);
      const failed = await service.runFullSync();
      assert.equal(failed.failed, 2);
      assert.equal(failed.translated, 0);
      assert.equal((await store.getMetadata()).languagesVersion, 2);
      answer = async () => response({ first_key: "Bir", second_key: "İki" });
      const retried = await service.runFullSync();
      assert.equal(retried.keysAdded, 0);
      assert.equal(retried.translated, 2);
      assert.equal(retried.failed, 0);
    });

    it("validates missing, non-string, and placeholder-corrupted values without accepting empty success", async () => {
      await store.createKey({
        key: "placeholder_key",
        defaultValue: "Hello {name}",
      });
      answer = async () =>
        response({ first_key: 123, placeholder_key: "Merhaba" });
      const result = await service.runFullSync();
      assert.equal(result.failed, 3);
      assert.equal(result.translated, 0);
      assert.deepEqual(await store.listTranslations("tr"), []);
    });

    it("does not request paid translations when every value is completed", async () => {
      await service.runFullSync();
      providerCalls = 0;
      delete process.env.OPENAI_API_KEY;
      assert.deepEqual(await service.runFullSync(), {
        keysAdded: 0,
        keysExisting: 2,
        translated: 0,
        failed: 0,
        languages: 1,
      });
      assert.equal(providerCalls, 0);
    });

    it("propagates missing provider configuration instead of reporting a successful no-op", async () => {
      delete process.env.OPENAI_API_KEY;
      await assert.rejects(service.runFullSync(), /OPENAI_API_KEY/);
      assert.equal(service.isCurrentlyRunning(), false);
      assert.equal(await store.countKeys(), 2);
      assert.equal((await store.getMetadata()).languagesVersion, 2);
    });

    it("preserves completed admin edits created while the provider request was in flight", async () => {
      answer = async () => {
        const keys = await store.getKeys();
        await store.upsertTranslation({
          keyId: keys[0]._id,
          language: "tr",
          value: "Curated admin value",
          isCompleted: true,
        });
        return response({ first_key: "AI first", second_key: "AI second" });
      };
      assert.equal((await service.runFullSync()).translated, 1);
      assert.equal(
        (await store.listTranslations("tr")).filter(
          (row) => row.value === "Curated admin value",
        ).length,
        1,
      );
    });

    it("preserves a concurrently edited incomplete draft using compare-and-swap", async () => {
      await service.syncNewKeys();
      const key = (await store.getKeys())[0];
      await store.upsertTranslation({
        keyId: key._id,
        language: "tr",
        value: "Original draft",
        isCompleted: false,
      });
      answer = async () => {
        await store.upsertTranslation({
          keyId: key._id,
          language: "tr",
          value: "New human draft",
          isCompleted: false,
        });
        return response({ first_key: "AI first", second_key: "AI second" });
      };
      assert.equal((await service.runFullSync()).translated, 1);
      assert.equal(
        (await store.findTranslation(key._id, "tr")).value,
        "New human draft",
      );
    });

    it("rolls back generated writes and their version bump together on a database error", async () => {
      await service.syncNewKeys();
      const before = (await store.getMetadata()).languagesVersion;
      await pool.query(
        "ALTER TABLE translations ADD CONSTRAINT sync_reject_translation CHECK (value <> 'reject')",
      );
      answer = async () =>
        response({ first_key: "Allowed", second_key: "reject" });
      try {
        await assert.rejects(service.runFullSync(), /sync_reject_translation/);
        assert.deepEqual(await store.listTranslations("tr"), []);
        assert.equal((await store.getMetadata()).languagesVersion, before);
      } finally {
        await pool.query(
          "ALTER TABLE translations DROP CONSTRAINT sync_reject_translation",
        );
      }
    });

    it("rolls back newly discovered keys if the metadata version cannot be updated", async () => {
      await pool.query(
        "ALTER TABLE translation_metadata ADD CONSTRAINT sync_reject_version CHECK (notes <> 'Auto-sync added 2 new keys')",
      );
      try {
        await assert.rejects(service.syncNewKeys(), /sync_reject_version/);
        assert.equal(await store.countKeys(), 0);
      } finally {
        await pool.query(
          "ALTER TABLE translation_metadata DROP CONSTRAINT sync_reject_version",
        );
      }
    });

    it("rejects another replica and then releases ownership for the next worker", async () => {
      await sync.withLeader(async () => {
        await assert.rejects(
          new PostgresTranslationSyncStore(coordination).withLeader(
            async () => {},
          ),
          /already running/,
        );
      });
      await sync.withLeader(async (writer) => writer.assertOwned());
    });

    it("rejects simultaneous public entry points instead of returning fake zero results", async () => {
      let release!: () => void;
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      answer = async () => {
        started();
        await pending;
        return response({ first_key: "Bir", second_key: "İki" });
      };
      const first = service.runFullSync();
      await entered;
      try {
        await assert.rejects(service.syncNewKeys(), /already running/);
      } finally {
        release();
        await first;
      }
    });

    it("does not write after the leader connection is terminated during a provider call", async () => {
      answer = async () => {
        const sessions = await admin.query(
          "SELECT DISTINCT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=$1 AND l.locktype='advisory'",
          [schema],
        );
        assert.equal(sessions.rowCount, 1);
        await admin.query("SELECT pg_terminate_backend($1)", [
          sessions.rows[0].pid,
        ]);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return response({ first_key: "Bir", second_key: "İki" });
      };
      await assert.rejects(
        service.runFullSync(),
        /terminat|closed|connection/i,
      );
      assert.deepEqual(await store.listTranslations("tr"), []);
      assert.equal((await store.getMetadata()).languagesVersion, 2);
      assert.equal(service.isCurrentlyRunning(), false);
      await sync.withLeader(async (writer) => writer.assertOwned());
    });

    it("rejects use of a retained writer after its lock has been released", async () => {
      let writer!: TranslationSyncWriter;
      await sync.withLeader(async (current) => {
        writer = current;
      });
      await assert.rejects(
        writer.syncKeys([
          { key: "after_release", defaultValue: "Must not write" },
        ]),
        /no longer held/,
      );
      assert.equal(await store.countKeys(), 0);
    });

    it("locks the English source while a generated update waits on a translation row", async () => {
      const key = await store.createKey({
        key: "source_race",
        defaultValue: "Original English",
      });
      await store.upsertTranslation({
        keyId: key._id,
        language: "tr",
        value: "Draft",
        isCompleted: false,
      });
      const observed = await store.findTranslation(key._id, "tr");
      const blocker = await pool.connect();
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM translations WHERE key_id=$1 FOR UPDATE",
        [key._id],
      );
      const generated = sync.withLeader((writer) =>
        writer.saveGenerated([
          {
            keyId: key._id,
            defaultValue: key.defaultValue,
            language: "tr",
            value: "Generated from original",
            observed,
          },
        ]),
      );
      generated.catch(() => {});
      let edit: Promise<unknown> | undefined;
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          waiting = (
            await admin.query(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') waiting",
              [schema],
            )
          ).rows[0].waiting;
          if (waiting) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(
          waiting,
          true,
          "generated update reaches the deliberately held row lock",
        );
        let edited = false;
        edit = admin
          .query(
            `UPDATE "${schema}".translation_keys SET default_value='New English' WHERE id=$1`,
            [key._id],
          )
          .then(() => {
            edited = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(
          edited,
          false,
          "source edit cannot overtake the blocked generated write",
        );
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        assert.equal(await generated, 1);
        await edit;
      }
      assert.equal(
        (await store.findKey("source_race")).defaultValue,
        "New English",
      );
    });

    it("never resurrects an observed translation deleted while the provider was running", async () => {
      const key = await store.createKey({
        key: "deleted_draft",
        defaultValue: "English source",
      });
      await store.upsertTranslation({
        keyId: key._id,
        language: "tr",
        value: "Draft",
        isCompleted: false,
      });
      const observed = await store.findTranslation(key._id, "tr");
      await pool.query("DELETE FROM translations WHERE id=$1", [observed._id]);
      const changed = await sync.withLeader((writer) =>
        writer.saveGenerated([
          {
            keyId: key._id,
            defaultValue: key.defaultValue,
            language: "tr",
            value: "Must not resurrect",
            observed,
          },
        ]),
      );
      assert.equal(changed, 0);
      assert.equal(await store.findTranslation(key._id, "tr"), null);
      assert.equal((await store.getMetadata()).languagesVersion, 1);
    });
  },
);
