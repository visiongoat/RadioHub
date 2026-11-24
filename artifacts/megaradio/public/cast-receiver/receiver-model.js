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
  function presentation(media) {
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
    return { station: station, track: track.join(' · '), artwork: artwork };
  }
  function mediaId(media) { return text(object(media).contentId || object(media).contentUrl, 4096); }
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
  return { presentation: presentation, artworkUrl: artworkUrl, mediaId: mediaId, legacyCommand: legacyCommand };
}));
