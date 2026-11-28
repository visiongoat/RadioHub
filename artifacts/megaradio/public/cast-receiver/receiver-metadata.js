(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MegaReceiverMetadata = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var BASE = 'https://api.themegaradio.com/api/now-playing/';
  function create(options) {
    var owner = '', station = '', active = false, disposed = false, generation = 0;
    var timer = null, flight = null, lastStarted = null, failures = 0;
    function clearTimer() { if (timer !== null) options.clearTimeout(timer); timer = null; }
    function cancel() {
      generation++; clearTimer();
      if (flight) { options.clearTimeout(flight.deadline); flight.controller.abort(); flight = null; }
    }
    function schedule() {
      if (!active || disposed || flight || timer !== null) return;
      var delay = lastStarted === null ? 0 : Math.max(0, lastStarted + Math.min(300000, 60000 * Math.pow(2, failures)) - options.now());
      if (!delay) { read(); return; }
      timer = options.setTimeout(function () { timer = null; read(); }, delay);
    }
    function finish(item, failed) {
      if (flight !== item) return;
      options.clearTimeout(item.deadline); flight = null;
      failures = failed ? Math.min(3, failures + 1) : 0; schedule();
    }
    async function body(response) {
      var length = Number(response.headers && response.headers.get('content-length'));
      if (length > 65536) throw Error('metadata_too_large');
      if (response.body && response.body.getReader && options.TextDecoder) {
        var reader = response.body.getReader(), bytes = [], size = 0;
        for (;;) {
          var chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65536) { await reader.cancel(); throw Error('metadata_too_large'); }
          bytes.push(chunk.value);
        }
        var combined = new Uint8Array(size), offset = 0;
        bytes.forEach(function (value) { combined.set(value, offset); offset += value.byteLength; });
        return JSON.parse(new options.TextDecoder('utf-8').decode(combined));
      }
      var value = await response.text(); if (value.length > 65536) throw Error('metadata_too_large');
      return JSON.parse(value);
    }
    function read() {
      if (!active || disposed || flight) return;
      var item = { controller: new options.AbortController(), generation: generation, owner: owner, station: station };
      flight = item; lastStarted = options.now();
      item.deadline = options.setTimeout(function () {
        if (flight !== item) return;
        item.controller.abort(); finish(item, true);
      }, 9000);
      Promise.resolve().then(function () {
        if (flight !== item || disposed || item.controller.signal.aborted) throw Error('metadata_cancelled');
        return options.fetch(BASE + encodeURIComponent(item.station), {
        method: 'GET', credentials: 'omit', mode: 'cors', cache: 'no-store', headers: { Accept: 'application/json' }, signal: item.controller.signal
      }); }).then(function (response) { if (!response.ok) throw Error('metadata_http_error'); return body(response); })
        .then(function (data) {
          if (flight === item && active && !disposed && generation === item.generation && owner === item.owner && !item.controller.signal.aborted) {
            try { options.onData(data, item.owner); } catch (_) { /* Presentation must not break the bounded feed. */ }
          }
          finish(item, false);
        }, function () { finish(item, true); });
    }
    return {
      setOwner: function (stationId, token, playing) {
        if (disposed) return;
        var valid = typeof stationId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(stationId);
        var nextOwner = valid ? stationId + ':' + token : '';
        if (nextOwner !== owner) { cancel(); owner = nextOwner; station = valid ? stationId : ''; lastStarted = null; failures = 0; }
        var nextActive = !!owner && !!playing;
        if (!nextActive && active) cancel();
        active = nextActive; if (active) schedule();
      },
      dispose: function () { disposed = true; active = false; cancel(); }
    };
  }
  return { create: create };
}));
