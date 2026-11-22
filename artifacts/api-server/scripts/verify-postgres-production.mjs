import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import {
  assertProductionMetafile,
  inspectProductionDependencyGraph,
} from "./production-database-boundary.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function configuration(
  environment = process.env,
  arguments_ = process.argv.slice(2),
) {
  if (environment.POSTGRES_PRODUCTION_SMOKE !== "true")
    throw new Error(
      "Set POSTGRES_PRODUCTION_SMOKE=true to authorize startup writes to a disposable database",
    );
  const databaseUrl = environment.PG_TEST_DATABASE_URL || "";
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["postgres:", "postgresql:"].includes(parsed.protocol),
    "PG_TEST_DATABASE_URL must be PostgreSQL",
  );
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname),
    "Production smoke is restricted to a loopback PostgreSQL server",
  );
  assert.match(
    decodeURIComponent(parsed.pathname),
    /(?:^|[_/])(?:test|smoke|validation)(?:_|$)/i,
    "Use an explicitly named test/smoke/validation database, never a production database",
  );
  const args = new Map(
    arguments_.map((value) => {
      const index = value.indexOf("=");
      return [value.slice(0, index), value.slice(index + 1)];
    }),
  );
  const apiDir = args.get("--api-dir");
  const webDir = args.get("--web-dir");
  if (!apiDir || !webDir)
    throw new Error(
      "Usage: node scripts/verify-postgres-production.mjs --api-dir=/absolute/api-deploy --web-dir=/absolute/web-deploy",
    );
  return {
    databaseUrl,
    apiDir: realpathSync(apiDir),
    webDir: realpathSync(webDir),
  };
}

function verifyDeployment(directory, entry) {
  assert.ok(
    existsSync(path.join(directory, "dist", entry)),
    "Missing production bundle " + entry,
  );
  assert.ok(
    existsSync(path.join(directory, "dist/public/index.html")),
    "Missing production SPA assets",
  );
  const repairCommand = path.join(directory, 'dist/repair-legacy-user-handles.mjs');
  assert.ok(existsSync(repairCommand), 'Missing production legacy-handle repair command');
  const repairHelp = spawnSync(process.execPath, [repairCommand, '--help'], {
    cwd: directory, env: { PATH: process.env.PATH || '' }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(repairHelp.status, 0, 'Production repair command must run without database credentials or dev dependencies');
  assert.match(repairHelp.stdout, /--dry-run/);
  if (entry === 'index-api.mjs') assert.ok(
    existsSync(path.join(directory, "artifacts/megaradio/src")),
    "Missing translation scanner frontend source",
  );
  const report = JSON.parse(
    readFileSync(
      path.join(directory, "dist/production-dependency-report.json"),
      "utf8",
    ),
  );
  assert.equal(report.entry, "src/" + entry.replace(".mjs", ".ts"));
  assertProductionMetafile(report.metafile);
  const graph = inspectProductionDependencyGraph([
    path.join(directory, "package.json"),
  ]);
  const virtualStore = path.join(directory, "node_modules/.pnpm");
  if (existsSync(virtualStore))
    assert.deepEqual(
      readdirSync(virtualStore).filter((name) =>
        /mongoose|mongodb|connect-mongo|legacy-migration/.test(name),
      ),
      [],
      "Legacy packages must not be physically installed",
    );
  for (const name of [
    "mongoose",
    "mongodb",
    "connect-mongo",
    "@workspace/legacy-migration",
  ])
    assert.equal(
      existsSync(path.join(directory, "node_modules", name)),
      false,
      "Forbidden installed package " + name,
    );
  return {
    entry,
    inputFiles: report.inputFiles,
    productionPackages: graph.packageCount,
    mongoDependencies: 0,
  };
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export function childEnvironment(
  databaseUrl,
  port,
  apiPort,
  webPort,
  inheritedEnvironment = process.env,
) {
  const environment = {};
  const allowedSystemKeys = new Set([
    "path",
    "systemroot",
    "windir",
    "comspec",
    "temp",
    "tmp",
    "lang",
    "lc_all",
    "tz",
  ]);
  for (const [name, value] of Object.entries(inheritedEnvironment))
    if (allowedSystemKeys.has(name.toLowerCase())) environment[name] = value;
  return {
    ...environment,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    POSTGRES_SSL: "disable",
    // This harness creates a disposable native fixture, not a customer import.
    POSTGRES_INIT_MODE: "empty",
    POSTGRES_POOL_MAX: "5",
    POSTGRES_CONNECT_TIMEOUT_MS: "3000",
    POSTGRES_STATEMENT_TIMEOUT_MS: "10000",
    SESSION_SECRET: randomBytes(32).toString("hex"),
    PORT: String(port),
    BACKGROUND_JOBS_ENABLED: "false",
    BACKEND_API_URL: "http://127.0.0.1:" + apiPort,
    FRONTEND_URL: "http://127.0.0.1:" + webPort,
    STREAM_PROXY_URL: "http://127.0.0.1:" + apiPort,
    CORS_ALLOWED_ORIGINS: "http://127.0.0.1:" + webPort,
    LOG_LEVEL: "warn",
    AWS_EC2_METADATA_DISABLED: "true",
  };
}

function launch(directory, entry, environment) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(path.join(here, "production-smoke-network-guard.mjs")).href,
      path.join(directory, "scripts", "start-postgres.mjs"),
      "dist/" + entry,
    ],
    {
      cwd: directory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const state = {
    child,
    entry,
    output: "",
    exited: false,
    exit: null,
    error: null,
  };
  const capture = (data) => {
    state.output = (state.output + data.toString()).slice(-40000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("error", (error) => {
    state.error = error;
  });
  child.once("exit", (code, signal) => {
    state.exited = true;
    state.exit = { code, signal };
  });
  return state;
}

async function request(port, route) {
  const response = await fetch("http://127.0.0.1:" + port + route, {
    redirect: "manual",
    headers: { "user-agent": "RadioHub-local-production-smoke" },
    signal: AbortSignal.timeout(12000),
  });
  const body = await response.text();
  assert.equal(
    response.status,
    200,
    route + " returned " + response.status + ": " + body.slice(0, 500),
  );
  return { response, body };
}

async function ready(state, port) {
  const deadline = Date.now() + 45000;
  let lastError;
  while (Date.now() < deadline) {
    if (state.error) throw state.error;
    if (state.exited)
      throw new Error(
        state.entry + " exited before readiness: " + JSON.stringify(state.exit),
      );
    try {
      const result = await request(port, "/readyz");
      const health = JSON.parse(result.body);
      assert.equal(health.ready, true);
      assert.equal(health.database, "postgresql");
      assert.equal(health.postgres, "connected");
      const liveness = await request(port, "/healthz");
      assert.equal(liveness.body, "ok");
      return;
    } catch (error) {
      lastError = error;
      await pause(150);
    }
  }
  throw new Error(state.entry + " readiness timeout: " + lastError?.message);
}

async function stop(state) {
  if (!state || state.exited) return;
  state.child.kill("SIGTERM");
  const deadline = Date.now() + 6500;
  while (!state.exited && Date.now() < deadline) await pause(50);
  if (!state.exited) {
    state.child.kill("SIGKILL");
    const forcedDeadline = Date.now() + 3000;
    while (!state.exited && Date.now() < forcedDeadline) await pause(50);
  }
  assert.equal(
    state.exited,
    true,
    "Failed to stop owned smoke process " + state.entry,
  );
}

async function main() {
  const config = configuration();
  const reports = [
    verifyDeployment(config.apiDir, "index-api.mjs"),
    verifyDeployment(config.webDir, "index-web.mjs"),
  ];
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: false,
    max: 2,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
    application_name: "radiohub-production-smoke-harness",
  });
  const stationId = randomBytes(12).toString("hex");
  const slug = "postgres-smoke-" + stationId;
  const name = "PostgreSQL Production Smoke " + stationId;
  const processes = [];
  let fixtureCreated = false;
  let failed = false;
  try {
    await pool.query(
      "INSERT INTO stations(id,station_uuid,name,url,slug,country,country_code,last_check_ok,votes,descriptions) VALUES ($1,$2,$3,$4,$5,'Germany','DE',true,5,$6::jsonb)",
      [
        stationId,
        randomUUID(),
        name,
        "https://example.invalid/smoke-stream",
        slug,
        JSON.stringify({
          en: {
            meta: name + " independent public radio station.",
            full:
              name +
              " broadcasts a varied selection of music and spoken programmes. This temporary fixture verifies PostgreSQL-backed station pages during a local production smoke test.",
          },
        }),
      ],
    );
    fixtureCreated = true;
    const apiPort = await availablePort(),
      webPort = await availablePort();
    const api = launch(
      config.apiDir,
      "index-api.mjs",
      childEnvironment(config.databaseUrl, apiPort, apiPort, webPort),
    );
    processes.push(api);
    await ready(api, apiPort);
    const apiList = JSON.parse(
      (
        await request(
          apiPort,
          "/api/stations?search=" + encodeURIComponent(name) + "&limit=5",
        )
      ).body,
    );
    assert.ok(
      apiList.stations?.some(
        (station) => String(station._id || station.id) === stationId,
      ),
      "API must return the SQL fixture, not a placeholder/cache fallback",
    );
    const web = launch(
      config.webDir,
      "index-web.mjs",
      childEnvironment(config.databaseUrl, webPort, apiPort, webPort),
    );
    processes.push(web);
    await ready(web, webPort);
    const webList = JSON.parse(
      (
        await request(
          webPort,
          "/api/stations?search=" + encodeURIComponent(name) + "&limit=5",
        )
      ).body,
    );
    assert.ok(
      webList.stations?.some(
        (station) => String(station._id || station.id) === stationId,
      ),
      "Web proxy must return the same PostgreSQL fixture",
    );
    const seoRoute =
      "/api/seo/page-data?url=" + encodeURIComponent("/en/station/" + slug);
    const seo = JSON.parse((await request(webPort, seoRoute)).body);
    assert.equal(
      String(seo.pageData?.station?._id || seo.pageData?.station?.id),
      stationId,
      "Web-local SEO handler must read station data directly from PostgreSQL",
    );
    const admin = await request(webPort, "/admin-login");
    assert.match(
      admin.body,
      /<html/i,
      "Production SPA template must be served",
    );
    const script = admin.body.match(/<script[^>]+src="([^"]+\.js)"/i)?.[1];
    assert.ok(
      script?.startsWith("/assets/"),
      "Production SPA must reference a built asset",
    );
    const asset = await request(webPort, script);
    assert.match(
      asset.response.headers.get("content-type") || "",
      /javascript/,
      "Built JavaScript must not fall through to an HTML response",
    );
    for (const state of processes) {
      assert.equal(state.exited, false, state.entry + " unexpectedly exited");
      assert.doesNotMatch(
        state.output,
        /SMOKE_BLOCKED_EXTERNAL|UNHANDLED REJECTION|UNCAUGHT EXCEPTION|FATAL:/i,
        "Unexpected outbound request or process error",
      );
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: [
            "api-health",
            "api-ready",
            "api-sql-station",
            "web-health",
            "web-ready",
            "web-api-proxy",
            "web-local-sql-seo",
            "spa-html",
            "spa-javascript",
            "no-external-network",
          ],
          deployments: reports,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    failed = true;
    for (const state of processes)
      console.error(
        "\n--- " +
          state.entry +
          " last output ---\n" +
          state.output.replaceAll(config.databaseUrl, "[test database URL]"),
      );
    throw error;
  } finally {
    for (const state of processes.reverse())
      await stop(state).catch((error) => {
        failed = true;
        console.error(error.message);
      });
    try {
      if (fixtureCreated)
        await pool.query("DELETE FROM stations WHERE id=$1", [stationId]);
    } finally { await pool.end(); }
    if (failed) process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
