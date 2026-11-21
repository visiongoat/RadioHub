/** Closed vocabulary: no messages, stacks, URLs, user or device data. */
export const TV_EVENTS = [
  "startup_ready",
  "startup_error",
  "js_error",
  "promise_error",
  "react_error",
  "catalog_error",
  "playback_error",
  "app_open",
  "screen_view",
  "playback_start",
  "playback_pause",
  "activity_heartbeat",
  "listening_heartbeat",
] as const;
export const TV_CODES = [
  "startup_timeout",
  "asset_load",
  "syntax_error",
  "type_error",
  "reference_error",
  "range_error",
  "security_error",
  "unknown_error",
  "promise_rejected",
  "render_error",
  "http_error",
  "network_error",
  "request_timeout",
  "media_aborted",
  "media_network",
  "media_decode",
  "media_unsupported",
  "playback_failed",
  "none",
] as const;
export const TV_ROUTES = [
  "discover",
  "search",
  "radio-playing",
  "settings",
  "favorites",
  "login",
  "premium-upgrade",
  "countries",
  "genres",
  "other",
] as const;
export const TV_MODULES = [
  "main",
  "audio",
  "startup",
  "vendor",
  "api",
  "unknown",
] as const;
const usage = new Set([
  "app_open",
  "screen_view",
  "playback_start",
  "playback_pause",
  "activity_heartbeat",
  "listening_heartbeat",
]);
const semver = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
export function validAppVersion(v: unknown): v is string {
  return typeof v === "string" && v.length <= 20 && semver.test(v);
}
export function validBundleVersion(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length <= 64 &&
    (validAppVersion(v) ||
      /^gha-\d{1,16}-(?:\d{1,4}-)?[a-f0-9]{7,40}$/.test(v) ||
      /^local-[a-f0-9]{7,40}$/.test(v) ||
      /^\d{8,20}$/.test(v) ||
      v === "unknown")
  );
}
function object(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function keys(v: Record<string, any>, allowed: string[]) {
  return Object.keys(v).every((k) => allowed.includes(k));
}
export type TvDiagnosticEvent = {
  event: string;
  code: string;
  route: string;
  module: string;
  line: number;
  column: number;
  durationMsec?: number;
};
export type TvAnalyticsMetadata = {
  clientId: string;
  sessionId: string;
  engagementTimeMsec: number;
};
export type TvDiagnosticBatch = {
  batchId: string;
  platform: "tizen" | "webos";
  appVersion: string;
  bundleVersion: string;
  consent: { diagnostics: boolean; analytics: boolean };
  events: TvDiagnosticEvent[];
  analytics?: TvAnalyticsMetadata;
};
export function validateTvDiagnosticBatch(
  value: unknown,
): TvDiagnosticBatch | null {
  if (
    !object(value) ||
    !keys(value, [
      "batchId",
      "platform",
      "appVersion",
      "bundleVersion",
      "consent",
      "events",
      "analytics",
    ]) ||
    typeof value.batchId !== "string" ||
    !/^b-[a-f0-9]{32}$/.test(value.batchId) ||
    !["tizen", "webos"].includes(value.platform) ||
    !validAppVersion(value.appVersion) ||
    !validBundleVersion(value.bundleVersion)
  )
    return null;
  const c = value.consent;
  if (
    !object(c) ||
    !keys(c, ["diagnostics", "analytics"]) ||
    typeof c.diagnostics !== "boolean" ||
    typeof c.analytics !== "boolean"
  )
    return null;
  if (
    !Array.isArray(value.events) ||
    value.events.length < 1 ||
    value.events.length > 10
  )
    return null;
  const events: TvDiagnosticEvent[] = [];
  for (const e of value.events) {
    if (
      !object(e) ||
      !keys(e, ["event", "code", "route", "module", "line", "column", "durationMsec"]) ||
      !(TV_EVENTS as readonly string[]).includes(e.event) ||
      !(TV_CODES as readonly string[]).includes(e.code) ||
      !(TV_ROUTES as readonly string[]).includes(e.route)
    )
      return null;
    if (usage.has(e.event) ? !c.analytics || e.code !== "none" : !c.diagnostics)
      return null;
    if (e.event === "startup_ready" && e.code !== "none") return null;
    const module = e.module === undefined ? "unknown" : e.module;
    if (!(TV_MODULES as readonly string[]).includes(module)) return null;
    for (const n of [e.line, e.column])
      if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > 10_000_000))
        return null;
    if (e.event === "listening_heartbeat"
      ? !Number.isInteger(e.durationMsec) || e.durationMsec < 1 || e.durationMsec > 120000
      : e.durationMsec !== undefined) return null;
    events.push({
      event: e.event,
      code: e.code,
      route: e.route,
      module,
      line: e.line ?? 0,
      column: e.column ?? 0,
      ...(e.durationMsec !== undefined ? { durationMsec: e.durationMsec } : {}),
    });
  }
  let analytics: TvAnalyticsMetadata | undefined;
  if (value.analytics !== undefined) {
    const a = value.analytics;
    if (
      !c.analytics ||
      events.some((e) => !usage.has(e.event)) ||
      !object(a) ||
      !keys(a, ["clientId", "sessionId", "engagementTimeMsec"]) ||
      typeof a.clientId !== "string" ||
      !/^tv-[a-f0-9]{32}$/.test(a.clientId) ||
      typeof a.sessionId !== "string" ||
      !/^[1-9]\d{0,15}$/.test(a.sessionId) ||
      !Number.isSafeInteger(Number(a.sessionId)) ||
      !Number.isInteger(a.engagementTimeMsec) ||
      a.engagementTimeMsec < 0 ||
      a.engagementTimeMsec > 600000
    )
      return null;
    analytics = {
      clientId: a.clientId,
      sessionId: a.sessionId,
      engagementTimeMsec: a.engagementTimeMsec,
    };
  }
  return {
    batchId: value.batchId,
    platform: value.platform,
    appVersion: value.appVersion,
    bundleVersion: value.bundleVersion,
    consent: { diagnostics: c.diagnostics, analytics: c.analytics },
    events,
    ...(analytics ? { analytics } : {}),
  };
}

export type TvCounterBatch = Omit<TvDiagnosticBatch, "analytics" | "batchId">;
