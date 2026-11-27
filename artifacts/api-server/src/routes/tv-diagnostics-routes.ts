import { relayTvUsage } from "../services/tv-ga4-relay";
import { type Express, type RequestHandler } from "express";
import {
  credentiallessTvRequest,
  TV_DIAGNOSTICS_PATH,
} from "../lib/tv-diagnostics-cors";
import {
  isTvDiagnosticPlatform,
  validateTvDiagnosticBatch,
  type TvCounterBatch,
} from "../lib/tv-diagnostics-policy";
import {
  recordTvDiagnostics,
  listTvDiagnostics,
} from "../data/postgres-tv-diagnostics";

type Store = {
  record: (batch: TvCounterBatch) => Promise<void>;
  list: (days: number, platform?: string) => Promise<any[]>;
};
export function createTvDiagnosticHandlers(
  store: Store = { record: recordTvDiagnostics, list: listTvDiagnostics },
  now = Date.now,
) {
  // Addresses exist only in a bounded short-lived memory throttle; never persist or log them.
  const recent = new Map<string, { expires: number; count: number }>();
  const completed = new Map<string, number>();
  const pendingIds = new Set<string>();
  const expiry = setInterval(() => {
    const time = now();
    for (const [key, value] of recent)
      if (value.expires <= time) recent.delete(key);
    for (const [key, expires] of completed)
      if (expires <= time) completed.delete(key);
  }, 60000);
  expiry.unref();
  let pending = 0;
  const ingest: RequestHandler = async (req, res) => {
    if (!credentiallessTvRequest(req))
      return void res
        .status(403)
        .json({ error: "Anonymous TV ingestion only" });
    const batch = validateTvDiagnosticBatch(req.body);
    if (!batch)
      return void res
        .status(400)
        .json({ error: "Invalid or unconsented TV diagnostic batch" });
    const time = now(),
      address = req.ip || req.socket?.remoteAddress || "unknown";
    let bucket = recent.get(address);
    if (!bucket || bucket.expires <= time) {
      if (recent.size >= 10000)
        for (const [k, v] of recent) if (v.expires <= time) recent.delete(k);
      if (recent.size >= 10000 && !bucket) return void res.sendStatus(429);
      bucket = { expires: time + 60000, count: 0 };
      recent.set(address, bucket);
    }
    if (++bucket.count > 20 || pending >= 32) return void res.sendStatus(429);
    // A nonce identifies only this flushed request, never a TV or person.
    const expires = completed.get(batch.batchId);
    if (expires && expires > time) return void res.sendStatus(204);
    if (expires) completed.delete(batch.batchId);
    if (pendingIds.has(batch.batchId))
      return void res.status(503).json({ error: "TV report still pending" });
    if (completed.size + pendingIds.size >= 10000)
      return void res.sendStatus(429);
    const events = batch.events;
    pendingIds.add(batch.batchId);
    pending++;
    try {
      // Keep pseudonymous GA4 metadata out of persistence, even the store boundary.
      const { analytics, batchId, ...anonymous } = batch;
      if (batch.platform === "macos") {
        // Desktop usage goes to GA4 without creating TV diagnostic counts.
        if (!relayTvUsage(batch)) return void res.sendStatus(503);
      } else {
        await store.record({ ...anonymous, platform: batch.platform, events });
        if (analytics) relayTvUsage(batch);
      }
      completed.set(batchId, now() + 600000);
      res.sendStatus(204);
    } catch {
      // Failed writes remain retryable; never acknowledge before persistence.
      res.status(503).json({ error: "TV diagnostics temporarily unavailable" });
    } finally {
      pending--;
      pendingIds.delete(batch.batchId);
    }
  };
  const report: RequestHandler = async (req, res) => {
    const days = Number(req.query.days ?? 7),
      platform = req.query.platform;
    if (
      !Number.isInteger(days) ||
      days < 1 ||
      days > 30 ||
      (platform !== undefined && !isTvDiagnosticPlatform(platform))
    )
      return void res.status(400).json({ error: "Invalid diagnostic filter" });
    try {
      res.json({
        days,
        retentionDays: 30,
        ga4: relayTvUsage.status(),
        measurement:
          "Opt-in event counts, not unique users, native crashes or ANRs",
        rows: await store.list(days, platform as string | undefined),
      });
    } catch {
      res.status(503).json({ error: "TV diagnostics temporarily unavailable" });
    }
  };
  return { ingest, report };
}
export function registerTvDiagnosticRoutes(
  app: Express,
  requireAdmin: RequestHandler,
) {
  const handlers = createTvDiagnosticHandlers();
  app.post(TV_DIAGNOSTICS_PATH, handlers.ingest);
  app.get("/api/admin/tv-diagnostics", requireAdmin, handlers.report);
}
