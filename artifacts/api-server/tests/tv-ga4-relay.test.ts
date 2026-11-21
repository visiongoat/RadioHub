import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTvGa4Relay,
  tvGa4Payload,
  tvGa4Configured,
} from "../src/services/tv-ga4-relay";
import { validateTvDiagnosticBatch } from "../src/lib/tv-diagnostics-policy";
const usage: any = {
  batchId: "b-" + "b".repeat(32),
  platform: "tizen",
  appVersion: "2.2.9",
  bundleVersion: "local-abcdef1234567",
  consent: { diagnostics: false, analytics: true },
  analytics: {
    clientId: "tv-" + "a".repeat(32),
    sessionId: "1794052800",
    engagementTimeMsec: 1533,
  },
  events: [
    {
      event: "screen_view",
      code: "none",
      route: "settings",
      module: "main",
      line: 0,
      column: 0,
    },
    {
      event: "playback_start",
      code: "none",
      route: "radio-playing",
      module: "audio",
      line: 0,
      column: 0,
    },
  ],
};
test("analytics metadata is accepted only after explicit usage consent and never alongside diagnostic events", () => {
  assert.ok(validateTvDiagnosticBatch(usage));
  assert.equal(
    validateTvDiagnosticBatch({
      ...usage,
      consent: { diagnostics: true, analytics: false },
    }),
    null,
  );
  assert.equal(
    validateTvDiagnosticBatch({
      ...usage,
      consent: { diagnostics: true, analytics: true },
      events: [{ event: "js_error", code: "type_error", route: "settings" }],
    }),
    null,
  );
  for (const a of [
    { ...usage.analytics, email: "private" },
    { ...usage.analytics, clientId: "real-account-id" },
    { ...usage.analytics, sessionId: "private@example.com" },
    { ...usage.analytics, engagementTimeMsec: 600001 },
  ])
    assert.equal(validateTvDiagnosticBatch({ ...usage, analytics: a }), null);
});
test("GA4 payload has usage only, denied ad consent and measured elapsed time exactly once", () => {
  const payload = tvGa4Payload(usage)!;
  assert.equal(payload.client_id, "12297829382473034411.12297829382473034411");
  assert.equal(JSON.stringify(payload).includes(usage.analytics.clientId), false);
  assert.deepEqual(payload.consent, {
    ad_user_data: "DENIED",
    ad_personalization: "DENIED",
  });
  assert.equal(payload.events[0].params.engagement_time_msec, 1533);
  assert.equal(payload.events[1].params.engagement_time_msec, 0);
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "user_id",
    "user_properties",
    "ip_override",
    "page_location",
    "firebase_app_id",
    "batchId",
    "deviceId",
    "message",
    "stack",
  ])
    assert.equal(serialized.includes(forbidden), false);
  assert.equal(
    tvGa4Payload({
      ...usage,
      consent: { diagnostics: true, analytics: false },
    }),
    null,
  );
  assert.equal(
    tvGa4Payload({
      ...usage,
      events: [{ event: "js_error", code: "type_error", route: "other" }],
    }),
    null,
  );
});
test("unconfigured relay sends nothing; configured transport is bounded and exclusively official HTTPS", async () => {
  let calls = 0;
  const requests: any[] = [];
  const fake: any = async (url: any, options: any) => {
    calls++;
    requests.push({ url, options });
    return new Response(JSON.stringify({ validationMessages: [] }), {
      status: 200,
    });
  };
  assert.equal(tvGa4Configured({}), false);
  assert.equal(createTvGa4Relay({}, fake)(usage), false);
  assert.equal(calls, 0);
  const relay = createTvGa4Relay(
    {
      TV_GA4_MEASUREMENT_ID: "G-3X2WGQC0J3",
      TV_GA4_API_SECRET: "test_secret_never_real",
    },
    fake,
  );
  assert.deepEqual(relay.status(), {
    configured: true,
    payloadValidated: false,
  });
  assert.equal(relay(usage), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(relay.status(), {
    configured: true,
    payloadValidated: true,
  });
  assert.equal(calls, 2);
  assert.equal(requests[0].url.pathname, "/debug/mp/collect");
  assert.equal(requests[1].url.pathname, "/mp/collect");
  assert.equal(requests[0].url.origin, "https://www.google-analytics.com");
  assert.equal(requests[0].options.redirect, "error");
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  assert.equal(requests[0].options.headers.authorization, undefined);
  const releases: any[] = [];
  const held: any = () =>
    new Promise((r) => {
      releases.push(r);
    });
  const bounded = createTvGa4Relay(
    {
      TV_GA4_MEASUREMENT_ID: "G-3X2WGQC0J3",
      TV_GA4_API_SECRET: "test_secret_never_real",
    },
    held,
  );
  for (let i = 0; i < 4; i++) assert.equal(bounded(usage), true);
  assert.equal(bounded(usage), false);
  await new Promise((r) => setImmediate(r));
  for (const release of releases) release(new Response("{}", { status: 400 }));
});

test("failed debug validation never sends production collect", async () => {
  const paths: string[] = [];
  const relay = createTvGa4Relay(
    {
      TV_GA4_MEASUREMENT_ID: "G-3X2WGQC0J3",
      TV_GA4_API_SECRET: "test_secret_never_real",
    },
    (async (url: any) => {
      paths.push(url.pathname);
      return new Response(
        JSON.stringify({
          validationMessages: [{ validationCode: "VALUE_INVALID" }],
        }),
        { status: 200 },
      );
    }) as any,
  );
  assert.equal(relay(usage), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(paths, ["/debug/mp/collect"]);
  assert.equal(relay(usage), false);
});

test("debug transport timeout rejects without production request or throwing into caller", async () => {
  const paths: string[] = [];
  const relay = createTvGa4Relay(
    {
      TV_GA4_MEASUREMENT_ID: "G-3X2WGQC0J3",
      TV_GA4_API_SECRET: "test_secret_never_real",
    },
    (async (url: any) => {
      paths.push(url.pathname);
      throw new DOMException("Timed out", "AbortError");
    }) as any,
  );
  assert.equal(relay(usage), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(paths, ["/debug/mp/collect"]);
  assert.deepEqual(relay.status(), {
    configured: true,
    payloadValidated: false,
  });
});

test("GA4 client mapping preserves 128 random bits with stable positive decimal boundaries", () => {
  const mapped = (hex: string) => tvGa4Payload({ ...usage, analytics: { ...usage.analytics, clientId: `tv-${hex}` } })!.client_id;
  assert.equal(mapped("0".repeat(32)), "1.1");
  assert.equal(mapped("f".repeat(32)), "18446744073709551616.18446744073709551616");
  assert.equal(mapped("00000000000000010000000000000000"), "2.1");
  assert.equal(mapped("00000000000000000000000000000001"), "1.2");
  for (const hex of ["0".repeat(32), "f".repeat(32), "0123456789abcdef0123456789abcdef"]) {
    const value = mapped(hex);
    assert.match(value, /^[1-9][0-9]*\.[1-9][0-9]*$/);
    assert.equal(value, mapped(hex));
    const recovered = value.split(".").map(part => (BigInt(part) - 1n).toString(16).padStart(16, "0")).join("");
    assert.equal(recovered, hex);
  }
});

test('decoded listening duration is strictly bounded, usage-consented and forwarded once to GA4',()=>{
 const heartbeat={...usage,events:[{event:'listening_heartbeat',code:'none',route:'radio-playing',durationMsec:60500}]};
 const valid=validateTvDiagnosticBatch(heartbeat)!;assert.ok(valid);
 const event=tvGa4Payload(valid)!.events[0];
 assert.equal(event.name,'tv_listening_heartbeat');assert.equal(event.params.duration_seconds,60.5);
 assert.equal(event.params.playback_state,'playing');assert.equal(event.params.client_surface,'samsung_tizen');
 for(const durationMsec of [0,-1,120001,1.5,'60000',undefined])assert.equal(validateTvDiagnosticBatch({...heartbeat,events:[{...heartbeat.events[0],durationMsec}]}),null);
 assert.equal(validateTvDiagnosticBatch({...heartbeat,consent:{diagnostics:true,analytics:false}}),null);
 assert.equal(validateTvDiagnosticBatch({...heartbeat,events:[{...heartbeat.events[0],event:'screen_view'}]}),null);
});
