# MegaRadio Google Cast receiver

This is the **single canonical source** for the existing published receiver.
The mobile repository contains only a README pointing here; it has no second
receiver runtime. Source changes still require a web deployment and native
Android rebuild before they affect a physical Cast session.

## Verified integration (2026-11-24)

- The authorized Cast Console inspection by the root agent confirmed **MegaRadio**,
  Custom Web Receiver, published app ID **94952E1F**, exact URL
  **https://themegaradio.com/cast-receiver/index.html**. The Console was not changed.
- Android `app.json` now sets `androidReceiverAppId: "94952E1F"` in the existing
  `react-native-google-cast` plugin. Its generated manifest has exactly one
  `com.reactnative.googlecast.RECEIVER_APPLICATION_ID` with this value. Using the
  Android-only option preserves existing iOS configuration and AirPlay behavior.
- `src/utils/castMedia.ts` keeps the standard LIVE media LOAD, station customData,
  logo, real song and artist. It no longer substitutes the station name as the
  artist when no track artist is available.
- Existing web serving is unchanged: `/cast-receiver/` from
  `client/public/cast-receiver`, with short revalidated cache for receiver UI updates. Deployment must include
  this whole directory. No new receiver registration or fee is needed.

## UI and playback contract

- Centered real station artwork, actual song once (when present), existing
  MegaRadio wordmark in the lower-right TV safe area. Brand SVGs are exact copies
  of `assets/images/chat/mega-wordmark-figma.svg` and the approved TV
  `public/images/figma-home/brand.svg`. Ubuntu fonts/license are existing assets.
- The backdrop uses the same artwork with CSS blur/dimming. It needs no canvas,
  logo proxy, palette API or `crossOrigin` image fetch. An HTTPS image without
  ACAO can render normally; browser/Cast image policy or a broken logo may still
  fail, in which case the official Mega mark remains.
- Google's documented **custom UI** path: `PlayerDataBinder` observes CAF state,
  and one unmuted `<video class="castMediaElement">` remains owned by CAF.
  No manually created player, standard-stream rewriting, credential handling,
  polling, ad insertion or live seeking is introduced. The existing published
  `urn:x-cast:com.visiongo.megaradio` namespace is retained for older senders; only
  connected CAF senders with bounded LOAD/STOP/PAUSE/RESUME/VOLUME payloads are
  accepted. Legacy LOAD uses the same CAF player and existing HTTP(S) stream
  contract; HTTPS artwork remains required. Invalid commands have no effect. `VOLUME` retains the old receiver capability
  only when `context.setSystemVolume` actually exists; modern CAF has no public
  receiver-side system-volume setter. The standard sender CastSession volume
  API is the supported path. Do not replace it with HTML media/stream volume. Standard Cast
  sender, voice and remote transport remain CAF responsibilities.
- Cosmetic metadata is bounded and written as `textContent`. Artwork accepts
  HTTPS URLs without credentials. Missing or HTTP artwork uses the brand mark;
  the radio stream URL is passed through unchanged.
- Station generation checks prevent late artwork/old-station metadata from
  replacing a newly requested station. Genuine idle clears old artwork; a CAF
  failure remains visible until a new LOAD.
- Status copy currently follows receiver device language for English, Turkish
  and German, with English fallback. Sender currently supplies no UI locale.

## Required before physical acceptance

1. Review this source in a browser at 1920×1080 and 1280×720. Browser rendering is
   not a Cast hardware test; CAF needs an actual receiver session.
2. Deploy these files through the existing web release flow to the exact
   registered HTTPS URL. Verify all CSS/JS/font/SVG responses and account for
   cached HTML. Avoid auth redirects or a Cast-incompatible CSP. The existing
   web serving headers were not broadened by this change.
3. Rebuild Android after the manifest update. No iOS build is needed for this
   Android-only sender setting.
4. Test audible MP3/AAC/HLS, load A→B, pause/resume/stop, remote volume, artwork
   failure, disconnect/reconnect and actual live metadata on real Cast hardware.
   Preserve sender acknowledgement-before-local-pause behavior. As the receiver
   is already published, no unpublished test-device registration is required.

Stream/provider HTTPS, CORS and codec support still apply to CAF. This UI does
not repair unsupported streams or bypass provider policies. Offline tests use
mock CAF and do not establish receiver sound or production hosting readiness.

## Checks

```sh
node --test artifacts/megaradio/tests/cast-receiver.test.cjs
```

Primary references checked 2026-11-24:

- [Receiver choices / Default UI limits](https://developers.google.com/cast/docs/web_receiver)
- [Custom UI, PlayerDataBinder, media element and TV safe area](https://developers.google.com/cast/docs/web_receiver/customize_ui)
- [CAF lifecycle / LOAD handling](https://developers.google.com/cast/docs/web_receiver/core_features)
- [Registration, HTTPS and unpublished test devices](https://developers.google.com/cast/docs/registration)
