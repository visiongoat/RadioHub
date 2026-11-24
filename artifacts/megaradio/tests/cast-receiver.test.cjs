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
const startReceiver = loadReceiverFile('receiver.js');

function harness(language = 'tr-TR', withSdk = true) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, removeAttribute(key) { delete this[key]; } });
    return elements.get(id);
  };
  let media = null, playerState = 'IDLE', starts = 0;
  const handlers = {}, interceptors = {}, images = [];
  const calls = [];
  let binding, customListener;
  const player = {
    getMediaInformation: () => media,
    getPlayerState: () => playerState,
    setMessageInterceptor: (type, listener) => { interceptors[type] = listener; },
    addEventListener: (type, listener) => { handlers[type] = listener; },
    load: request => { calls.push(['load', request]); return Promise.resolve(); },
    stop: () => calls.push(['stop']), pause: () => calls.push(['pause']), play: () => calls.push(['play'])
  };
  const context = { getPlayerManager: () => player, start(...args) { assert.deepEqual(args, []); starts++; },
    addCustomMessageListener(namespace, listener) { assert.equal(namespace, 'urn:x-cast:com.visiongo.megaradio'); customListener = listener; },
    getSender: id => id === 'connected-sender' ? {} : null,
    setSystemVolume: value => calls.push(['volume', value])
  };
  const root = {
    MegaReceiverModel: model,
    navigator: { language },
    document: { body: { dataset: {} }, documentElement: {}, getElementById: element },
    Image: class { constructor() { images.push(this); } },
    cast: withSdk ? { framework: {
      CastReceiverContext: { getInstance: () => context },
      messages: { MessageType: { LOAD: 'load' } },
      events: { EventType: { MEDIA_INFORMATION_CHANGED: 'media', ERROR: 'error' } },
      ui: {
        PlayerDataBinder: class { constructor() { binding = this; } addEventListener(type, fn) { this[type] = fn; } },
        PlayerDataEventType: { STATE_CHANGED: 'state' }
      }
    } } : undefined
  };
  const controller = startReceiver(root);
  return {
    root, elements, images, controller, calls,
    get starts() { return starts; },
    load(value) { return interceptors.load(value); },
    media(value, state = playerState) { media = value; playerState = state; handlers.media(); },
    state(value) { playerState = value; binding.state({ value }); },
    error() { handlers.error(); },
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
  h.media(b, 'PLAYING'); h.error(); h.state('IDLE');
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
  for (const asset of html.matchAll(/(?:src|href)="([^":]+)"/g)) assert.equal(fs.existsSync(path.join(folder, asset[1])), true, asset[1]);
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
