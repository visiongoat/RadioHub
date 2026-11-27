import type { TvDiagnosticBatch } from "../lib/tv-diagnostics-policy";
const CLIENT_SURFACE: Record<TvDiagnosticBatch["platform"], string> = {
  tizen: "samsung_tizen",
  webos: "lg_webos",
  macos: "macos",
};
const USAGE = new Set([
  "app_open",
  "screen_view",
  "playback_start",
  "playback_pause",
  "activity_heartbeat",
  "listening_heartbeat",
]);
type Environment = {
  TV_GA4_MEASUREMENT_ID?: string;
  TV_GA4_API_SECRET?: string;
};
export function tvGa4Configured(env: Environment = process.env): boolean {
  return (
    /^G-[A-Z0-9]{5,20}$/.test(env.TV_GA4_MEASUREMENT_ID || "") &&
    /^[A-Za-z0-9_-]{8,128}$/.test(env.TV_GA4_API_SECRET || "")
  );
}
export function tvGa4Payload(batch: TvDiagnosticBatch) {
  if (
    !batch.consent.analytics ||
    !batch.analytics ||
    batch.events.some((e) => !USAGE.has(e.event))
  )
    return null;
  const desktop = batch.platform === "macos";
  return {
    // Preserve all 128 random bits, without Number rounding or a new identity.
    // GA4 Web documents two positive decimal components separated by a dot.
    client_id: [batch.analytics.clientId.slice(3, 19), batch.analytics.clientId.slice(19)]
      .map((half) => (BigInt(`0x${half}`) + 1n).toString(10))
      .join("."),
    consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
    events: batch.events.map((event, index) => ({
      name: `${desktop ? "desktop" : "tv"}_${event.event}`,
      params: {
        session_id: Number(batch.analytics!.sessionId),
        engagement_time_msec:
          index === 0 ? batch.analytics!.engagementTimeMsec : 0,
        client_surface: CLIENT_SURFACE[batch.platform],
        ...(event.event === "listening_heartbeat" ? {duration_seconds: event.durationMsec! / 1000, playback_state: "playing"} : {}),
        ...(desktop
          ? { desktop_app_version: batch.appVersion, desktop_screen: event.route }
          : { tv_platform: batch.platform, tv_app_version: batch.appVersion,
              tv_bundle_version: batch.bundleVersion, tv_screen: event.route }),
      },
    })),
  };
}
/** No queue, retries, disk spool or logging of identifiers/URLs/secrets.
 * Defaults to disabled until owner configures the existing Web stream secret.
 * A2xx response only acknowledges receipt, not validated processing by GA4.
 */
export function createTvGa4Relay(
  env: Environment = process.env,
  transport: typeof fetch = fetch,
) {
  let pending = 0,
    validatedConfig = "",
    failedConfig = "",
    failedUntil = 0;
  async function validate(
    url: URL,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<boolean> {
    const debug = new URL(url);
    debug.pathname = "/debug/mp/collect";
    const response = await transport(debug, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(payload as object),
        validation_behavior: "ENFORCE_RECOMMENDATIONS",
      }),
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    const reader = response.body?.getReader();
    if (!reader) return false;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16384) {
          await reader.cancel();
          return false;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    try {
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return (
        Array.isArray(result.validationMessages) &&
        result.validationMessages.length === 0
      );
    } catch {
      return false;
    }
  }
  const relay = (batch: TvDiagnosticBatch): boolean => {
    if (!tvGa4Configured(env) || pending >= 4) return false;
    const payload = tvGa4Payload(batch);
    if (!payload) return false;
    const url = new URL("https://www.google-analytics.com/mp/collect");
    url.searchParams.set("measurement_id", env.TV_GA4_MEASUREMENT_ID!);
    url.searchParams.set("api_secret", env.TV_GA4_API_SECRET!);
    const config = env.TV_GA4_MEASUREMENT_ID + "|" + env.TV_GA4_API_SECRET;
    if (failedConfig === config && Date.now() < failedUntil) return false;
    pending++;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 2000);
    timer.unref();
    void Promise.resolve()
      .then(async () => {
        if (validatedConfig !== config) {
          if (!(await validate(url, payload, abort.signal))) {
            failedConfig = config;
            failedUntil = Date.now() + 300000;
            return;
          }
          validatedConfig = config;
        }
        const response = await transport(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: abort.signal,
          redirect: "error",
        });
        await response.body?.cancel();
      })
      .catch(() => {
        /* Best effort; never log request details or delay playback. */
        if (validatedConfig !== config) {
          failedConfig = config;
          failedUntil = Date.now() + 300000;
        }
      })
      .finally(() => {
        clearTimeout(timer);
        pending--;
      });
    return true;
  };
  relay.status = () => ({
    configured: tvGa4Configured(env),
    payloadValidated:
      tvGa4Configured(env) &&
      validatedConfig ===
        env.TV_GA4_MEASUREMENT_ID + "|" + env.TV_GA4_API_SECRET,
  });
  return relay;
}
export const relayTvUsage = createTvGa4Relay();
