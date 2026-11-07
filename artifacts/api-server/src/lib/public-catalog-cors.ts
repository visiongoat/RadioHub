import type { Request, Response } from "express";

// Deliberately enumerated public, non-personalized reads. Never use a prefix
// such as /api/stations/*: adjacent routes contain user ratings and mutations.
const PUBLIC_READ_PATHS = [
  /^\/api\/app\/pages\/?$/,
  /^\/api\/radio-browser\/(?:top-clicked|top-voted|recent)\/?$/,
  /^\/api\/translations\/[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:\/critical)?\/?$/i,
  /^\/api\/(?:countries|languages|codecs)\/?$/,
  /^\/api\/filters\/(?:countries|languages|genres)\/?$/,
  /^\/api\/genres(?:\/(?:precomputed|discoverable))?\/?$/,
  /^\/api\/genres\/slug\/[^/]+\/?$/,
  /^\/api\/genres\/[^/]+\/(?:stations|stats)\/?$/,
  /^\/api\/stations(?:\/(?:popular|precomputed|country-random|stats))?\/?$/,
  /^\/api\/stations\/(?:similar|by-genre)\/[^/]+\/?$/,
  /^\/api\/station\/[^/]+\/?$/,
  /^\/api\/now-playing\/[^/]+\/?$/,
];
const SAFE_HEADERS = new Set(["accept", "content-type", "x-megaradio-platform"]);
const CREDENTIAL_HEADERS = ["cookie", "authorization", "x-api-key", "x-api-user-token"];

/** Packaged TVs have opaque (null) or app:// origins. Only public reads may
 * use wildcard CORS, without credentials; trusted web CORS remains unchanged. */
export function applyPublicCatalogCors(req: Pick<Request, "method" | "path" | "headers">, res: Pick<Response, "header" | "removeHeader">): boolean {
  if (!PUBLIC_READ_PATHS.some(pattern => pattern.test(req.path))) return false;
  if (CREDENTIAL_HEADERS.some(name => req.headers[name] !== undefined)) return false;
  const preflight = req.method === "OPTIONS";
  const method = preflight ? req.headers["access-control-request-method"] : req.method;
  if (method !== "GET" && method !== "HEAD") return false;
  if (preflight) {
    const requested = String(req.headers["access-control-request-headers"] || "")
      .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    if (requested.some(name => !SAFE_HEADERS.has(name))) return false;
  }
  res.header("Access-Control-Allow-Origin", "*");
  res.removeHeader("Access-Control-Allow-Credentials");
  res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Accept, Content-Type, X-MegaRadio-Platform");
  return true;
}
