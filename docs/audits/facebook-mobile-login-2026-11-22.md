# Facebook mobile login — 22 November 2026

## Verified failure

A read-only GET to `https://api.themegaradio.com/api/auth/facebook` returned HTTP 501 and the old `Facebook authentication not configured` placeholder. Production `origin/main` at `e3838b49a` had neither the mobile exchange route nor the browser OAuth implementation. The working design checkout contained an untracked implementation; its existence did not mean it had been released. Its new-account call also omitted the username required by the current production user store.

Meta application: **1419039257104266** (`MegaRadio – Login`). This code does not publish the application or submit Meta review/terms. Live Meta availability and production server configuration need separate verification.

## Resulting flow

1. The existing native client opens the system browser at `/api/auth/facebook?platform=mobile&code_challenge=<S256>`.
2. The server binds a random 10-minute state and return destination to the browser session. A hashed SQL state record prevents parallel callback replay across replicas.
3. Meta returns the authorization code to `https://api.themegaradio.com/api/auth/facebook/callback`. Provider token exchange and profile verification occur only on the server.
4. Mobile receives `megaradio://facebook-auth?code=<one-use-code>`; the 90-second code is hashed at rest. The native verifier must match to exchange it at `POST /api/auth/facebook/exchange`. A wrong verifier cannot consume a valid code.
5. Web keeps the current Passport session and safe localized TV return behavior. Cancellation validates and consumes state without creating an account or handoff.

Facebook ID is authoritative. A matching email belonging to another account requires the existing sign-in method; it never silently links identities. Missing email permission works through a private `oauth.invalid` placeholder, with a public name independent of that email. The mandatory `fb_<24hex>` username works on current main and is recognized by the username allocator in PR #243, which replaces that generated value with a name-based handle.

The obsolete Passport Facebook strategy, including its email auto-link behavior, is removed. Provider tokens, client secrets, passwords and raw error details are not returned in callbacks or application responses.

## Release configuration

Apply migration `0071_facebook_mobile_handoffs.sql` with the server release. The normal PostgreSQL startup migration path applies it; no manual production SQL was executed during preparation.

| Server key | Required value / handling |
| --- | --- |
| `FACEBOOK_APP_ID` | `1419039257104266` |
| `FACEBOOK_APP_SECRET` | Existing Meta secret, server only; never commit or print |
| `FACEBOOK_CALLBACK_URL` | `https://api.themegaradio.com/api/auth/facebook/callback` |
| `FACEBOOK_GRAPH_VERSION` | `v24.0` (also the code default) |
| `FRONTEND_URL` | `https://themegaradio.com` |
| `COOKIE_DOMAIN` | `.themegaradio.com` |
| `SESSION_SECRET` | Keep the existing strong production session secret |

No native source, scheme, entitlement or dependency changed. The native iOS `com.visiongo.megaradio` and Android `com.megaradio` applications already register `megaradio://`; they do not require a Meta SDK or client secret. The prepared mobile21 archive does not need rebuilding for these server changes.

## Validation and limits

- Library and API TypeScript checks passed.
- API production bundle passed (`ENTRY=src/index-api.ts`).
- 29 API tests passed: state/replay, mobile proof binding, cancellation, safe redirects, account-linking privacy, disabled accounts, new-user username requirements, Google/Apple regressions and migration ordering.
- 7 tests passed against disposable loopback PostgreSQL in a temporary schema: all migrations through 0071, eight-way concurrent state and code consumption, wrong-proof preservation, expiration, hash-only storage, delete cascade and a complete HTTP flow creating a real new account without email permission. The temporary schema was removed.
- Existing native callback validation tests passed (2/2), read-only audit of iOS/Android configuration found no native blocker.

Production deployment, production credential presence, Meta publication, and a real Facebook account sign-in on a physical device are not established by fixture tests and remain release verification steps.
