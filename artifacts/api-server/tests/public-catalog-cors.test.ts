import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPublicCatalogCors } from "../src/lib/public-catalog-cors";

function request(path: string, origin: string, method = "GET", extra = {}) {
  const headers = new Map<string, string>();
  const applied = applyPublicCatalogCors({path, method, headers: {origin, ...extra}}, {
    header(name: string, value: string) { headers.set(name.toLowerCase(), value); return this; },
    removeHeader(name: string) { headers.delete(name.toLowerCase()); },
  } as any);
  return {applied, headers};
}
for (const origin of ["null", "app://com.themegaradio.app", "http://127.0.0.1:4188"]) {
  test(`${origin}: packaged TV public catalog reads are available without credentials`, () => {
    for (const path of ["/api/translations/en", "/api/translations/pt-BR/critical", "/api/countries", "/api/genres", "/api/genres/discoverable", "/api/filters/countries", "/api/stations", "/api/stations/popular", "/api/stations/precomputed", "/api/station/test-radio", "/api/now-playing/123"]) {
      for (const method of ["GET", "HEAD"]) {
        const result = request(path, origin, method);
        assert.equal(result.applied, true, `${method} ${path}`);
        assert.equal(result.headers.get("access-control-allow-origin"), "*");
        assert.equal(result.headers.has("access-control-allow-credentials"), false);
      }
    }
  });
  test(`${origin}: public GET preflight permits only non-credential headers`, () => {
    const result = request("/api/stations", origin, "OPTIONS", {
      "access-control-request-method": "GET",
      "access-control-request-headers": "Content-Type, X-MegaRadio-Platform",
    });
    assert.equal(result.applied, true);
    assert.equal(result.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
    for (const header of ["Authorization", "X-API-Key", "X-API-User-Token", "Cookie", "X-Custom"]) {
      assert.equal(request("/api/stations", origin, "OPTIONS", {
        "access-control-request-method": "GET", "access-control-request-headers": header,
      }).applied, false, header);
    }
  });
  test(`${origin}: private endpoints and mutations never gain public CORS`, () => {
    for (const path of ["/api/admin/stations", "/api/auth/me", "/api/user/favorites", "/api/tv/entitlement", "/api/stations/123/user-rating", "/api/stations/123/ratings", "/api/stations/delete", "/api/translations/en/admin", "/api/genres/admin", "/api/ml/user-profile/123"]) {
      for (const method of ["GET", "OPTIONS"]) {
        const result = request(path, origin, method, {"access-control-request-method": "GET"});
        assert.equal(result.applied, false, `${method} ${path}`);
        assert.equal(result.headers.has("access-control-allow-origin"), false);
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(request("/api/stations", origin, method).applied, false);
      assert.equal(request("/api/stations", origin, "OPTIONS", {"access-control-request-method": method}).applied, false);
    }
  });
  test(`${origin}: credentials on otherwise public paths remain denied`, () => {
    for (const header of ["cookie", "authorization", "x-api-key", "x-api-user-token"]) {
      assert.equal(request("/api/stations", origin, "GET", {[header]: "test-only"}).applied, false, header);
    }
  });
}

test("HTTP public preflight and JSON response expose no credentials; private handler stays protected", async () => {
  const {default: express} = await import("express");
  const app = express();
  app.use((req, res, next) => {
    applyPublicCatalogCors(req, res);
    if (req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  });
  app.get("/api/stations", (_req, res) => res.json({stations: [{id: "public-station"}]}));
  app.get("/api/auth/me", (_req, res) => res.sendStatus(401));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const origin of ["null", "app://com.themegaradio.app"]) {
      const result = await fetch(`${base}/api/stations?tv=1`, {headers: {origin}});
      assert.equal(result.status, 200);
      assert.equal(result.headers.get("access-control-allow-origin"), "*");
      assert.equal(result.headers.get("access-control-allow-credentials"), null);
      assert.deepEqual(await result.json(), {stations: [{id: "public-station"}]});
      const preflight = await fetch(`${base}/api/stations`, {method: "OPTIONS", headers: {origin, "access-control-request-method": "GET", "access-control-request-headers": "Content-Type"}});
      assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
      const privateResult = await fetch(`${base}/api/auth/me`, {headers: {origin}});
      assert.equal(privateResult.status, 401);
      assert.equal(privateResult.headers.get("access-control-allow-origin"), null);
      const credentialed = await fetch(`${base}/api/stations`, {headers: {origin, authorization: "Bearer test-only"}});
      assert.equal(credentialed.headers.get("access-control-allow-origin"), null);
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
