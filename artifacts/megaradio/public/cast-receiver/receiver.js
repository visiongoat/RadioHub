(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else factory(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function startReceiver(root) {
  'use strict';
  var model = root.MegaReceiverModel, doc = root.document;
  var art = doc.getElementById('station-art'), backdrop = doc.getElementById('backdrop-art');
  var fallback = doc.getElementById('fallback-art'), name = doc.getElementById('station-name');
  var track = doc.getElementById('track-name'), status = doc.getElementById('playback-state');
  var state = 'idle', activeId = '', artwork = '', artGeneration = 0, loadGeneration = 0;
  var language = (root.navigator.language || 'en').split('-')[0];
  var copy = {
    en: { idle: 'Choose a radio in MegaRadio.', loading: 'Connecting…', buffering: 'Buffering…', paused: 'Paused', playing: '', error: 'This radio could not be played. Choose another in MegaRadio.' },
    tr: { idle: 'MegaRadio’dan bir radyo seç.', loading: 'Bağlanıyor…', buffering: 'Yükleniyor…', paused: 'Duraklatıldı', playing: '', error: 'Bu radyo çalınamadı. MegaRadio’dan başka bir radyo seç.' },
    de: { idle: 'Wähle einen Sender in MegaRadio.', loading: 'Verbindung wird hergestellt…', buffering: 'Wird geladen…', paused: 'Pausiert', playing: '', error: 'Dieser Sender konnte nicht abgespielt werden. Wähle einen anderen in MegaRadio.' }
  };
  copy = copy[language] || copy.en;
  doc.documentElement.lang = ['tr', 'de'].indexOf(language) >= 0 ? language : 'en';
  function setState(next) { state = next; doc.body.dataset.state = next; status.textContent = copy[next] || ''; }
  function clearArtwork() {
    art.hidden = true; backdrop.hidden = true; fallback.hidden = false;
    art.removeAttribute('src'); backdrop.removeAttribute('src');
  }
  function setArtwork(next) {
    if (next === artwork) return;
    artwork = next;
    var generation = ++artGeneration;
    clearArtwork();
    if (!next) return;
    // A new Image per source generation also protects A → B → A from late callbacks.
    var candidate = new root.Image();
    candidate.referrerPolicy = 'no-referrer';
    candidate.onload = function () {
      if (generation !== artGeneration) return;
      art.src = next; backdrop.src = next; art.hidden = false; backdrop.hidden = false; fallback.hidden = true;
    };
    candidate.onerror = function () { if (generation === artGeneration) clearArtwork(); };
    candidate.src = next;
  }
  function showMedia(media) {
    var data = model.presentation(media);
    name.textContent = data.station; track.textContent = data.track; track.hidden = !data.track;
    setArtwork(data.artwork);
  }
  function clearMedia() { loadGeneration++; activeId = ''; name.textContent = 'MegaRadio'; track.textContent = ''; track.hidden = true; setArtwork(''); }
  setState('idle');
  if (!root.cast || !root.cast.framework) { setState('error'); return null; }
  var framework = root.cast.framework;
  var context = framework.CastReceiverContext.getInstance(), player = context.getPlayerManager();
  var binding = new framework.ui.PlayerDataBinder({});
  function currentMatches() {
    var media = player.getMediaInformation();
    return media && (!activeId || model.mediaId(media) === activeId) ? media : null;
  }
  function presentLoad(request) {
    // Presentation observes the standard message; CAF retains the untouched request,
    // URL, credentials, LIVE transport, queue and error validation.
    if (request && request.media) {
      loadGeneration++;
      activeId = model.mediaId(request.media); showMedia(request.media); setState('loading');
    }
    return request;
  }
  player.setMessageInterceptor(framework.messages.MessageType.LOAD, presentLoad);
  player.addEventListener(framework.events.EventType.MEDIA_INFORMATION_CHANGED, function () {
    var media = currentMatches();
    if (media) {
      showMedia(media);
      var next = typeof player.getPlayerState === 'function' ? String(player.getPlayerState()).toLowerCase() : '';
      if (['loading', 'buffering', 'paused', 'playing'].indexOf(next) >= 0) setState(next);
    }
  });
  binding.addEventListener(framework.ui.PlayerDataEventType.STATE_CHANGED, function (event) {
    var next = String(event.value || '').toLowerCase(), media = currentMatches();
    if (activeId && !media) return; // Old session events cannot replace a pending station.
    if (['loading', 'buffering', 'paused', 'playing'].indexOf(next) >= 0) {
      if (media) { activeId = model.mediaId(media); showMedia(media); }
      setState(next);
    } else if ((next === 'idle' || next === 'launching') && state !== 'error') {
      clearMedia(); setState('idle');
    }
  });
  player.addEventListener(framework.events.EventType.ERROR, function () {
    if (!activeId || currentMatches()) setState('error');
  });
  // Keep the published receiver's legacy namespace for older live senders.
  // CAF remains the transport; only connected senders and bounded known payloads
  // reach its standard load/play/pause/stop/system-volume methods.
  context.addCustomMessageListener('urn:x-cast:com.visiongo.megaradio', function (event) {
    if (!event || typeof event.senderId !== 'string' || !context.getSender(event.senderId)) return;
    var command = model.legacyCommand(event.data);
    if (!command) return;
    try {
      if (command.type === 'LOAD') {
        presentLoad(command.request);
        var generation = loadGeneration;
        Promise.resolve(player.load(command.request)).catch(function () { if (loadGeneration === generation) setState('error'); });
      } else if (command.type === 'STOP') player.stop();
      else if (command.type === 'PAUSE') player.pause();
      else if (command.type === 'RESUME') player.play();
      else if (command.type === 'VOLUME' && typeof context.setSystemVolume === 'function') context.setSystemVolume({ level: command.level, muted: false });
    } catch (_) { if (command.type === 'LOAD') setState('error'); }
  });
  // No maxInactivity override, telemetry, standard playback URL rewriting,
  // media element replacement or second audio player.
  context.start();
  return { context: context, player: player, binding: binding };
}));
