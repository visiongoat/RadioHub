# Facebook mobile login — 22 November 2026

## Verified failure

A read-only GET to `https://api.themegaradio.com/api/auth/facebook` returned HTTP 501 and the old `Facebook authentication not configured` placeholder. Production `origin/main` at `e3838b49a` had neither the mobile exchange route nor the browser OAuth implementation. The working design checkout contained an untracked implementation; its existence did not mean it had been released. Its new-account call also omitted the username required by the current production user store.

Meta application: **1419039257104266** (`MegaRadio – Login`). This code does not publish the application or submit Meta review/terms. The live Meta console was separately verified after publication and a cold reload on 22 November: public_profile/email only, strict HTTPS/Web OAuth enabled, and the callback matches exactly. Production server configuration remains unverified.

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

Production deployment, production credential presence, and a real Facebook account sign-in on a physical device are not established by fixture tests and remain release verification steps. Meta publication was verified separately in the console.

## Combined mobile21 server release

Prepared on `codex/mobile21-backend-release` from production baseline `e3838b49a` with these scopes and the requested repair of existing automatically generated usernames:

- PR #242 / `14c4bea5f`: Home chat rooms remain discoverable while their message history is retained.
- PR #243 / `3981722cd`: readable public usernames, legacy aliases, registration/search/mention compatibility, and the two matching web signup forms.
- PR #244 / `aa637ea25`: Facebook browser OAuth, mobile code exchange, migration 0071, and security tests.

The only merge conflict was in `passport-config.ts`: the removed legacy Facebook strategy stays removed, while PR #243's Google username behavior is retained. The PostgreSQL Facebook integration test now checks the combined behavior: a new Facebook account is saved and returned with `new_facebook_listener` as both its username and canonical slug. The release combines the three source PRs, the requested proof-based existing-account repair, its production maintenance command, and the regression/packaging checks needed to ship it safely. No native source/config or production state changed during preparation.

Validation: the combined gate passed library/API/web TypeScript, 121 API tests (zero skipped, including real isolated PostgreSQL cases and all ordered migrations), 202 web tests across 16 files, the API and web server production bundles, and the web production build with `PORT=22507 BASE_PATH=/`. The existing-account refinement then passed 57 affected API regressions (zero skipped), API TypeScript and both server bundles; unchanged web/library checks were not needlessly repeated. The existing notification/privacy fixture now supports the transactional pool contract and its three tests also pass; its original public/private and owner-isolation assertions are retained. Disposable PostgreSQL fixtures use the shared `pg_trgm` extension installed in `public` before parallel schema creation; per-suite schemas are removed afterward.

### Existing native-generated handles

The former native `mobileRegister` generator is verified in native commit `1d91f02a2ab3cdc1355b863b10ff02589862e4ce`, `frontend/src/services/authService.ts:228–244`: sanitized lowercase email prefix (at most 16 characters), an underscore, base36 milliseconds and four random base36 characters. For example, `yogurtcusahin5me_mv748druv2w7` has timestamp `2026-10-13T20:10:35.322Z` and random suffix `v2w7`.

Automatic replacement requires both the same prefix derived from the account's stored email and a timestamp within ten minutes of its recorded creation time. Length or suffix shape alone never changes a custom username. Missing/ambiguous evidence is left unchanged. New public handles use only fullName: `Yoğurtcu Şahin` becomes `yogurtcu_sahin`; actual collisions use `_2`, `_3`, and so on. Existing authenticated `/api/auth/me` refreshes atomically repair proven generated handles, so no fresh login is required when the profile refreshes. The same proof/allocator rules also back the production maintenance command below, which repairs eligible accounts without waiting for them to sign in.

Retired handles stay reserved in server-managed aliases. Their old URLs, exact public directory searches and backend mention recipients resolve to the same account, preserving membership/block/privacy checks. Historical message text is not rewritten. Tests cover the exact former generator, a fresh registration submitted by an old client, simultaneous/colliding allocation, unchanged custom lookalikes and old-alias privacy.

**Native21 compatibility limit:** its `src/utils/stationChatText.ts` alias whitelist accepts only the older `user_<timestamp>_<random>` and `fb_<hex>` forms. Canonical profile/search responses and backend mention notifications support the newly recognized email-derived alias, but old message text using that alias may remain plain `@old_handle` without a canonical profile link in native21. Updating that rendering whitelist needs a later native build; native source and the prepared21 archive were deliberately left untouched.

### Repair all existing accounts

The production API and web packages include `dist/repair-legacy-user-handles.mjs`; it runs with the API service's existing PostgreSQL environment and needs no source checkout, tsx or development dependencies. It is an operator command, not an HTTP endpoint. Start with aggregate inspection:

```sh
node dist/repair-legacy-user-handles.mjs --dry-run
```

Apply the user's authorized repair to every proven legacy account, including private or disabled accounts, without altering their privacy/status/role:

```sh
node dist/repair-legacy-user-handles.mjs --apply --batch-size=100 --pause-ms=25
```

The command scans every account in bounded ID-keyset pages. Each eligible account is rechecked after the shared username allocator lock and a row lock; a concurrent custom edit is preserved. Only username, server-managed retired aliases and updated_at change. IDs, existing profile slugs/URLs, email, roles, status, privacy, preferences and unrelated source metadata are retained. Collisions use the same reserved username/slug/ID/alias namespace and short `_2`, `_3` suffixes as normal registration. Locks are released before the default 25ms pause, keeping foreground registrations responsive.

Output contains aggregate counters only; it never prints account names, emails, IDs, tokens or database credentials. After apply it performs another read-only scan. Completion requires `remainingEligible: 0`; exit2 means eligible work remains and the idempotent command can be repeated. Unproven lookalikes are counted separately and left unchanged. Interrupted runs can resume by rerunning the command; a second successful apply reports zero changes and does not touch canonical accounts. Clients receive canonical names on their normal refresh; historical message text is not rewritten.

Production execution and its actual counts remain an operational release step; no production database was accessed during implementation. Local isolated PostgreSQL tests cover dry-run immutability, all-account batching, private/disabled/custom protection, old alias/search/reservation behavior, concurrent custom edits, transaction rollback, command output privacy and repeated apply. The bundled production command also passed a real PostgreSQL dry-run/apply/verification/repeat exercise. Production smoke now requires the deployed command to run `--help` without credentials or development dependencies. The bulk-command revision passed 44 affected API regressions, the 9-case real PostgreSQL handle suite, 10 production boundary/smoke-safety checks, API TypeScript and both production server bundles; its actual bundled command also passed dry-run/apply/verification/repeat against an isolated database.

### Deployment and rollback

Deploy this single reviewed release only after explicit server-release authorization and access to the production project. Keep the prior deployment/image for `e3838b49a` available. Configure the Facebook server keys above without printing the secret; normal startup applies additive migration 0071. Verify service health, signup/profile/room behavior and physical-device Facebook sign-in after release. The prepared iOS21 archive is independent of this server deployment.

If rollback is needed, restore the prior server/web image or revert the single combined code commit and redeploy. Leave the two additive OAuth tables and applied migration checksum in place; the prior code ignores them. Do not drop accounts, undo readable handles, erase profile aliases, or edit an applied SQL migration. Persisted handle/alias changes and room history remain data; older code restores the former discovery and alias-resolution behavior rather than reversing those records. Meta publication is independent and is not changed by a code rollback.
