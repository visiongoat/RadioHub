(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else factory(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function startReceiver(root) {
  'use strict';
  var model = root.MegaReceiverModel, translations = root.MegaReceiverCopy, doc = root.document;
  var art = doc.getElementById('station-art'), backdrop = doc.getElementById('backdrop-art');
  var fallback = doc.getElementById('fallback-art'), name = doc.getElementById('station-name');
  var track = doc.getElementById('track-name'), status = doc.getElementById('playback-state');
  var state = 'idle', expected = null, viewMedia = null, artwork = '', artGeneration = 0, loadGeneration = 0;
  var pending = false, allowResume = true, metadataSequence = 0, metadataFingerprint = '', receiverTrack = null, receiverObservedAt = 0;
  var retiredIntents = [], ownerSequences = [], pendingMetadata = null, subtitleTimer = null, expiryTimer = null;
  var subtitleKey = '', subtitleIndex = 0, language = translations.locale(root.navigator.language);
  var motion = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function clock() { return root.Date ? root.Date.now() : Date.now(); }
  function selectLanguage(value) {
    language = translations.locale(value || root.navigator.language);
    doc.documentElement.lang = language;
    doc.documentElement.dir = language === 'ar' || language === 'he' ? 'rtl' : 'ltr';
  }
  function clearTimers() {
    if (subtitleTimer !== null) root.clearTimeout(subtitleTimer);
    if (expiryTimer !== null) root.clearTimeout(expiryTimer);
    subtitleTimer = null; expiryTimer = null;
  }
  function renderSubtitle() {
    if (expiryTimer !== null) root.clearTimeout(expiryTimer);
    expiryTimer = null;
    if (!viewMedia) { clearTimers(); track.textContent = ''; track.hidden = true; return; }
    var now = clock(), data = model.presentation(viewMedia, now), context = model.contextLabels(viewMedia);
    var entries = data.track ? [data.track].concat(context) : context;
    entries = entries.filter(function (value, index, all) { return value && all.indexOf(value) === index; });
    var key = entries.join('\u0000');
    if (key !== subtitleKey) {
      subtitleKey = key; subtitleIndex = 0;
      if (subtitleTimer !== null) root.clearTimeout(subtitleTimer);
      subtitleTimer = null;
    }
    var reduced = motion && motion.matches;
    if (reduced || subtitleIndex >= entries.length) subtitleIndex = 0;
    track.textContent = entries[subtitleIndex] || ''; track.hidden = !entries.length;
    if (doc.hidden || state !== 'playing' || reduced || entries.length < 2) {
      if (subtitleTimer !== null) root.clearTimeout(subtitleTimer);
      subtitleTimer = null;
    } else if (subtitleTimer === null) {
      subtitleTimer = root.setTimeout(function () { subtitleTimer = null; subtitleIndex = (subtitleIndex + 1) % entries.length; renderSubtitle(); }, data.track && subtitleIndex === 0 ? 10000 : 4000);
    }
    if (doc.hidden) return;
    var custom = viewMedia.customData || {}, fresh = model.freshTrack(custom.nowPlaying, now, data.station);
    if (fresh) expiryTimer = root.setTimeout(function () {
      var value = viewMedia && viewMedia.customData && viewMedia.customData.nowPlaying;
      if (value && value.expiresAt <= clock()) applyMetadata({ nowPlaying: null, metadataSequence: metadataSequence });
      renderSubtitle();
    }, Math.max(1, fresh.expiresAt - now));
  }
  function setState(next) {
    state = next; doc.body.dataset.state = next;
    status.textContent = translations.forLanguage(language)[next] || '';
    renderSubtitle();
    if (metadataFeed) metadataFeed.setOwner(expected && expected.stationId, loadGeneration, next === 'playing');
  }
  function clearArtwork() {
    art.hidden = true; backdrop.hidden = true; fallback.hidden = false;
    art.removeAttribute('src'); backdrop.removeAttribute('src');
  }
  function setArtwork(next) {
    if (next === artwork) return;
    artwork = next; var generation = ++artGeneration;
    clearArtwork(); if (!next) return;
    var candidate = new root.Image(); candidate.referrerPolicy = 'no-referrer';
    candidate.onload = function () {
      if (generation !== artGeneration) return;
      art.src = next; backdrop.src = next; art.hidden = false; backdrop.hidden = false; fallback.hidden = true;
    };
    candidate.onerror = function () { if (generation === artGeneration) clearArtwork(); };
    candidate.src = next;
  }
  function fingerprint(media) {
    var value = media.metadata || {};
    return JSON.stringify([typeof value.title === 'string' ? value.title : '', typeof value.artist === 'string' ? value.artist : '']);
  }
  function showMedia(media) {
    viewMedia = media;
    var custom = media.customData || {};
    selectLanguage(custom.language);
    var data = model.presentation(media, clock());
    name.textContent = data.station; setArtwork(data.artwork); renderSubtitle();
  }
  function retire(intent) {
    if (!intent || retiredIntents.indexOf(intent) >= 0) return;
    retiredIntents.push(intent); if (retiredIntents.length > 64) retiredIntents.shift();
  }
  function clearMedia() {
    if (expected) retire(expected.intentId);
    loadGeneration++; expected = null; viewMedia = null; pending = false; allowResume = false;
    pendingMetadata = null; metadataSequence = 0; receiverTrack = null; receiverObservedAt = 0;
    name.textContent = 'MegaRadio'; subtitleKey = ''; subtitleIndex = 0; setArtwork(''); clearTimers(); renderSubtitle();
  }
  selectLanguage(language); setState('idle');
  if (!root.cast || !root.cast.framework) { setState('error'); return null; }
  var framework = root.cast.framework, events = framework.events.EventType;
  var context = framework.CastReceiverContext.getInstance(), player = context.getPlayerManager();
  var binding = new framework.ui.PlayerDataBinder({});
  // One receiver-owned public feed survives the sender phone going to background.
  // No phone-side Cast polling, account token or stream URL is sent to this API.
  var metadataFeed = root.MegaReceiverMetadata && typeof root.fetch === 'function' && root.AbortController
    ? root.MegaReceiverMetadata.create({ fetch: root.fetch.bind(root), AbortController: root.AbortController,
      TextDecoder: root.TextDecoder, setTimeout: root.setTimeout.bind(root), clearTimeout: root.clearTimeout.bind(root), now: clock,
      onData: function (data, owner) {
        if (!expected || owner !== expected.stationId + ':' + loadGeneration || state !== 'playing' || !viewMedia) return;
        var custom = viewMedia.customData || {}, value = model.publicTrack(data, custom.stationName || '', custom.country || '', clock());
        var previous = custom.nowPlaying;
        if (!value || previous && previous.observedAt > value.observedAt) { renderSubtitle(); return; }
        if (previous && previous.observedAt === value.observedAt && previous.title === value.title && (previous.artist || '') === value.artist) return;
        applyMetadata({ nowPlaying: value, metadataSequence: metadataSequence });
        receiverTrack = value; receiverObservedAt = value.observedAt;
      } }) : null;
  function currentState(fallbackState) {
    var actual = typeof player.getPlayerState === 'function' ? String(player.getPlayerState() || '').toLowerCase() : '';
    return ['idle', 'loading', 'buffering', 'paused', 'playing'].indexOf(actual) >= 0 ? actual : fallbackState;
  }
  function matches(media) { return !!media && !!expected && model.matches(expected, media); }
  function currentMatches() { var media = player.getMediaInformation(); return matches(media) ? media : null; }
  function presentLoad(request) {
    if (!request || !request.media) return request;
    var next = model.identity(request.media);
    var suppliedOwner = (request.media.customData || {}).castOwnerId;
    if (suppliedOwner !== undefined && (!next.ownerId || !next.intentId || !next.sequence)) return null;
    if (next.ownerId) {
      var ownerIndex = ownerSequences.findIndex(function (row) { return row.ownerId === next.ownerId; });
      // A delayed LOAD may never have reached this receiver before. The explicit
      // producer's high-water mark rejects it without comparing other phones.
      if (ownerIndex >= 0 && next.sequence <= ownerSequences[ownerIndex].sequence) return null;
    }
    // Retried old LOADs cannot undo a later user intent. A new phone uses a new
    // intent; do not compare globally increasing counters between different senders.
    if (next.intentId && (retiredIntents.indexOf(next.intentId) >= 0 || expected && next.intentId === expected.intentId)) return null;
    if (next.ownerId) {
      if (ownerIndex >= 0) ownerSequences.splice(ownerIndex, 1);
      ownerSequences.push({ ownerId: next.ownerId, sequence: next.sequence });
      if (ownerSequences.length > 64) ownerSequences.shift();
    }
    if (expected) retire(expected.intentId);
    loadGeneration++; expected = next; pending = true; allowResume = true;
    metadataSequence = model.sequence((request.media.customData || {}).metadataSequence);
    metadataFingerprint = fingerprint(request.media); receiverTrack = null; receiverObservedAt = 0; pendingMetadata = null;
    subtitleKey = ''; subtitleIndex = 0;
    showMedia(request.media); setState('loading');
    return request; // Standard CAF LOAD/URL/credentials/queue remains untouched.
  }
  function withLatestMetadata(media) {
    var custom = Object.assign({}, media.customData || {}), previous = viewMedia && viewMedia.customData || {};
    if (model.sequence(custom.metadataSequence) < metadataSequence) {
      custom.nowPlaying = previous.nowPlaying; custom.metadataSequence = metadataSequence;
    }
    if (receiverObservedAt && (!custom.nowPlaying || custom.nowPlaying.observedAt <= receiverObservedAt)) custom.nowPlaying = receiverTrack;
    return Object.assign({}, media, { customData: custom });
  }
  function adoptMedia(media, nativeMetadataEvent) {
    if (!matches(media)) return;
    var incomingSequence = model.sequence((media.customData || {}).metadataSequence), nextFingerprint = fingerprint(media);
    if (nativeMetadataEvent && incomingSequence >= metadataSequence && nextFingerprint !== metadataFingerprint) {
      // A genuinely changed same-intent CAF stream title is a new observation.
      // Repeated/cached titles and our own setMediaInformation broadcast do not
      // refresh its clock. Station/brand placeholders are never a song.
      var legacy = Object.assign({}, media, { customData: { stationName: (media.customData || {}).stationName } });
      var candidate = model.presentation(legacy), raw = media.metadata || {};
      receiverObservedAt = clock();
      receiverTrack = candidate.track && typeof raw.title === 'string' && !/^(live(?: radio)?|radio|unknown|stream)$/i.test(raw.title.trim())
        ? { title: raw.title.trim().slice(0, 160), artist: typeof raw.artist === 'string' ? raw.artist.trim().slice(0, 160) : '', observedAt: receiverObservedAt, expiresAt: receiverObservedAt + 120000 } : null;
      metadataFingerprint = nextFingerprint;
    }
    showMedia(withLatestMetadata(media));
  }
  function applyMetadata(command) {
    var custom = viewMedia && viewMedia.customData || {};
    var effective = command.nowPlaying;
    if (receiverTrack && model.freshTrack(receiverTrack, clock(), custom.stationName || '')
      && (!effective || receiverTrack.observedAt >= effective.observedAt)) effective = receiverTrack;
    else { receiverTrack = null; receiverObservedAt = 0; }
    var nextCustom = Object.assign({}, custom, { nowPlaying: effective, metadataSequence: command.metadataSequence });
    var base = currentMatches(), baseMetadata = Object.assign({}, (base || viewMedia).metadata || {});
    baseMetadata.title = effective ? effective.title : nextCustom.stationName || 'MegaRadio';
    if (effective && effective.artist) baseMetadata.artist = effective.artist; else delete baseMetadata.artist;
    metadataFingerprint = fingerprint({ metadata: baseMetadata });
    var updated = Object.assign({}, base || viewMedia, { customData: nextCustom, metadata: baseMetadata });
    showMedia(updated);
    if (!base || typeof player.setMediaInformation !== 'function') { pendingMetadata = command; return; }
    pendingMetadata = null;
    // Official CAF metadata-only update: no player.load(), src replacement or audio interruption.
    player.setMediaInformation(updated, true);
  }
  function settle(media, next) {
    if (!matches(media)) return;
    adoptMedia(media, false);
    if (['playing', 'paused', 'buffering'].indexOf(next) >= 0) {
      pending = false; setState(next);
      if (pendingMetadata) applyMetadata(pendingMetadata);
    } else if (next === 'loading') setState('loading');
    else if (next === 'idle' && !pending && state !== 'error') { clearMedia(); setState('idle'); }
  }
  player.setMessageInterceptor(framework.messages.MessageType.LOAD, presentLoad);
  player.addEventListener(events.MEDIA_INFORMATION_CHANGED, function () {
    var media = currentMatches();
    if (media) { adoptMedia(media, true); var next = currentState(''); if (next !== 'idle') settle(viewMedia, next); }
  });
  if (events.PLAYER_LOAD_COMPLETE) player.addEventListener(events.PLAYER_LOAD_COMPLETE, function (event) {
    if (matches(event.media)) {
      pending = false; adoptMedia(event.media, false);
      if (pendingMetadata) applyMetadata(pendingMetadata);
      var next = currentState('buffering'); if (next !== 'idle') setState(next);
    }
  });
  if (events.MEDIA_STATUS) player.addEventListener(events.MEDIA_STATUS, function (event) {
    var value = event.mediaStatus || {}, media = value.media;
    if (!matches(media)) return;
    var next = currentState(String(value.playerState || '').toLowerCase());
    if (String(value.idleReason || '').toUpperCase() === 'ERROR' && next === 'idle') { pending = false; adoptMedia(media, false); setState('error'); return; }
    settle(media, next);
  });
  binding.addEventListener(framework.ui.PlayerDataEventType.STATE_CHANGED, function (event) {
    var media = currentMatches(), next = currentState(String(event.value || '').toLowerCase());
    if (!expected && allowResume && ['playing', 'paused', 'buffering'].indexOf(next) >= 0) {
      media = player.getMediaInformation();
      if (media) { expected = model.identity(media); metadataFingerprint = fingerprint(media); }
    }
    if (!media) return;
    if (pending && next === 'idle') return; // New LOAD unloads the old element first.
    settle(media, next);
  });
  player.addEventListener(events.ERROR, function (event) {
    var interrupted = framework.events.DetailedErrorCode && framework.events.DetailedErrorCode.LOAD_INTERRUPTED;
    if (event && interrupted !== undefined && event.detailedErrorCode === interrupted) return;
    // ERROR has no media identity. A late failure from the replaced player must
    // not mark the current healthy CAF media as failed. Real failures transition
    // to IDLE (also handled by identity-scoped MEDIA_STATUS/idleReason=ERROR).
    var actual = currentState('idle');
    if (actual === 'playing' || actual === 'paused') return;
    if (currentMatches()) { pending = false; setState('error'); }
  });
  context.addCustomMessageListener('urn:x-cast:com.visiongo.megaradio', function (event) {
    if (!event || typeof event.senderId !== 'string' || !context.getSender(event.senderId)) return;
    var metadata = model.metadataCommand(event.data);
    if (metadata) {
      if (!expected || metadata.stationId !== expected.stationId || metadata.castIntentId !== expected.intentId
        || metadata.castSequence !== expected.sequence || metadata.metadataSequence <= metadataSequence) return;
      metadataSequence = metadata.metadataSequence; applyMetadata(metadata); return;
    }
    var command = model.legacyCommand(event.data); if (!command) return;
    try {
      if (command.type === 'LOAD') {
        if (!presentLoad(command.request)) return;
        var generation = loadGeneration;
        Promise.resolve(player.load(command.request)).catch(function () { if (loadGeneration === generation) setState('error'); });
      } else if (command.type === 'STOP') player.stop();
      else if (command.type === 'PAUSE') player.pause();
      else if (command.type === 'RESUME') player.play();
      else if (command.type === 'VOLUME' && typeof context.setSystemVolume === 'function') context.setSystemVolume({ level: command.level, muted: false });
    } catch (_) { if (command.type === 'LOAD') setState('error'); }
  });
  if (doc.addEventListener) doc.addEventListener('visibilitychange', renderSubtitle);
  if (motion && motion.addEventListener) motion.addEventListener('change', renderSubtitle);
  function shutdown() { clearTimers(); if (metadataFeed) metadataFeed.dispose(); }
  if (root.addEventListener) root.addEventListener('pagehide', shutdown);
  if (context.addEventListener && framework.system && framework.system.EventType.SHUTDOWN) context.addEventListener(framework.system.EventType.SHUTDOWN, shutdown);
  context.start();
  return { context: context, player: player, binding: binding };
}));
