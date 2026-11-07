import type { Request, Response } from "express";

const MEDIA_PATH = /^\/api\/stream\/(?:resolve|[A-Za-z0-9_-]{12,}={0,2})\/?$/;
const CREDENTIAL_HEADERS = ["cookie", "authorization", "x-api-key", "x-api-user-token"];
const SAFE_HEADERS = new Set(["range", "content-type", "accept", "user-agent"]);

/** Public audio and playlist resolution, never private health/diagnostics or
 * credentialed responses. Outbound URL/DNS/redirect guards remain in routes. */
export function applyPublicStreamCors(req: Pick<Request, "method" | "path" | "headers">, res: Pick<Response, "setHeader" | "removeHeader">): boolean {
  if (!MEDIA_PATH.test(req.path)) return false;
  if (req.path.replace(/\/$/, "") !== "/api/stream/resolve") {
    // Do not accidentally expose a future named/private stream sub-route.
    // This only classifies the encoded public URL; routes still enforce SSRF.
    try {
      const encoded = req.path.split("/")[3];
      const url = new URL(Buffer.from(encoded, "base64url").toString("utf8"));
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    } catch { return false; }
  }
  if (CREDENTIAL_HEADERS.some(name => req.headers[name] !== undefined)) return false;
  const preflight = req.method === "OPTIONS";
  const method = preflight ? req.headers["access-control-request-method"] : req.method;
  if (method !== "GET" && method !== "HEAD") return false;
  if (preflight) {
    const requested = String(req.headers["access-control-request-headers"] || "")
      .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    if (requested.some(name => !SAFE_HEADERS.has(name))) return false;
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.removeHeader("Access-Control-Allow-Credentials");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept, User-Agent");
  return true;
}
