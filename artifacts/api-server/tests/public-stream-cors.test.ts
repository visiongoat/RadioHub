import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { applyPublicStreamCors } from "../src/lib/public-stream-cors";
const media = "/api/stream/" + Buffer.from("http://stream-uk1.radioparadise.com/aac-320").toString("base64url");
function probe(path: string, method: string, headers: Record<string,string> = {}) {
  const output = new Map<string, string>();
  const applied = applyPublicStreamCors({path, method, headers}, {
    setHeader(name: string, value: string) {output.set(name.toLowerCase(), value);return this;},
    removeHeader(name: string) {output.delete(name.toLowerCase());},
  } as any);
  return {applied, output};
}
for (const origin of ["null", "app://com.themegaradio.app", "https://cdn.themegaradio.com"]) {
  test(`${origin}: public audio/resolver GET HEAD allow anonymous CORS only`, () => {
    for (const path of [media, "/api/stream/resolve"]) {
      for (const method of ["GET", "HEAD"]) {
        const {applied, output} = probe(path, method, {origin});
        assert.equal(applied,true);
        assert.equal(output.get("access-control-allow-origin"),"*");
        assert.equal(output.has("access-control-allow-credentials"),false);
      }
      for (const header of ["cookie", "authorization", "x-api-key", "x-api-user-token"]) {
        assert.equal(probe(path, "GET", {origin, [header]:"test-only"}).applied,false);
      }
    }
  });
  test(`${origin}: safe range preflight allowed; credentials/mutations denied`, () => {
    assert.equal(probe(media,"OPTIONS",{origin,"access-control-request-method":"GET","access-control-request-headers":"Range, Content-Type"}).applied,true);
    for (const header of ["Authorization","X-API-Key","X-API-User-Token","Cookie"]) {
      assert.equal(probe(media,"OPTIONS",{origin,"access-control-request-method":"GET","access-control-request-headers":header}).applied,false);
    }
    for (const method of ["POST","PUT","DELETE"]) {
      assert.equal(probe(media,method,{origin}).applied,false);
      assert.equal(probe(media,"OPTIONS",{origin,"access-control-request-method":method}).applied,false);
    }
  });
  test(`${origin}: private diagnostics, health and named subroutes not exposed`, () => {
    for(const path of ["/healthz","/health","/api/hls-diagnostics","/api/admin/stations","/api/stream/private-diagnostics","/api/stream/resolve/private","/api/stream/"+Buffer.from("file:///etc/passwd").toString("base64url")]) {
      assert.equal(probe(path,"GET",{origin}).applied,false,path);
      assert.equal(probe(path,"OPTIONS",{origin,"access-control-request-method":"GET"}).applied,false,path);
    }
  });
}
test("real HTTP streaming bytes and resolver JSON retain credential-free CORS", async () => {
  const app=express();
  app.use((req,res,next)=>{applyPublicStreamCors(req,res);if(req.method==="OPTIONS"){res.sendStatus(204);return;}next();});
  app.get(media,(_req,res)=>res.type("audio/aac").send(Buffer.from([0xff,0xf1,0x50,0x80])));
  app.get("/api/stream/resolve",(_req,res)=>res.json({url:"https://example.com/audio"}));
  app.get("/healthz",(_req,res)=>res.json({status:"ok"}));
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  const base=`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  try {
    for(const path of [media,"/api/stream/resolve"]) {
      const r=await fetch(base+path,{headers:{origin:"https://cdn.themegaradio.com"}});
      assert.equal(r.status,200);assert.equal(r.headers.get("access-control-allow-origin"),"*");assert.equal(r.headers.get("access-control-allow-credentials"),null);
      if(path===media)assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from([0xff,0xf1,0x50,0x80]));else await r.text();
    }
    const r=await fetch(base+"/healthz",{headers:{origin:"null"}});assert.equal(r.headers.get("access-control-allow-origin"),null);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
