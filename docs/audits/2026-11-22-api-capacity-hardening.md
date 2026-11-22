# API capacity controls before the mobile launch

## Problem and change

The API's apparent 100-request/minute limiter was mounted at `/api`, but its skip
callback checked whether `req.path` began with `/api`. Express removes the mount
prefix, so ordinary `/api/stations` requests reached that callback as `/stations`
and bypassed the limit. Both the API and authentication limiters also exempted
caller-controlled crawler User-Agent strings.

The API now applies a bounded, IP-based 600-request/minute default under the actual
mount, including clients claiming to be crawlers. The separate authentication
limit remains **10 failed requests per 15 minutes**, with successful requests
discounted. Quota responses keep `Retry-After` and rate headers and explicitly
carry the shared private/no-store cache policy. Operational probe paths remain
exempt; similarly named descendants do not.

The existing 300 inbound TCP-connection ceiling is preserved as the default and
becomes configurable. `/health` and `/api/health` expose aggregate active/limit and
WebSocket counts without peer addresses, tokens, identities or request payloads.
Changing this setting does not prove that an instance can serve the requested
capacity. PostgreSQL pools, per-user WS limits and individual stream/metadata
limits are unchanged.

## Runtime configuration

| Key | Default | Accepted range |
| --- | ---: | ---: |
| `API_MAX_CONNECTIONS` | 300 | 1–20,000 |
| `API_RATE_LIMIT_MAX` | 600 requests/IP/minute | 1–6,000 |

Only complete decimal positive integers are accepted. Missing, zero, negative,
fractional, exponential, overflow, suffix-contaminated and out-of-range inputs
fall back to the stated default; zero never disables protection. Runtime values
are read at startup, so changes require a normal service deployment/restart.

The default request budget is a bounded initial allowance for shared households
or office NATs running mobile, TV, discovery and chat, rather than a concurrency
or throughput guarantee. Auth and message/upload endpoint-specific protections
remain in place. Choose production values from actual CPU/RAM, request/429,
connection and PostgreSQL-pool measurements; do not raise limits speculatively.

## Trusted proxy boundary and rollout gate

`app.set('trust proxy', 1)` is unchanged. The quota key uses Express's resolved
client address and express-rate-limit's existing IPv6 /56 grouping. Arbitrary
`X-Real-IP`, `CF-Connecting-IP`, authentication headers and untrusted left-hand
`X-Forwarded-For` additions cannot choose a separate bucket in the tested
one-trusted-proxy topology. No trust-all or unconditional Cloudflare-header
override is introduced.

Before enabling the corrected limiter in production, verify the real closest-hop
forwarding chain at the API ingress and at the web-to-API proxy. One public direct
Railway ingress and a Cloudflare-plus-Railway chain are different configurations.
The local HTTP tests prove the one-hop behavior, not the production edge setup.
If a CDN edge is accidentally treated as a client, legitimate traffic would share
one quota. Do not merge/deploy on an assumed chain or hide the issue by trusting
all supplied hops.

## Health and operational setup

- API and web implement `/readyz`, including PostgreSQL/startup readiness. Use
  those paths for Railway deployment readiness after checking each service's
  configuration. Keep `/healthz` as the separate cheap liveness signal.
- The stream proxy has `/healthz`; do not assign a shared `/readyz` setting to all
  three services. There is no single role-safe Railway config file in this repo.
- The existing Docker HEALTHCHECKs remain liveness checks. This change does not
  silently reinterpret a database outage as a container liveness failure.
- Keep one API replica until direct/group WS tickets, fanout and presence have a
  shared implementation. Railway does not provide sticky sessions. Raising the
  new connection ceiling does not make process-local chat state multi-replica.
- Confirm durable storage for `public/uploads/chat` before any deployment. This
  patch does not move existing media, create volumes, change a paid plan, alter
  replica counts or mutate production data.

## Verification and rollback

Tests exercise the real Express `/api` mount, complete-decimal config bounds,
forged crawler/IP headers, IPv6 grouping, exact probe exemptions, successful and
failed authentication budgets, aggregate live TCP/WS counts, and safe error paths.
All network fixtures listen only on loopback; no production load test is run.

Verified locally: 8 new capacity regressions plus existing private/health cache
and packaged-TV public-CORS tests, **27 passed / 0 skipped**; library/API TypeScript
and the API production bundle passed. This is deliberately a narrow API patch:
no migration, dependency, replica, memory-allocation or storage change is included.

Roll back the isolated code commit or restore the previous image. No database
migration or data reversal is needed. Restoring the old image also restores its
ineffective global limit and User-Agent authentication bypass, so this is a
temporary operational rollback, not a preferred steady state.
