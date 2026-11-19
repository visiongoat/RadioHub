# TV Settings, atmosphere invitation and Premium continuation

## Design and Settings

The user’s Figma Settings source is `Jf3ZOklsARouzh5Mop0rRz / 1650:4129`, 1920×1080. Its owner’s Starter plan blocked MCP reads even though the connected user has a Full Professional seat on `esimfo store`. Copied only the selected Settings frame into the existing empty Pro working file, without changing the source. High-fidelity design context and screenshot succeeded at `UrlfwVnV7oun5Yi0d83obw / 3:58`, session c207d73e-54c4-43b8-9b43-6d6fe320ffc9.

Retained the Figma basic 886×678 card at236,311 and account703×177 at1142,311, with the existing Atmosphere addition beneath the account. Language now opens a dedicated picker at the current language; it is not duplicated under supplemental settings. Startup playback remains on basic Settings. Supplemental keyboard, sleep timer, accessibility, account and casting remain available, with privacy/legal conditional on existing platform policy. No stored settings or account data are erased.

The mobile Home Premium banner’s exact original artwork and #5C27F4→#9F3FFF gradient are reused. It occupies a fixed footer below the independently scrolling category list. Both the last category and the last option lead down to Premium; up/right return into settings. Option reveal uses measured/scaled DOM rectangles instead of assumed72px rows. Account Premium/restore and login/logout have separate indices; the casting option now handles OK. Native/DOM focus follows remote state. Original mobile timer/account/cast SVGs replace inconsistent drawn variants where available. No emoji star or sleep icon remains.

TV Premium copy explicitly promises unlimited chat **viewing**, never writing on TV. Unlimited messaging is identified as web/mobile.

## Atmosphere invitation and idle policy

While a station is genuinely playing, after roughly43–45seconds of no interaction a three-choice glass invitation appears: Fireplace / Pop Lights / City Night. It does not autoplay or change the selected theme without OK. All scenes open the existing six-theme chooser. Back/close decline. Ignored invitations dismiss after20seconds; navigating resets that invitation dwell. It appears at most once per player visit and does not interrupt chat, another modal, buffering or a failed stream. Cast/station replacement dismisses it and resets inactivity. Hidden pages do not show it. The prompt uses static optimized JPEGs, without starting three decoders.

New default automatic atmosphere delay:3minutes; options1,2,3,5,10,15,30. Explicitly stored valid older preferences remain. This is a MegaRadio product choice, not a claimed universal requirement. Android TV documents its system Ambient Mode after10minutes; Samsung requires appropriate screensaver handling during media playback. Existing Samsung AVPlay/screensaver ownership is retained.

Sources:
- https://developer.android.com/training/tv/playback/ambient-mode
- https://developer.samsung.com/smarttv/develop/guides/fundamentals/setting-screensaver.html

## Pop Lights media

Replaced the unsuitable sculpture with true1920×1080 moving neon patterns by Nicola Narracci:
https://www.pexels.com/video/vibrant-abstract-swirling-neon-light-patterns-31331000/

Pexels license permits free use/editing including apps; its restrictions on stock/wallpaper redistribution and implied endorsement remain applicable. This is an edited silent backdrop integrated with MegaRadio’s radio playback, not a standalone media marketplace, download feature or wallpaper service. Small on-screen source credit is included. License: https://www.pexels.com/license/ ; terms: https://www.pexels.com/terms-of-service/ . Do not describe it as public domain or a guarantee of absence of all third-party rights.

The original is five seconds at1080p30. A four-second circular crossfaded cycle is repeated30times into120second H.264/yuv420p files at1080/720/480. These are repeated edited cycles, not120seconds of unique footage. Versioned v4 URLs avoid replacing immutable v3 cached media. Only JPEG covers enter the TV package. Manifest records source/license/author and hashes. Every rendition decoded all2880frames with no black frame and no audio; measured cycle boundary differences remain below the normal99th-percentile motion difference.

## Phone/web Premium

Removed the outer bordered/rounded purchase card and reduced nested account boxing. Hero extends to page edges and fades into the common#0e0e0e surface; content retains24px phone gutters and a readable640px maximum. Purchase/account/code/plan validation, native StoreKit, web checkout, restore and return routing remain unchanged. No purchase was executed.

## Verification

TV TypeScript and119TV tests passed. Clean release worktree web TypeScript/build and3539web tests passed. Native simulator and device-bundle validation, responsive browser checks, live media delivery and installed TV version are recorded in the delivery addendum after completion. Physical iPhone initially unavailable because the user left the network; do not claim installation unless a later devicectl result confirms it.
