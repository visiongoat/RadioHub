# Web and TV genre display localization

The web and Samsung/LG TV renderers displayed raw catalogue names even when the
interface language was Turkish or another supported language. They now use the
same fourteen-language genre naming data as the active mobile application.

## Scope

- Shared web formatter: `lib/seo-shared/src/genreLocalization.ts` and its
  descriptor table. Home pills, discovery banners, the genre directory and
  detail headings use the selected language.
- Server-rendered Home navigation, directory links, genre headings, SEO titles
  and structured-data names use the same formatter. A localized presentation
  copy is created; the underlying shared snapshot remains raw and unchanged.
- Complete localized genre searches map back to canonical terms in the existing
  web directory request: Turkish `Caz` → `jazz`, `Klasik` → `classical`, German
  `Klassik` → `classical`, `Nachrichten` → `news`. The visible input is retained.
  Raw English names/slugs and unmatched input keep the previous API behaviour.
  Partial localized prefixes still use the raw server search; no SQL/API
  protocol or global-catalogue request was added.
- Canonical URLs, station filters, counts and raw query caches are retained.
  Unknown niche/proper names retain the catalogue spelling. English editorial
  discovery subtitles remain available in English; other languages use the
  existing localized discovery subtitle.
- No layout, spacing, station playback, authentication or storage changes.

## Separate TV workspace

Active TV source:
`/Users/sahinyogurtcu/Documents/ChatGPT/megaradioIOSAndroidReact/frontend/tvanddesktop/apple-tv-and-macos/web-preview`.

That workspace contains the same two pure label files and narrow changes in
`src/pages/DiscoverNoUser.tsx`, `src/pages/Genres.tsx` and
`src/pages/GenreList.tsx`. Cached raw genre data is translated only when rendered.
It does not expose the web directory's genre search box. The TV source is a
separate existing dirty checkout; unrelated TV work was not committed into this
web branch. This is the Tizen/webOS application, not the native tvOS port.

## Validation

- Shared libraries, web and API TypeScript checks passed with Node24.
- Focused web genre tests cover fourteen languages, cached-language switching,
  stable canonical destinations, directory state and exact localized searches.
- Full web test suite: 196/196 files and 3553/3553 tests passed. An existing
  payment-window test timed out under unrestricted parallel
  load and passed 28/28 in isolation; bounded suite concurrency was then used.
- API SSR/URL/Home regression tests: 68/68 passed, including raw-cache
  immutability and a cold/absent optional Home snapshot.
- Web production, API entry and web-server entry builds passed.
- TV TypeScript check and twelve selected localization/country/router/package/
  legacy-layout tests passed. Legacy Tizen production build and compatibility
  check passed (thirteen ES5 scripts).
- Changes preserve existing classes and are covered by DOM/SSR assertions.
  A physical TV visual check remains dependent on the developer connection.

## Samsung package and physical installation

Signed artifact:
`output/tv-genre-localization-22/MegaRadio.wgt` in the primary web repository.

- Application ID: `lJoKY533ah.MegaRadioTVAPP` (existing official application).
- Version: `2.2.111`; existing signing profile: `MegaRadioTV`.
- SHA256: `7d7d2fe81b5c2b384bbb93fba09ad7732c17795462d511102981aff0bec6f59d`.
- The review-package helper activates the bundled legacy entry, so this physical
  test package does not require a new global TV CDN deployment.
- Known home TV `192.168.1.26`: `UE75DU8070UXXN`, model `24_NKL_UHD_T09`.
  REST confirmed it on and the official installed application at `2.2.104`.
  A separate inactive `MgRadioDev.MegaRadioTVAPP` test app was identified and is
  not the upgrade target.
- Developer mode was enabled, but its host IP was `192.168.1.90`; the current
  Mac LAN address is `192.168.1.38`. SDB26101 did not connect. Update that TV host
  setting and restart before retrying a same-identity upgrade. Do not uninstall
  or reset the application/user data.
- No TV Seller Office publication, global TV CDN release or web main-branch
  merge was performed by this isolated localization task.

## Release and rollback

Coordinate this branch with the pending backend and runtime-hardening release
before the single production deployment. A branch revert removes the web/SSR
presentation formatter without a database migration. Keep canonical catalogue
data intact. The Samsung package is separately installable when SDB is available.
