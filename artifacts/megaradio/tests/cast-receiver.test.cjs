const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The web workspace is ESM; execute the exact browser UMD files without changing
// their public .js URLs or maintaining a duplicate test implementation.
function loadReceiverFile(filename) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/cast-receiver', filename), 'utf8'), { module, exports: module.exports, URL });
  return module.exports;
}
const model = loadReceiverFile('receiver-model.js');
const copy = loadReceiverFile('receiver-copy.js');
const metadataFeed = loadReceiverFile('receiver-metadata.js');
const startReceiver = loadReceiverFile('receiver.js');

function harness(language = 'tr-TR', withSdk = true, capabilities = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, removeAttribute(key) { delete this[key]; } });
    return elements.get(id);
  };
  let media = null, playerState = 'IDLE', starts = 0, now = 1700000000000, nextTimer = 0;
  const timers = new Map(), documentEvents = {}, windowEvents = {}, motion = { matches: false, addEventListener(type, fn) { this[type] = fn; } };
  const handlers = {}, interceptors = {}, images = [];
  const calls = [];
  let binding, customListener;
  const player = {
    getMediaInformation: () => media,
    getPlayerState: () => playerState,
    setMessageInterceptor: (type, listener) => { interceptors[type] = listener; },
    addEventListener: (type, listener) => { handlers[type] = listener; },
    load: request => { calls.push(['load', request]); return Promise.resolve(); },
    stop: () => calls.push(['stop']), pause: () => calls.push(['pause']), play: () => calls.push(['play']),
    setMediaInformation: (value, broadcast) => { calls.push(['metadata', value, broadcast]); media = value; handlers.media(); }
  };
  const context = { getPlayerManager: () => player, start(...args) { assert.deepEqual(args, []); starts++; },
    addCustomMessageListener(namespace, listener) { assert.equal(namespace, 'urn:x-cast:com.visiongo.megaradio'); customListener = listener; },
    getSender: id => id === 'connected-sender' ? {} : null,
    setSystemVolume: value => calls.push(['volume', value])
  };
  const root = {
    MegaReceiverModel: model,
    MegaReceiverCopy: copy,
    navigator: { language },
    document: { hidden: false, body: { dataset: {} }, documentElement: {}, getElementById: element, addEventListener(type, fn) { documentEvents[type] = fn; } },
    Date: { now: () => now },
    matchMedia: () => motion,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { windowEvents[type] = fn; },
    Image: class { constructor() { images.push(this); } },
    cast: withSdk ? { framework: {
      CastReceiverContext: { getInstance: () => context },
      messages: { MessageType: { LOAD: 'load' } },
      events: { EventType: { MEDIA_INFORMATION_CHANGED: 'media', ERROR: 'error', MEDIA_STATUS: 'status', PLAYER_LOAD_COMPLETE: 'complete' }, DetailedErrorCode: { LOAD_INTERRUPTED: 905 } },
      ui: {
        PlayerDataBinder: class { constructor() { binding = this; } addEventListener(type, fn) { this[type] = fn; } },
        PlayerDataEventType: { STATE_CHANGED: 'state' }
      }
    } } : undefined
  };
  Object.assign(root, capabilities);
  const controller = startReceiver(root);
  return {
    root, elements, images, controller, calls, timers,
    get now() { return now; },
    get starts() { return starts; },
    load(value) { return interceptors.load(value); },
    media(value, state = playerState) { media = value; playerState = state; handlers.media(); },
    state(value) { playerState = value; binding.state({ value }); },
    error(value = {}) { handlers.error(value); },
    status(value) { handlers.status({ mediaStatus: value }); },
    complete(value) { handlers.complete({ media: value }); },
    actualState(value) { playerState = value; },
    staleState(value) { binding.state({ value }); },
    advance(ms) { now += ms; for (let i = 0; i < 256; i++) { const due = [...timers].find(([, t]) => t.at <= now); if (!due) break; timers.delete(due[0]); due[1].fn(); } },
    hidden(value) { root.document.hidden = value; documentEvents.visibilitychange(); },
    reduced(value) { motion.matches = value; motion.change(); },
    pagehide() { windowEvents.pagehide(); },
    custom(data, senderId = 'connected-sender') { customListener({ data, senderId }); }
  };
}
function station(id = 'one', extra = {}) {
  return { contentId: `https://stream.example/${id}`, streamType: 'LIVE', customData: { stationName: 'Baba Radyo' }, metadata: { title: 'Baba Radyo', artist: 'Baba Radyo', albumTitle: 'MegaRadio', images: [{ url: `https://logos.example/${id}.png` }] }, ...extra };
}

test('existing sender metadata shows one station name; actual song is retained separately', () => {
  assert.deepEqual({ ...model.presentation(station()) }, { station: 'Baba Radyo', track: '', artwork: 'https://logos.example/one.png' });
  assert.equal(model.presentation(station('song', { metadata: { title: 'Bir Şarkı', artist: 'Bir Sanatçı' } })).track, 'Bir Şarkı · Bir Sanatçı');
  assert.equal(model.presentation({ metadata: { title: 'Solo Radio', artist: 'Solo Radio' } }).station, 'Solo Radio');
  assert.equal(model.presentation({ metadata: { title: 'baba-radyo', artist: 'BABA RADYO' }, customData: { stationName: 'Baba Radyo' } }).track, '');
  assert.deepEqual({ ...model.presentation(null) }, { station: 'MegaRadio', track: '', artwork: '' });
});

test('oversized/hostile presentation fields are bounded without mutating sender payload', () => {
  const media = station('one', { metadata: { title: 'x'.repeat(90000), artist: '\u0000some\nartist', images: [{ url: 'javascript:alert(1)' }, { url: 'https://example.com/logo.png' }] } });
  const original = structuredClone(media);
  const result = model.presentation(media);
  assert.equal(result.track.length <= 323, true);
  assert.equal(result.track.includes('\u0000'), false);
  assert.equal(result.artwork, 'https://example.com/logo.png');
  assert.deepEqual(media, original);
  for (const value of ['http://example.com/a.png', 'data:image/svg+xml,test', 'file:///a.png', 'https://user:pass@example.com/a.png', 'https://example.com/' + 'x'.repeat(2050)]) assert.equal(model.artworkUrl(value), '');
});

test('CAF starts once and receives the exact standard LOAD including URL, credentials and queue', () => {
  const h = harness();
  const request = { media: station(), autoplay: true, credentials: 'opaque-test-only', queueData: { items: [] } };
  const before = structuredClone(request);
  assert.equal(h.starts, 1);
  assert.equal(h.load(request), request);
  assert.deepEqual(request, before);
  assert.equal(h.root.document.body.dataset.state, 'loading');
  const malformed = {};
  assert.equal(h.load(malformed), malformed); // CAF retains its own validation.
});

test('state, same-station metadata refresh, pause, and true idle follow CAF; idle removes old artwork', () => {
  const h = harness();
  const media = station(); h.load({ media }); h.media(media, 'PLAYING');
  assert.equal(h.root.document.body.dataset.state, 'playing');
  h.images[0].onload(); assert.equal(h.elements.get('station-art').hidden, false);
  h.media({ ...media, metadata: { ...media.metadata, title: 'New song', artist: 'Artist' } }, 'PLAYING');
  assert.equal(h.elements.get('track-name').textContent, 'New song · Artist');
  h.state('PAUSED'); assert.equal(h.root.document.body.dataset.state, 'paused');
  h.state('IDLE');
  assert.equal(h.elements.get('station-name').textContent, 'MegaRadio');
  assert.equal(h.elements.get('station-art').hidden, true);
  assert.equal(h.elements.get('backdrop-art').src, undefined);
});

test('A → B → A image callbacks cannot poison the current source generation', () => {
  const h = harness(), a = station('a'), b = station('b');
  h.load({ media: a }); h.load({ media: b }); h.load({ media: a });
  h.images[0].onload(); assert.equal(h.elements.get('station-art').hidden, true);
  h.images[2].onload(); assert.equal(h.elements.get('station-art').src, 'https://logos.example/a.png');
  h.images[0].onerror(); h.images[1].onload();
  assert.equal(h.elements.get('station-art').src, 'https://logos.example/a.png');
  assert.equal(h.elements.get('station-art').hidden, false);
});

test('previous-station metadata/state/error cannot replace a pending station; real error remains readable', () => {
  const h = harness(), a = station('a'), b = station('b', { customData: { stationName: 'Second Radio' } });
  h.load({ media: a }); h.media(a, 'PLAYING'); h.load({ media: b });
  h.media(a, 'PLAYING'); h.state('IDLE'); h.error();
  assert.equal(h.elements.get('station-name').textContent, 'Second Radio');
  assert.equal(h.root.document.body.dataset.state, 'loading');
  h.media(b, 'PLAYING'); h.actualState('IDLE'); h.error(); h.state('IDLE');
  assert.equal(h.root.document.body.dataset.state, 'error');
  h.load({ media: a }); assert.equal(h.root.document.body.dataset.state, 'loading');
});

test('image failure remains a local visual fallback; no recursive load or playback mutation', () => {
  const h = harness(), media = station();
  h.load({ media }); h.images[0].onerror();
  assert.equal(h.elements.get('fallback-art').hidden, false);
  assert.equal(h.images.length, 1);
  assert.equal(media.contentId, 'https://stream.example/one');
  const missingSdk = harness('en-US', false);
  assert.equal(missingSdk.controller, null);
  assert.equal(missingSdk.root.document.body.dataset.state, 'error');
});

test('static document has one unmuted CAF media element, existing brand assets and no palette CORS dependency', () => {
  const folder = path.join(__dirname, '../public/cast-receiver');
  const html = fs.readFileSync(path.join(folder, 'index.html'), 'utf8');
  assert.equal((html.match(/<video\b/g) || []).length, 1);
  assert.match(html, /class="castMediaElement"/);
  assert.doesNotMatch(html, /\bmuted\b(?=[^<]*>)/);
  assert.match(html, /https:\/\/www\.gstatic\.com\/cast\/sdk\/libs\/caf_receiver\/v3\/cast_receiver_framework\.js/);
  for (const asset of html.matchAll(/(?:src|href)="([^":]+)"/g)) assert.equal(fs.existsSync(path.join(folder, asset[1].split(/[?#]/)[0])), true, asset[1]);
  const css = fs.readFileSync(path.join(folder, 'receiver.css'), 'utf8');
  assert.match(css, /inset: 10%/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(fs.readFileSync(path.join(folder, 'receiver.js'), 'utf8'), /getImageData|createElement\(['"]canvas|\.muted\s*=|fetch\(/);
});

test('published legacy namespace keeps LOAD and transport for a connected sender through CAF only', () => {
  const h = harness();
  h.custom({ type: 'LOAD', streamUrl: 'https://radio.example/live.m3u8', stationName: 'Legacy Radio', imageUrl: 'https://logo.example/r.png' });
  const request = h.calls[0][1];
  assert.equal(h.calls[0][0], 'load');
  assert.equal(request.media.contentId, 'https://radio.example/live.m3u8');
  assert.equal(request.media.contentUrl, request.media.contentId);
  assert.equal(request.media.contentType, 'application/x-mpegURL');
  assert.equal(request.media.streamType, 'LIVE');
  assert.equal(request.media.customData.stationName, 'Legacy Radio');
  assert.equal(request.autoplay, true);
  assert.equal(h.elements.get('station-name').textContent, 'Legacy Radio');
  for (const type of ['STOP', 'PAUSE', 'RESUME']) h.custom({ type });
  h.custom({ type: 'VOLUME', volume: 27 });
  assert.deepEqual(h.calls.slice(1).map(row => row[0]), ['stop', 'pause', 'play', 'volume']);
  assert.equal(h.calls[4][1].level, .27);
});

test('legacy commands reject unknown, oversized, non-finite and disconnected input without playback side effects', () => {
  const h = harness();
  for (const data of [null, [], 'LOAD', { type: 'SEEK' }, { type: 'STOP', extra: 1 }, { type: 'VOLUME', volume: NaN }, { type: 'VOLUME', volume: Infinity }, { type: 'VOLUME', volume: -1 }, { type: 'VOLUME', volume: 101 }, { type: 'VOLUME', volume: '20' }, { type: 'LOAD', streamUrl: 'javascript:alert(1)' }, { type: 'LOAD', streamUrl: 'file:///local' }, { type: 'LOAD', streamUrl: 'https://user:secret@radio.example/live' }, { type: 'LOAD', streamUrl: 'https://radio.example/live\n' }, { type: 'LOAD', streamUrl: 'https://radio.example/' + 'x'.repeat(4096) }, { type: 'LOAD', streamUrl: 'https://radio.example/live', stationName: 'x'.repeat(161) }, { type: 'LOAD', streamUrl: 'https://radio.example/live', credential: 'unexpected' }]) h.custom(data);
  h.custom({ type: 'STOP' }, 'disconnected');
  assert.equal(h.calls.length, 0);
});

test('legacy radio MIME and existing HTTP stream contract remain compatible without insecure artwork', () => {
  for (const [url, mime] of [['https://r.example/live.aac', 'audio/aac'], ['https://r.example/live.ogg', 'audio/ogg'], ['http://r.example/live', 'audio/mpeg'], ['https://hls.example/live', 'application/x-mpegURL']]) {
    const command = model.legacyCommand({ type: 'LOAD', streamUrl: url, imageUrl: 'http://logo.example/a.png' });
    assert.equal(command.request.media.contentType, mime);
    assert.equal(command.request.media.contentUrl, url);
    assert.equal(command.request.media.metadata.images.length, 0);
  }
  for (const volume of [0, 100]) assert.equal(model.legacyCommand({ type: 'VOLUME', volume }).level, volume / 100);
});

test('legacy volume capability missing in modern CAF never changes stream volume or crashes controls', () => {
  const h = harness();
  delete h.controller.context.setSystemVolume;
  assert.doesNotThrow(() => h.custom({ type: 'VOLUME', volume: 50 }));
  assert.equal(h.calls.length, 0);
  h.custom({ type: 'PAUSE' });
  assert.equal(h.calls[0][0], 'pause');
});

test('an old legacy load failure cannot poison a later A → B → A session', async () => {
  const h = harness(); let rejectFirst;
  h.controller.player.load = () => new Promise((_, reject) => { rejectFirst = reject; });
  h.custom({ type: 'LOAD', streamUrl: 'https://radio.example/a', stationName: 'A' });
  h.load({ media: station('b') });
  h.load({ media: { contentId: 'https://radio.example/a', metadata: { title: 'A' } } });
  rejectFirst(new Error('old load failed'));
  await Promise.resolve();
  assert.equal(h.root.document.body.dataset.state, 'loading');
  assert.equal(h.elements.get('station-name').textContent, 'A');
});

function intentStation(h, id, sequence, extra = {}) {
  return station(id, { metadata: { title: 'Radio ' + id, images: [{ url: `https://logos.example/${id}.png` }] }, customData: {
    stationId: id, stationName: 'Radio ' + id, castOwnerId: 'owner-main', castIntentId: 'intent-' + sequence, castSequence: sequence,
    metadataSequence: 1, language: 'tr', genres: ['rock'], genre: 'Rock', country: 'Türkiye', nowPlaying: null, ...extra
  } });
}
function metadataFor(media, sequence, nowPlaying, extra = {}) {
  const c = media.customData;
  return { type: 'METADATA', stationId: c.stationId, castIntentId: c.castIntentId, castSequence: c.castSequence,
    metadataSequence: sequence, nowPlaying, playbackState: 'playing', ...extra };
}

test('all14 app languages have complete short receiver state copy and RTL follows sender language', () => {
  assert.deepEqual([...copy.languages].sort(), ['en','tr','de','fr','es','it','pt','hi','he','ru','ja','ko','zh','ar'].sort());
  for (const locale of copy.languages) for (const key of ['idle','loading','buffering','playing','paused','error']) assert.ok(copy.forLanguage(locale)[key]?.trim(), `${locale}/${key}`);
  assert.equal(copy.locale('iw-IL'), 'he'); assert.equal(copy.locale('xx'), 'en');
  const h = harness('en'); const media = intentStation(h, 'a', 1, { language: 'ar' });
  h.load({ media }); h.media(media, 'PLAYING');
  assert.equal(h.root.document.documentElement.lang, 'ar'); assert.equal(h.root.document.documentElement.dir, 'rtl');
  assert.equal(h.elements.get('playback-state').textContent, copy.forLanguage('ar').playing);
});

test('new pending station survives old IDLE/status/loadcomplete even when CAF already exposes the new media', () => {
  const h = harness(), a = intentStation(h, 'a', 1), b = intentStation(h, 'b', 2);
  h.load({ media: a }); h.media(a, 'PLAYING'); h.load({ media: b }); h.media(b, 'IDLE');
  h.state('IDLE'); h.status({ media: a, playerState: 'IDLE' }); h.complete(a); h.error({ detailedErrorCode: 905 });
  assert.equal(h.elements.get('station-name').textContent, 'Radio b'); assert.equal(h.root.document.body.dataset.state, 'loading');
  h.actualState('BUFFERING'); h.complete(b); assert.equal(h.root.document.body.dataset.state, 'buffering');
  h.state('PLAYING'); h.staleState('IDLE'); h.status({ media: b, playerState: 'IDLE' });
  assert.equal(h.root.document.body.dataset.state, 'playing'); assert.equal(h.elements.get('station-name').textContent, 'Radio b');
  h.actualState('IDLE'); h.status({ media: b, playerState: 'IDLE', idleReason: 'ERROR' });
  assert.equal(h.root.document.body.dataset.state, 'error');
});

test('retired LOAD replay is cancelled but a fresh A → B → A intent is accepted', () => {
  const h = harness(), a1 = intentStation(h, 'a', 1), b2 = intentStation(h, 'b', 2), a3 = intentStation(h, 'a', 3);
  h.load({ media: a1 }); h.load({ media: b2 });
  assert.equal(h.load({ media: a1 }), null); assert.equal(h.elements.get('station-name').textContent, 'Radio b');
  const request = { media: a3 }; assert.equal(h.load(request), request);
  h.custom(metadataFor(a1, 9, { title: 'Stale song', observedAt: h.now, expiresAt: h.now + 120000 }));
  assert.equal(h.elements.get('track-name').textContent, 'Rock');
});

test('same-owner unseen delayed LOAD is rejected after a newer sequence; another phone and later reconnect remain valid', () => {
  const h = harness(), unseenA = intentStation(h, 'a', 1), b = intentStation(h, 'b', 2);
  h.load({ media: b }); h.media(b, 'PLAYING');
  assert.equal(h.load({ media: unseenA }), null, 'seq1 was never accepted but is older than this owner seq2');
  assert.equal(h.elements.get('station-name').textContent, 'Radio b'); assert.equal(h.root.document.body.dataset.state, 'playing');
  const phone2 = intentStation(h, 'c', 1, { castOwnerId: 'second-phone', castIntentId: 'second-phone-intent-1' });
  const second = { media: phone2 }; assert.equal(h.load(second), second, 'sequence is not global between phones');
  const reconnect = { media: intentStation(h, 'd', 3) }; assert.equal(h.load(reconnect), reconnect);
  const invalid = { media: intentStation(h, 'e', 4, { castOwnerId: 'bad owner value' }) }; assert.equal(h.load(invalid), null);
  const legacy = { media: station('legacy') }; assert.equal(h.load(legacy), legacy, 'pre-owner senders remain supported');
});

test('generic old-player ERROR cannot poison a healthy current radio; actual current failed LOAD still surfaces', () => {
  const h = harness(), a = intentStation(h, 'a', 1), b = intentStation(h, 'b', 2);
  h.load({ media: a }); h.media(a, 'PLAYING'); h.load({ media: b }); h.media(b, 'PLAYING');
  h.error({ detailedErrorCode: 999 });
  assert.equal(h.root.document.body.dataset.state, 'playing'); assert.equal(h.elements.get('station-name').textContent, 'Radio b');
  h.state('PAUSED'); h.error({ detailedErrorCode: 999 }); assert.equal(h.root.document.body.dataset.state, 'paused');
  h.actualState('IDLE'); h.error({ detailedErrorCode: 999 }); assert.equal(h.root.document.body.dataset.state, 'error');
});

test('metadata-only updates are intent/sequence scoped, preserve stream and CAF transport state, and do not reload', () => {
  const h = harness(), a = intentStation(h, 'a', 1);
  h.load({ media: a }); h.media(a, 'PLAYING');
  const song = { title: 'A song', artist: 'An artist', observedAt: h.now - 1000, expiresAt: h.now + 119000 };
  h.custom(metadataFor(a, 2, song, { playbackState: 'paused' }));
  assert.equal(h.elements.get('track-name').textContent, 'An artist - A song');
  assert.equal(h.root.document.body.dataset.state, 'playing', 'sender/local pause cannot override actual CAF');
  assert.equal(h.calls.filter(c => c[0] === 'load').length, 0);
  assert.equal(h.calls.filter(c => c[0] === 'metadata').length, 1);
  assert.equal(h.calls[0][1].contentId, a.contentId); assert.equal(h.calls[0][2], true);
  h.custom(metadataFor(a, 1, null)); h.custom(metadataFor(a, 3, null, { castIntentId: 'old-intent' }));
  assert.equal(h.elements.get('track-name').textContent, 'An artist - A song');
  h.custom(metadataFor(a, 3, null)); assert.equal(h.elements.get('track-name').textContent, 'Rock');
  h.custom(metadataFor(a, 2, song)); h.media(a, 'PLAYING');
  assert.equal(h.elements.get('track-name').textContent, 'Rock', 'old same-intent cache cannot revive cleared track');
});

test('pending metadata waits for matching CAF load completion; old station playback is never patched', () => {
  const h = harness(), a = intentStation(h, 'a', 1), b = intentStation(h, 'b', 2);
  h.load({ media: a }); h.media(a, 'PLAYING'); h.load({ media: b });
  const song = { title: 'B song', observedAt: h.now, expiresAt: h.now + 120000 };
  h.custom(metadataFor(b, 2, song)); assert.equal(h.calls.filter(c => c[0] === 'metadata').length, 0);
  h.media(b, 'IDLE'); h.actualState('PLAYING'); h.complete(b);
  assert.equal(h.calls.filter(c => c[0] === 'metadata').length, 1);
  assert.equal(h.calls[0][1].customData.stationId, 'b'); assert.equal(h.elements.get('track-name').textContent, 'B song');
});

test('fresh song10s/context4s rhythm and fallback rotation survive frequent status updates without polling', () => {
  const h = harness(), media = intentStation(h, 'a', 1, { nowPlaying: { title: 'Song', observedAt: h.now, expiresAt: h.now + 120000 } });
  h.load({ media }); h.media(media, 'PLAYING'); assert.equal(h.elements.get('track-name').textContent, 'Song');
  h.advance(9900); h.status({ media, playerState: 'PLAYING' }); h.advance(100);
  assert.equal(h.elements.get('track-name').textContent, 'Rock'); h.advance(4000); assert.equal(h.elements.get('track-name').textContent, 'Türkiye');
  h.advance(120000); assert.notEqual(h.elements.get('track-name').textContent, 'Song'); assert.ok(h.timers.size <= 1);
  h.advance(3900); h.status({ media, playerState: 'PLAYING' }); const previous = h.elements.get('track-name').textContent; h.advance(100);
  assert.notEqual(h.elements.get('track-name').textContent, previous, 'repeated SDK status does not restart the rotation clock');
});

test('metadata expiry/background/reduced-motion lifecycle leaves at most two timers and no hidden rotation', () => {
  const h = harness(), media = intentStation(h, 'a', 1, { nowPlaying: { title: 'Song', observedAt: h.now, expiresAt: h.now + 120000 } });
  h.load({ media }); h.media(media, 'PLAYING'); h.reduced(true); assert.equal(h.timers.size, 1);
  h.advance(20000); assert.equal(h.elements.get('track-name').textContent, 'Song');
  h.hidden(true); assert.equal(h.timers.size, 0); h.advance(120000); h.hidden(false);
  assert.equal(h.elements.get('track-name').textContent, 'Rock'); assert.equal(h.timers.size, 0);
  h.reduced(false); assert.equal(h.timers.size, 1); h.pagehide(); assert.equal(h.timers.size, 0);
});

test('freshness rejects station placeholders, future/expired or fabricated long TTL tracks and malformed metadata', () => {
  const h = harness();
  for (const nowPlaying of [{ title: 'Song', observedAt: h.now - 130000, expiresAt: h.now - 10000 }, { title: 'Song', observedAt: h.now + 10000, expiresAt: h.now + 120000 }, { title: 'Song', observedAt: h.now, expiresAt: h.now + 120001 }, { title: 'Radio a', observedAt: h.now, expiresAt: h.now + 120000 }]) {
    const media = intentStation(h, 'a', 1, { nowPlaying }); assert.equal(model.presentation(media, h.now).track, '');
  }
  const media = intentStation(h, 'a', 1); h.load({ media }); h.media(media, 'PLAYING');
  for (const value of [metadataFor(media, 2, { title: 'x'.repeat(161), observedAt: h.now, expiresAt: h.now + 120000 }), metadataFor(media, 2, null, { metadataSequence: NaN }), metadataFor(media, 2, null, { extra: 'not allowed' })]) h.custom(value);
  assert.equal(h.calls.length, 0);
});

test('only changed same-intent CAF stream metadata is observed; repeating events never extend its120s clock', () => {
  const h = harness(), media = intentStation(h, 'a', 1); h.load({ media }); h.media(media, 'PLAYING'); h.reduced(true);
  const remote = { ...media, metadata: { ...media.metadata, title: 'Remote song', artist: 'Remote artist' } };
  h.media(remote, 'PLAYING'); assert.equal(h.elements.get('track-name').textContent, 'Remote artist - Remote song');
  h.advance(60000); h.media(remote, 'PLAYING'); h.advance(60001);
  assert.equal(h.elements.get('track-name').textContent, 'Rock');
  h.media(intentStation(h, 'other', 0), 'PLAYING'); assert.equal(h.elements.get('station-name').textContent, 'Radio a');
});

const flush = () => new Promise(resolve => setImmediate(resolve));
function feedFixture() {
  let now = 1700000000000, id = 0;
  const timers = new Map(), requests = [], data = [];
  const feed = metadataFeed.create({ AbortController, TextDecoder, now: () => now,
    setTimeout(fn, delay) { const key = ++id; timers.set(key, { fn, at: now + delay }); return key; },
    clearTimeout(key) { timers.delete(key); },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
    onData: (value, owner) => data.push({ value, owner })
  });
  return { feed, timers, requests, data, get now() { return now; },
    advance(ms) { now += ms; for (let i = 0; i < 64; i++) { const due = [...timers].find(([, t]) => t.at <= now); if (!due) break; timers.delete(due[0]); due[1].fn(); } },
    resolve(index, value, status = 200, length = null) { requests[index].resolve({ ok: status === 200, headers: { get: () => length }, text: async () => JSON.stringify(value) }); }
  };
}

test('receiver public feed is singleflight, fixed HTTPS/no credentials, idempotent and stopped on pause', async () => {
  const f = feedFixture(); f.feed.setOwner('station-a', 1, true); f.feed.setOwner('station-a', 1, true); await flush();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, 'https://api.themegaradio.com/api/now-playing/station-a');
  assert.equal(f.requests[0].options.credentials, 'omit'); assert.equal(f.requests[0].options.mode, 'cors');
  f.feed.setOwner('station-a', 1, false); assert.equal(f.requests[0].options.signal.aborted, true);
  f.resolve(0, { title: 'Late song', observedAt: f.now }); await flush(); assert.equal(f.data.length, 0);
  f.feed.setOwner('station-a', 1, true); await flush(); assert.equal(f.requests.length, 1);
  f.advance(60000); await flush(); assert.equal(f.requests.length, 2); f.feed.dispose(); assert.equal(f.timers.size, 0);
});

test('station generation cancels old reads and late response cannot affect the next radio', async () => {
  const f = feedFixture(); f.feed.setOwner('a', 1, true); await flush(); f.feed.setOwner('b', 2, true); await flush();
  assert.equal(f.requests[0].options.signal.aborted, true); assert.equal(f.requests.length, 2);
  f.resolve(0, { title: 'Old song', observedAt: f.now }); f.resolve(1, { title: 'Current song', observedAt: f.now }); await flush();
  assert.equal(f.data.length, 1); assert.equal(f.data[0].owner, 'b:2');
  f.feed.setOwner('../../bad', 3, true); await flush(); assert.equal(f.requests.length, 2); assert.equal(f.timers.size, 0);
});

test('hung metadata aborts at9s with bounded backoff even if fetch ignores abort; no overlapping active requests', async () => {
  const f = feedFixture(); f.feed.setOwner('a', 1, true); await flush(); f.advance(9000);
  assert.equal(f.requests[0].options.signal.aborted, true); f.advance(110999); await flush(); assert.equal(f.requests.length, 1);
  f.advance(1); await flush(); assert.equal(f.requests.length, 2);
  assert.equal(f.requests.filter(r => !r.options.signal.aborted).length, 1); f.feed.dispose(); assert.equal(f.timers.size, 0);
});

test('public track uses actual observedAt, never fetch time/titleChangedAt and keeps a long unchanged song only on a fresh observation', async () => {
  const f = feedFixture(), observedAt = f.now - 1000;
  const body = { title: 'Artist - Song', artist: 'Artist', observedAt, titleChangedAt: observedAt - 600000 };
  f.feed.setOwner('a', 1, true); await flush(); f.resolve(0, body); await flush(); f.advance(60000); await flush(); f.resolve(1, body); await flush();
  assert.equal(f.data[0].value.observedAt, f.data[1].value.observedAt);
  const first = model.publicTrack(body, 'Radio a', 'Country', f.now); assert.equal(first.title, 'Song'); assert.equal(first.expiresAt, observedAt + 120000);
  f.advance(60000); assert.equal(model.publicTrack(body, 'Radio a', 'Country', f.now), null);
  assert.ok(model.publicTrack({ ...body, observedAt: f.now }, 'Radio a', 'Country', f.now));
  assert.equal(model.publicTrack({ title: 'Song', titleChangedAt: f.now }, 'Radio a', 'Country', f.now), null);
  assert.equal(model.publicTrack({ title: '<html>gateway</html>', observedAt: f.now }, 'Radio a', 'Country', f.now), null); f.feed.dispose();
  assert.equal(model.publicTrack({ title: '&lt;html&gt;gateway&lt;/html&gt;', observedAt: f.now }, 'Radio a', 'Country', f.now), null);
  assert.equal(model.publicTrack({ title: 'Live', artist: 'Real artist', observedAt: f.now }, 'Radio a', 'Country', f.now).title, 'Live');
});

test('metadata HTTP failure and oversized body back off without exposing server diagnostics or renewing a track', async () => {
  const f = feedFixture(); f.feed.setOwner('a', 1, true); await flush(); f.resolve(0, { error: 'server' }, 503); await flush();
  assert.equal(f.data.length, 0); f.advance(120000); await flush(); f.resolve(1, { title: 'x' }, 200, '65537'); await flush();
  assert.equal(f.data.length, 0); assert.equal(f.requests.length, 2); assert.ok(f.timers.size <= 1); f.feed.dispose();
});

test('streamed metadata response is cancelled at64KiB even without a content-length header', async () => {
  const f = feedFixture(); let cancelled = false, chunk = 0;
  f.feed.setOwner('a', 1, true); await flush();
  f.requests[0].resolve({ ok: true, headers: { get: () => null }, body: { getReader: () => ({
    read: async () => ({ done: false, value: new Uint8Array(++chunk === 1 ? 40000 : 30000) }),
    cancel: async () => { cancelled = true; }
  }) } });
  await flush(); assert.equal(cancelled, true); assert.equal(chunk, 2); assert.equal(f.data.length, 0); f.feed.dispose();
});

test('actual receiver owns its60s feed through sender/background absence and metadata never reloads or cuts media', async () => {
  let h, requests = 0;
  h = harness('tr', true, { MegaReceiverMetadata: metadataFeed, AbortController,
    fetch: async () => { requests++; return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ title: 'Song', artist: 'Artist', observedAt: h.now, titleChangedAt: h.now - 600000 }) }; }
  });
  const media = intentStation(h, 'a', 1); h.load({ media }); h.media(media, 'PLAYING'); await flush();
  assert.equal(requests, 1); assert.equal(h.elements.get('track-name').textContent, 'Artist - Song');
  assert.equal(h.calls.filter(c => c[0] === 'load').length, 0);
  const receiverObservation = h.calls.find(c => c[0] === 'metadata')[1].customData.nowPlaying;
  h.custom(metadataFor(media, 2, receiverObservation)); h.custom(metadataFor(media, 3, null));
  assert.equal(h.elements.get('track-name').textContent, 'Artist - Song', 'sender mirror/null cannot erase receiver-owned fresh observation');
  h.hidden(true); h.advance(60000); await flush(); assert.equal(requests, 2, 'receiver read is independent of phone foreground');
  h.state('PAUSED'); h.advance(60000); await flush(); assert.equal(requests, 2); h.pagehide(); assert.equal(h.timers.size, 0);
});
