import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { applyPostgresMigrations, postgresMigrationConnectionOptions, postgresMigrationLockTimeout, safePostgresInitializationError } from "../scripts/apply-postgres-migrations.mjs";
import { assertPostgresInitializationReady, postgresInitializationMode } from "../scripts/postgres-initialization.mjs";
import { startPostgresApplication } from "../scripts/start-postgres.mjs";

const repository = path.resolve(import.meta.dirname, "../../..");
const migrationsDirectory = path.join(repository, "lib/db/migrations");
const files = fs.readdirSync(migrationsDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
const hashes = files.map((name) => ({ name, checksum: crypto.createHash("sha256").update(fs.readFileSync(path.join(migrationsDirectory, name))).digest("hex") }));
const environment = { DATABASE_URL: "postgresql://fixture:unused@127.0.0.1/never-connected", POSTGRES_INIT_WAIT_MS: "0" };
const verified = { id: "verified", mode: "all", status: "complete", finished_at: new Date() };

function fixture(overrides: Record<string, any> = {}) {
  const state = { authority: false, run: verified, checkpointCount: 1, incomplete: 0, hasDocuments: false,
    hasCheckpoints: false, lockAvailable: true, applied: [], connectError: null, queryError: null, indexes: new Set<string>(), ...overrides };
  const calls: string[] = [];
  let releases = 0;
  let ends = 0;
  let connections = 0;
  const client = {
    async query(sql: string, _values?: unknown[]) {
      calls.push(sql);
      if (state.queryError?.(sql)) throw new Error("injected query failure");
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: state.lockAvailable }] };
      if (sql.startsWith("SELECT current_setting('lock_timeout')")) return { rows: [{ value: '60s' }] };
      if (sql.startsWith('CREATE INDEX CONCURRENTLY')) state.indexes.add(sql.split(/\s+/)[3]);
      if (sql.startsWith('SELECT i.indisvalid')) {
        const name = String(_values?.[0]);
        if (!state.indexes.has(name)) return { rows: [] };
        return { rows: [name === 'stations_recommendation_order_idx'
          ? { valid:true, ready:true, correct_table:true, method:'btree', unique:false, keys:3, attributes:3,
              no_predicate:true, expression:null, default_operator_classes:true, column_collations:true,
              key_columns:['votes','click_count','id'], key_options:[1,1,0] }
          : { valid:true, ready:true, correct_table:true, method:'gin', unique:false, keys:1, no_predicate:true,
              operator_class:'gin_trgm_ops', expression:name === 'stations_name_fold_trgm_idx'
                ? 'station_search_key(name)' : "lower((source ->> 'genre'::text))" }] };
      }
      if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: state.lockAvailable }] };
      if (sql.startsWith("SELECT name,checksum")) return { rows: state.applied };
      if (sql.startsWith("SELECT domain")) return { rows: state.authority ? [{ domain: "USER_STORE" }] : [] };
      if (sql.startsWith("SELECT id,mode")) return { rows: state.run ? [state.run] : [] };
      if (sql.includes("AS checkpoint_count")) return { rows: [{ checkpoint_count: state.checkpointCount, incomplete_count: state.incomplete }] };
      if (sql.includes("AS has_documents")) return { rows: [{ has_documents: state.hasDocuments, has_checkpoints: state.hasCheckpoints }] };
      return { rows: [] };
    },
    release() { releases += 1; },
  };
  const pool = {
    async connect() { connections += 1; if (state.connectError) throw state.connectError; return client; },
    async end() { ends += 1; },
  };
  return { state, calls, client: client as any, createPool: (() => pool) as any,
    get releases() { return releases; }, get ends() { return ends; }, get connections() { return connections; } };
}

test("migration connection validates URLs, verifies TLS and bounds every timeout", () => {
  assert.throws(() => postgresMigrationConnectionOptions({}), /PostgreSQL URL/);
  assert.throws(() => postgresMigrationConnectionOptions({ DATABASE_URL: "mongodb://wrong" }), /PostgreSQL URL/);
  const defaults = postgresMigrationConnectionOptions(environment);
  assert.deepEqual(defaults.ssl, { rejectUnauthorized: true });
  assert.equal(defaults.connectionTimeoutMillis, 10_000);
  assert.equal(defaults.statement_timeout, 300_000);
  assert.equal(postgresMigrationLockTimeout({}), 60_000);
  const bounded = postgresMigrationConnectionOptions({ ...environment, POSTGRES_CONNECT_TIMEOUT_MS: "999999999", POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS: "-1" });
  assert.equal(bounded.connectionTimeoutMillis, 120_000);
  assert.equal(bounded.statement_timeout, 300_000);
  assert.equal(postgresMigrationConnectionOptions({ ...environment, POSTGRES_SSL: "disable" }).ssl, false);
});

test("schema installer executes normal SQL transactionally and the reviewed index concurrently on its locked connection", async () => {
  const db = fixture();
  assert.deepEqual(await applyPostgresMigrations({ environment, migrationsDirectory, createPool: db.createPool, log() {} }), { applied: files.length, skipped: 0 });
  const concurrentNames = ['stations_source_genre_trgm_idx','stations_name_fold_trgm_idx','stations_recommendation_order_idx'];
  assert.deepEqual(db.calls.filter(sql => sql.startsWith('CREATE INDEX CONCURRENTLY')).map(sql => sql.split(/\s+/)[3]),concurrentNames);
  assert.equal(db.calls.filter((sql) => sql === "BEGIN").length, files.length - concurrentNames.length);
  assert.equal(db.calls.filter((sql) => sql === "COMMIT").length, files.length - concurrentNames.length);
  const indexPosition = db.calls.findIndex(sql => sql.startsWith('CREATE INDEX CONCURRENTLY'));
  // Later transactional migrations may follow the concurrent index. Verify
  // its own transaction boundary, not that it happens to be the last file.
  assert.ok(indexPosition > 0);
  assert.equal(db.calls.slice(0, indexPosition).filter(sql => sql === 'BEGIN').length,
    db.calls.slice(0, indexPosition).filter(sql => sql === 'COMMIT').length);
  assert.ok(db.calls.slice(indexPosition + 1).includes('BEGIN'));
  assert.ok(db.calls.slice(indexPosition + 1).find(sql => sql.startsWith('SELECT i.indisvalid')));
  assert.ok(db.calls.some((sql) => sql.includes("pg_try_advisory_lock")));
  assert.ok(db.calls.some((sql) => sql.includes("pg_advisory_unlock")));
  assert.equal(db.releases, 1);
  assert.equal(db.ends, 1);
});
test('schema lock contention expires between completed try-lock statements without opening a transaction', async () => {
  const db = fixture({ lockAvailable: false });
  await assert.rejects(applyPostgresMigrations({ environment: { ...environment, POSTGRES_MIGRATION_LOCK_TIMEOUT_MS: '5' },
    migrationsDirectory, createPool: db.createPool, log() {} }), /Timed out waiting/);
  assert.ok(!db.calls.includes('BEGIN'));
  assert.ok(!db.calls.some(sql => sql.includes('SELECT pg_advisory_lock(')));
  assert.equal(db.releases, 1); assert.equal(db.ends, 1);
});
test('a cancelled concurrent build is not recorded as applied or wrapped in a transaction', async () => {
  const indexMigration = files.findIndex(name => name === '0027_station_source_genre_search.sql');
  assert.ok(indexMigration > 0);
  const db = fixture({ applied: hashes.slice(0, indexMigration), queryError: (sql: string) => sql.startsWith('CREATE INDEX CONCURRENTLY') });
  await assert.rejects(applyPostgresMigrations({ environment, migrationsDirectory, createPool: db.createPool, log() {} }), /injected/);
  assert.ok(!db.calls.some(sql => sql.startsWith('INSERT INTO radiohub_schema_migrations')));
  assert.ok(!db.calls.includes('BEGIN')); assert.ok(!db.calls.includes('COMMIT'));
  assert.ok(db.calls.at(-1)?.includes('pg_advisory_unlock')); assert.equal(db.ends, 1);
});

test("schema installer is a no-op when every immutable migration is applied", async () => {
  const db = fixture({ applied: hashes });
  assert.deepEqual(await applyPostgresMigrations({ environment, migrationsDirectory, createPool: db.createPool, log() {} }), { applied: 0, skipped: files.length });
  assert.equal(db.calls.includes("BEGIN"), false);
});

test("schema installer checks later deployed checksums before applying any earlier new SQL", async () => {
  const db = fixture({ applied: [{ name: files.at(-1), checksum: "modified" }] });
  await assert.rejects(applyPostgresMigrations({ environment, migrationsDirectory, createPool: db.createPool, log() {} }), /has been modified/);
  assert.equal(db.calls.includes("BEGIN"), false);
  assert.equal(db.releases, 1);
  assert.equal(db.ends, 1);
});

test("schema installer rolls back failed DDL and releases its advisory lock", async () => {
  const firstSql = fs.readFileSync(path.join(migrationsDirectory, files[0]), "utf8");
  const db = fixture({ queryError: (sql: string) => sql === firstSql });
  await assert.rejects(applyPostgresMigrations({ environment, migrationsDirectory, createPool: db.createPool, log() {} }), /injected/);
  assert.ok(db.calls.includes("ROLLBACK"));
  assert.ok(db.calls.at(-1)?.includes("pg_advisory_unlock"));
  assert.equal(db.ends, 1);
});

test("schema installer closes the pool even when initial connection fails", async () => {
  const db = fixture({ connectError: new Error("connection refused") });
  await assert.rejects(applyPostgresMigrations({ environment, migrationsDirectory, createPool: db.createPool, log() {} }), /connection refused/);
  assert.equal(db.releases, 0);
  assert.equal(db.ends, 1);
});

test("initialization defaults to import and rejects unrecognized modes", () => {
  assert.equal(postgresInitializationMode({}), "import");
  assert.equal(postgresInitializationMode({ POSTGRES_INIT_MODE: "empty" }), "empty");
  assert.throws(() => postgresInitializationMode({ POSTGRES_INIT_MODE: "automatic" }), /POSTGRES_INIT_MODE/);
});

test("existing authority permits restarts without querying or copying historical data", async () => {
  const db = fixture({ authority: true, run: null });
  assert.equal(await assertPostgresInitializationReady(db.client, {}), "existing");
  assert.equal(db.calls.length, 1);
});

test("fresh empty initialization requires explicit choice and cannot bypass any import evidence", async () => {
  await assert.rejects(assertPostgresInitializationReady(fixture({ run: null }).client, {}), { code: "POSTGRES_INITIALIZATION_PENDING" });
  assert.equal(await assertPostgresInitializationReady(fixture({ run: null }).client, { POSTGRES_INIT_MODE: "empty" }), "empty");
  for (const partial of [{ run: verified }, { run: null, hasDocuments: true }, { run: null, hasCheckpoints: true }]) {
    await assert.rejects(assertPostgresInitializationReady(fixture(partial).client, { POSTGRES_INIT_MODE: "empty" }), /cannot bypass/);
  }
});

test("only final successful import or verification with completed matching checkpoints permits cutover", async () => {
  for (const mode of ["all", "verify"]) {
    assert.equal(await assertPostgresInitializationReady(fixture({ run: { ...verified, mode } }).client, {}), "imported");
  }
  for (const run of [null, { ...verified, mode: "mirror" }, { ...verified, mode: "normalize" }, { ...verified, status: "failed" }, { ...verified, status: "running" }, { ...verified, finished_at: null }]) {
    await assert.rejects(assertPostgresInitializationReady(fixture({ run }).client, {}), { code: "POSTGRES_INITIALIZATION_PENDING" });
  }
  for (const counts of [{ checkpointCount: 0 }, { incomplete: 1 }]) {
    const db = fixture(counts);
    await assert.rejects(assertPostgresInitializationReady(db.client, {}), /checkpoints/);
    assert.ok(db.calls.some((sql) => sql.includes("documents_processed <> source_count")));
  }
});

function launch(db: ReturnType<typeof fixture>, options: Record<string, any> = {}) {
  return startPostgresApplication("dist/index-api.mjs", { environment, cwd: repository,
    applyMigrations: async () => {}, createPool: db.createPool, importApplication: async () => "loaded",
    startMaintenanceServer: async () => ({ close: async () => {}, failureSignal: new AbortController().signal }), log() {}, ...options });
}

test("launcher refuses unknown entry or mode before schema/database/application effects", async () => {
  let called = false;
  await assert.rejects(startPostgresApplication("../../wrong.mjs", { applyMigrations: async () => { called = true; } }), /launcher requires/);
  await assert.rejects(launch(fixture(), { environment: { ...environment, POSTGRES_INIT_MODE: "wrong" }, applyMigrations: async () => { called = true; } }), /POSTGRES_INIT_MODE/);
  assert.equal(called, false);
});

test("launcher initializes schema then gates under lock before loading any application code", async () => {
  const db = fixture();
  let schema = false;
  let imported = false;
  await launch(db, { applyMigrations: async () => { schema = true; }, importApplication: async (url: string) => {
    assert.equal(schema, true);
    assert.equal(db.calls.at(-1), "COMMIT");
    assert.equal(db.ends, 1);
    assert.match(url, /dist\/index-api\.mjs$/);
    imported = true;
  } });
  assert.equal(imported, true);
  assert.ok(db.calls.findIndex((sql) => sql.includes("pg_try_advisory_xact_lock")) < db.calls.findIndex((sql) => sql.startsWith("SELECT domain")));
});

test("launcher never imports app after an incomplete import and cleans up", async () => {
  const db = fixture({ run: null });
  let imported = false;
  await assert.rejects(launch(db, { importApplication: async () => { imported = true; } }), /deadline/);
  assert.equal(imported, false);
  assert.equal(db.calls.at(-1), "ROLLBACK");
  assert.equal(db.releases, 1);
  assert.equal(db.ends, 1);
});

test("launcher retries only pending initialization without holding a transaction or loading app", async () => {
  const db = fixture({ run: null });
  let time = 0;
  let waits = 0;
  const logs: string[] = [];
  assert.equal(await launch(db, { environment: { ...environment, POSTGRES_INIT_WAIT_MS: "10000" }, now: () => time,
    log: (message: string) => logs.push(message), wait: async (ms: number) => {
      assert.equal(db.calls.at(-1), "ROLLBACK");
      assert.equal(db.releases, 1);
      waits += 1;
      time += ms;
      db.state.run = verified;
    } }), "loaded");
  assert.equal(waits, 1);
  assert.equal(logs.filter((line) => line.includes("waiting")).length, 1);
  assert.equal(db.connections, 2);
  assert.equal(db.ends, 1);
});

test("launcher polls an importer-held lock without querying readiness outside the lock", async () => {
  const db = fixture({ lockAvailable: false });
  let time = 0;
  await launch(db, { environment: { ...environment, POSTGRES_INIT_WAIT_MS: "10000" }, now: () => time, wait: async (ms: number) => {
    assert.equal(db.calls.some((sql) => sql.startsWith("SELECT domain")), false);
    db.state.lockAvailable = true;
    time += ms;
  } });
  assert.equal(db.connections, 2);
});

test("launcher stops pending polling at its deadline", async () => {
  const db = fixture({ run: null });
  let time = 0;
  let waits = 0;
  await assert.rejects(launch(db, { environment: { ...environment, POSTGRES_INIT_WAIT_MS: "7000" }, now: () => time,
    wait: async (ms: number) => { time += ms; waits += 1; } }), /deadline/);
  assert.equal(time, 7000);
  assert.equal(waits, 2);
  assert.equal(db.ends, 1);
});

test("default waiting survives a multi-hour import and hands off automatically without loading jobs early", async () => {
  const db = fixture({ run: null });
  let time = 0;
  let waits = 0;
  let opened = 0;
  let closed = 0;
  let imported = 0;
  assert.equal(await launch(db, {
    environment: { DATABASE_URL: environment.DATABASE_URL }, now: () => time,
    startMaintenanceServer: async () => {
      assert.equal(db.calls.at(-1), "ROLLBACK");
      assert.equal(db.releases, 1);
      opened += 1;
      return { close: async () => { closed += 1; }, failureSignal: new AbortController().signal };
    },
    wait: async (ms: number) => {
      assert.equal(ms, 5000);
      assert.equal(imported, 0);
      time += 3_600_000;
      if (++waits === 2) db.state.run = verified;
    },
    importApplication: async () => {
      assert.equal(closed, 1);
      assert.equal(db.ends, 1);
      assert.equal(db.calls.at(-1), "COMMIT");
      imported += 1;
      return "automatically-opened";
    },
  }), "automatically-opened");
  assert.equal(opened, 1);
  assert.equal(imported, 1);
  assert.equal(time, 7_200_000);
});

test("explicit forever waiting and lock contention still require completed verification", async () => {
  const db = fixture({ lockAvailable: false });
  await launch(db, { environment: { ...environment, POSTGRES_INIT_WAIT_MS: "forever" }, wait: async () => {
    assert.equal(db.calls.some((sql) => sql.startsWith("SELECT domain")), false);
    db.state.lockAvailable = true;
  } });
  assert.equal(db.connections, 2);
});

test("ready startup and invalid schema never open a maintenance listener", async () => {
  let opened = 0;
  const options = { startMaintenanceServer: async () => { opened += 1; throw new Error("unexpected listener"); } };
  assert.equal(await launch(fixture(), options), "loaded");
  await assert.rejects(launch(fixture(), { ...options, applyMigrations: async () => { throw new Error("schema failed"); } }), /schema failed/);
  assert.equal(opened, 0);
});

test("cancelled waiting closes maintenance and never imports the application", async () => {
  const db = fixture({ run: null });
  const controller = new AbortController();
  let closed = 0;
  let imported = 0;
  await assert.rejects(launch(db, { environment: { DATABASE_URL: environment.DATABASE_URL }, signal: controller.signal,
    startMaintenanceServer: async () => ({ close: async () => { closed += 1; }, failureSignal: new AbortController().signal }),
    wait: async () => { controller.abort(); }, importApplication: async () => { imported += 1; },
  }), /interrupted/);
  assert.equal(closed, 1);
  assert.equal(db.ends, 1);
  assert.equal(imported, 0);
});

test("an already-cancelled startup does not apply schema or open connections", async () => {
  const db = fixture();
  const controller = new AbortController();
  controller.abort();
  let applied = false;
  await assert.rejects(launch(db, { signal: controller.signal, applyMigrations: async () => { applied = true; } }), /interrupted/);
  assert.equal(applied, false);
  assert.equal(db.connections, 0);
});

test("indefinite startup does not retain listeners on normally retired PostgreSQL clients", async () => {
  const db = fixture({ run: null });
  const clients: EventEmitter[] = [];
  let waits = 0;
  await launch(db, { environment: { DATABASE_URL: environment.DATABASE_URL },
    createPool: () => ({
      async connect() {
        const client = Object.assign(new EventEmitter(), {
          query: db.client.query,
          release() { this.emit("end"); },
        });
        clients.push(client);
        return client;
      },
      async end() {},
    }),
    wait: async () => {
      for (const client of clients) {
        assert.equal(client.listenerCount("error"), 0);
        assert.equal(client.listenerCount("end"), 0);
      }
      if (++waits === 3) db.state.run = verified;
    },
  });
  assert.equal(clients.length, 4);
});

test("a maintenance listener failure aborts waiting without false success", async () => {
  const db = fixture({ run: null });
  const controller = new AbortController();
  let closed = 0;
  let imported = 0;
  await assert.rejects(launch(db, { environment: { DATABASE_URL: environment.DATABASE_URL },
    startMaintenanceServer: async () => ({ close: async () => { closed += 1; }, failureSignal: controller.signal }),
    wait: async () => { controller.abort(new Error("private listener details")); },
    importApplication: async () => { imported += 1; },
  }), /maintenance listener failed/);
  assert.equal(closed, 1);
  assert.equal(imported, 0);
});

test("launcher does not retry schema, connection, query, or empty-mode safety errors", async () => {
  for (const db of [fixture({ connectError: new Error("connection failed") }), fixture({ queryError: () => true })]) {
    let waits = 0;
    await assert.rejects(launch(db, { wait: async () => { waits += 1; } }));
    assert.equal(waits, 0);
    assert.equal(db.ends, 1);
  }
  const db = fixture();
  await assert.rejects(launch(db, { applyMigrations: async () => { throw new Error("schema failed"); } }), /schema failed/);
  assert.equal(db.connections, 0);
  await assert.rejects(launch(db, { environment: { ...environment, POSTGRES_INIT_MODE: "empty" } }), /cannot bypass/);
});

test("startup diagnostics redact connection strings and encoded or decoded database passwords", () => {
  const env = { DATABASE_URL: "postgresql://user:s%40cret@host/db", PGPASSWORD: "othersecret" };
  const sanitized = safePostgresInitializationError(new Error("cannot connect postgresql://user:s%40cret@host/db password s@cret / s%40cret / othersecret"), env);
  assert.doesNotMatch(sanitized, /s@cret|s%40cret|othersecret|postgresql:\/\//);
});
