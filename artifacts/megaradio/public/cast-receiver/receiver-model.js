(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MegaReceiverModel = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function text(value, limit) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
  }
  function equivalent(a, b) {
    return a.normalize('NFKC').toLocaleLowerCase('en').replace(/[\s\-_]+/g, '') === b.normalize('NFKC').toLocaleLowerCase('en').replace(/[\s\-_]+/g, '');
  }
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function artworkUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return '';
    try {
      var url = new URL(value);
      // HTTPS page: do not introduce mixed content, credentials or data/SVG injection.
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }
  function presentation(media, now) {
    media = object(media);
    var metadata = object(media.metadata), custom = object(media.customData);
    var title = text(metadata.title, 160), artist = text(metadata.artist || metadata.albumArtist, 160);
    var station = text(custom.stationName, 160) || title || artist || 'MegaRadio';
    var track = [];
    if (title && !equivalent(title, station) && !equivalent(title, 'MegaRadio')) track.push(title);
    if (artist && !equivalent(artist, station) && !equivalent(artist, 'MegaRadio') && !equivalent(artist, title)) track.push(artist);
    var images = Array.isArray(metadata.images) ? metadata.images.slice(0, 4) : [];
    var artwork = '';
    for (var i = 0; i < images.length && !artwork; i++) artwork = artworkUrl(object(images[i]).url);
    if (custom.castIntentId) {
      var actual = freshTrack(custom.nowPlaying, now === undefined ? Date.now() : now, station);
      track = actual ? [actual.text] : [];
    }
    return { station: station, track: track.join(' · '), artwork: artwork };
  }
  function mediaId(media) { return text(object(media).contentId || object(media).contentUrl, 4096); }
  function sequence(value) { return Number.isSafeInteger(value) && value > 0 ? value : 0; }
  function identity(media) {
    var custom = object(object(media).customData);
    var owner = typeof custom.castOwnerId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(custom.castOwnerId) ? custom.castOwnerId : '';
    return { contentId: mediaId(media), stationId: text(custom.stationId, 256), intentId: text(custom.castIntentId, 160), ownerId: owner, sequence: sequence(custom.castSequence) };
  }
  function matches(expected, media) {
    var actual = identity(media);
    return (!expected.contentId || actual.contentId === expected.contentId)
      && (!expected.stationId || actual.stationId === expected.stationId)
      && (!expected.intentId || actual.intentId === expected.intentId)
      && (!expected.ownerId || actual.ownerId === expected.ownerId)
      && (!expected.sequence || actual.sequence === expected.sequence);
  }
  function freshTrack(value, now, station) {
    var data = object(value), title = text(data.title, 160), artist = text(data.artist, 160);
    if (!title || !Number.isFinite(data.observedAt) || !Number.isFinite(data.expiresAt)
      || data.observedAt <= 0 || data.observedAt > now + 5000 || data.expiresAt <= now
      || data.expiresAt <= data.observedAt || data.expiresAt - data.observedAt > 120000) return null;
    if ((equivalent(title, station) || equivalent(title, 'MegaRadio')) && (!artist || equivalent(artist, station) || equivalent(artist, 'MegaRadio'))) return null;
    return { text: artist && !equivalent(artist, title) && !equivalent(artist, station) ? artist + ' - ' + title : title, expiresAt: data.expiresAt };
  }
  function contextLabels(media) {
    var data = object(object(media).customData), genre = text(data.genre, 80);
    if (!genre && Array.isArray(data.genres)) genre = text(data.genres[0], 80);
    return [genre, text(data.country, 80)].filter(function (value, index, values) { return value && values.indexOf(value) === index; });
  }
  function publicTrack(value, station, country, now) {
    var data = object(value);
    if (!Number.isFinite(data.observedAt)) return null;
    if (['AdCreativeId', 'adw_ad', 'adId', 'insertionType'].some(function (key) { return !!data[key]; })) return null;
    function field(raw) {
      if (typeof raw !== 'string' || raw.length > 1024) return '';
      var clean = raw.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
      if (/<\/?[a-z!][^>]*>|<!doctype|<\?xml/i.test(clean) || /^(?:https?:\/\/|HTTP\/\d|\{\s*["']|\[\s*\{)/i.test(clean)
        || /\b(?:StreamTitle|StreamUrl|icy-name|AdCreativeId|adw_ad|insertionType)\s*[:=]/i.test(clean)
        || /^(?:(?:stream|radio|station|server|service)\s+(?:is\s+)?(?:offline|unavailable|not found)|no (?:stream|metadata|song)|error\s*[:=]|bad gateway|service unavailable)/i.test(clean)) return '';
      return text(clean, 160);
    }
    var title = field(data.title), artist = field(data.artist), generic = /^(?:live(?: radio| stream)?|unknown(?: artist| title)?|n\/a)$/i;
    var fallback = !title || equivalent(title, station) || generic.test(title);
    if (artist && fallback && (equivalent(artist, station) || equivalent(artist, country) || generic.test(artist))) artist = '';
    if (!title) { title = artist; artist = ''; }
    else if (fallback && !artist) return null;
    if (title && artist) {
      var split = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title);
      if (split && equivalent(split[1], artist)) title = split[2];
    }
    var result = { title: title, artist: artist, observedAt: data.observedAt, expiresAt: data.observedAt + 120000 };
    return freshTrack(result, now, station) ? result : null;
  }
  function metadataCommand(value) {
    var data = object(value), allowed = ['type', 'stationId', 'castIntentId', 'castSequence', 'metadataSequence', 'nowPlaying', 'playbackState'];
    if (data.type !== 'METADATA' || Object.keys(data).some(function (key) { return allowed.indexOf(key) < 0; })) return null;
    if (typeof data.stationId !== 'string' || !data.stationId || data.stationId.length > 256
      || typeof data.castIntentId !== 'string' || !data.castIntentId || data.castIntentId.length > 160
      || !sequence(data.castSequence) || !sequence(data.metadataSequence)) return null;
    if (data.playbackState !== undefined && ['idle', 'loading', 'connecting', 'buffering', 'playing', 'paused', 'error'].indexOf(data.playbackState) < 0) return null;
    if (data.nowPlaying !== null) {
      var track = object(data.nowPlaying);
      if (typeof track.title !== 'string' || !track.title.trim() || track.title.length > 160
        || track.artist !== undefined && (typeof track.artist !== 'string' || track.artist.length > 160)
        || !Number.isFinite(track.observedAt) || !Number.isFinite(track.expiresAt)
        || track.observedAt <= 0 || track.expiresAt <= track.observedAt || track.expiresAt - track.observedAt > 120000
        || Object.keys(track).some(function (key) { return ['title', 'artist', 'observedAt', 'expiresAt'].indexOf(key) < 0; })) return null;
    }
    return { type: 'METADATA', stationId: data.stationId, castIntentId: data.castIntentId, castSequence: data.castSequence,
      metadataSequence: data.metadataSequence, nowPlaying: data.nowPlaying === null ? null : Object.assign({}, data.nowPlaying) };
  }
  function legacyCommand(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var type = value.type;
    var allowed = type === 'LOAD' ? ['type', 'streamUrl', 'stationName', 'imageUrl'] : type === 'VOLUME' ? ['type', 'volume'] : ['type'];
    if (['LOAD', 'STOP', 'PAUSE', 'RESUME', 'VOLUME'].indexOf(type) < 0 || Object.keys(value).some(function (key) { return allowed.indexOf(key) < 0; })) return null;
    if (type === 'VOLUME') return typeof value.volume === 'number' && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 100 ? { type: type, level: value.volume / 100 } : null;
    if (type !== 'LOAD') return { type: type };
    if (typeof value.streamUrl !== 'string' || value.streamUrl.length > 4096 || /[\u0000-\u0020\u007f]/.test(value.streamUrl)) return null;
    if (value.stationName !== undefined && (typeof value.stationName !== 'string' || value.stationName.length > 160)) return null;
    if (value.imageUrl !== undefined && (typeof value.imageUrl !== 'string' || value.imageUrl.length > 2048)) return null;
    var url;
    try { url = new URL(value.streamUrl); } catch (_) { return null; }
    // Legacy radio URLs may be HTTP; preserve that contract without enabling
    // mixed content or relaxing the browser/CAF media policy.
    if (['https:', 'http:'].indexOf(url.protocol) < 0 || url.username || url.password || url.hash) return null;
    var lower = value.streamUrl.toLowerCase();
    var mime = lower.indexOf('.m3u8') >= 0 || lower.indexOf('hls') >= 0 ? 'application/x-mpegURL'
      : lower.indexOf('.aac') >= 0 ? 'audio/aac' : lower.indexOf('.ogg') >= 0 ? 'audio/ogg' : 'audio/mpeg';
    var station = text(value.stationName, 160) || 'MegaRadio', image = artworkUrl(value.imageUrl);
    return { type: type, request: { autoplay: true, media: {
      contentId: value.streamUrl, contentUrl: value.streamUrl, contentType: mime, streamType: 'LIVE',
      customData: { stationName: station },
      metadata: { metadataType: 0, title: station, images: image ? [{ url: image }] : [] }
    } } };
  }
  return { presentation: presentation, artworkUrl: artworkUrl, mediaId: mediaId, legacyCommand: legacyCommand,
    identity: identity, matches: matches, sequence: sequence, freshTrack: freshTrack, contextLabels: contextLabels, metadataCommand: metadataCommand, publicTrack: publicTrack };
}));
