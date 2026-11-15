import fetch, { Request } from 'node-fetch';
import type { Readable } from 'node:stream';
import { logger } from '../utils/logger';

export interface MetadataResult {
  title?: string;
  artist?: string;
  station?: string;
  genre?: string;
}

interface StreamAnalysis {
  title: string;
  contentType: string | null;
  icyName: string | null;
  icyGenre: string | null;
}

interface StreamConnection {
  controller: AbortController;
  sockets: Set<string>;
  nowPlaying: string | undefined;
  metadata: MetadataResult;
  lastUpdate: number;
  lastActivity: number;
  destroy: () => void;
}

enum ReadAction {
  PASS_SEGMENT,
  DECODE_META_SIZE,
  EXTRACT_TITLE,
}

function safeRead(stream: Readable, bytes: number, handler: (chunk: Buffer) => void) {
  if (stream.readableLength >= bytes) {
    const data = stream.read(bytes);
    if (data) handler(data);
  }
}

function parseIcyMetadata(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of raw.split("';")) {
    const eqIdx = match.indexOf("='");
    if (eqIdx === -1) continue;
    const key = match.substring(0, eqIdx).trim();
    const value = match.substring(eqIdx + 2);
    if (key && value) result[key] = value;
  }
  return result;
}

function isAdvertisement(metadata: Record<string, string>): boolean {
  return !!(metadata['AdCreativeId'] || metadata['adw_ad'] || metadata['AdTitle']);
}

export function parseArtistTitle(streamTitle: string): MetadataResult {
  const text=streamTitle?.trim();
  if(!text)return {};
  const separator=text.indexOf(' - ');
  if(separator>=0)return {artist:text.slice(0,separator).trim(),title:text.slice(separator+3).trim()};
  return {title:text};
}

const FETCH_HEADERS = {
  'Icy-MetaData': '1',
  'User-Agent': 'MegaRadio/2.0 (Radiolise-style)',
};

// SINGLETON ACCESSOR — prevents per-request leaks of stateful connection map.
// All callers should use getStreamMetadataService() instead of `new StreamMetadataService()`.
let _streamMetadataServiceInstance: StreamMetadataService | null = null;
export function getStreamMetadataService(): StreamMetadataService {
  if (!_streamMetadataServiceInstance) {
    _streamMetadataServiceInstance = new StreamMetadataService();
  }
  return _streamMetadataServiceInstance;
}

export class StreamMetadataService {
  private connections = new Map<string, StreamConnection>();
  private maxConnections = 50;

  private analyzeStream(
    url: string,
    controller: AbortController,
    onTitle: (title: string, headers: any) => void,
    onError: (err: Error) => void,
    onReset: (headers?:{icyName:string|null;icyGenre:string|null}) => void,
    onActivity: () => void
  ): void {
    const request = new Request(url, {
      signal: controller.signal as any,
      headers: FETCH_HEADERS,
    });

    // CIRCUIT BREAKER: prevent infinite reconnect loop on dead streams.
    // After MAX_FAILURES, give up and let the connection idle out.
    const MAX_FAILURES = 5;
    const COOLDOWN_AFTER_GIVE_UP_MS = 10 * 60 * 1000; // 10 min
    let consecutiveFailures = 0;
    let givenUp = false;

    const reschedule = (delayMs: number) => {
      if (controller.signal.aborted) return;
      onReset();
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_FAILURES && !givenUp) {
        givenUp = true;
        logger.log(`⛔ STREAM-META: giving up on ${url.substring(0, 60)} after ${MAX_FAILURES} failures (cooldown ${COOLDOWN_AFTER_GIVE_UP_MS / 60000}m)`);
        setTimeout(() => {
          if (controller.signal.aborted) return;
          consecutiveFailures = 0;
          givenUp = false;
          doAnalyze();
        }, COOLDOWN_AFTER_GIVE_UP_MS).unref?.();
        return;
      }
      if (givenUp) return;
      setTimeout(() => doAnalyze(), delayMs).unref?.();
    };

    // Normal stream closure ('end') is not a failure — many radio servers
    // routinely close and rotate the underlying TCP connection. Reconnect
    // without incrementing the circuit-breaker counter so a healthy station
    // never gets blackout-silenced for 10 minutes.
    const rescheduleSoft = (delayMs: number) => {
      if (controller.signal.aborted) return;
      onReset();
      if (givenUp) return;
      setTimeout(() => doAnalyze(), delayMs).unref?.();
    };

    const doAnalyze = () => {
      if(controller.signal.aborted)return;
      fetch(request).then((response) => {
        if (!response.ok || !response.body) {
          onError(new Error(`HTTP ${response.status}`));
          reschedule(5000);
          return;
        }
        // Successful connect — reset failure counter
        consecutiveFailures = 0;

        const metaIntervalHeader = response.headers.get('icy-metaint');
        const icyName = response.headers.get('icy-name');
        const icyGenre = response.headers.get('icy-genre');

        // Transport identity is not a song. Reconnecting must not expose the
        // previous connection's cached track while awaiting its first ICY frame.
        onReset({icyName,icyGenre});
        onActivity();

        if (!metaIntervalHeader) {
          return;
        }

        const stream = response.body as unknown as Readable;
        const metaInterval = Number(metaIntervalHeader);

        if (!Number.isFinite(metaInterval) || metaInterval <= 0 || metaInterval > 65536) {
          return;
        }

        let currentRaw = '';
        let action = ReadAction.PASS_SEGMENT;
        let decodedMetaSize = 0;

        const passSegment = () => {
          action = ReadAction.PASS_SEGMENT;
          safeRead(stream, metaInterval, () => decodeMetaSize());
        };

        const decodeMetaSize = () => {
          action = ReadAction.DECODE_META_SIZE;
          safeRead(stream, 1, (chunk) => {
            decodedMetaSize = chunk[0] << 4;
            if (decodedMetaSize === 0) {
              return passSegment();
            }
            extractTitle();
          });
        };

        const extractTitle = () => {
          action = ReadAction.EXTRACT_TITLE;
          safeRead(stream, decodedMetaSize, (chunk) => {
            const decoded = chunk.toString('utf8').replace(/\0/g, '').trim();
            if (currentRaw === decoded || !decoded) {
              return passSegment();
            }
            currentRaw = decoded;
            const parsed = parseIcyMetadata(decoded);
            if (isAdvertisement(parsed)) {
              return passSegment();
            }
            if (parsed.StreamTitle) {
              onTitle(parsed.StreamTitle, { icyName, icyGenre });
            }
            passSegment();
          });
        };

        stream.on('readable', () => {
          onActivity();
          if (action === ReadAction.PASS_SEGMENT) return passSegment();
          if (action === ReadAction.DECODE_META_SIZE) return decodeMetaSize();
          if (action === ReadAction.EXTRACT_TITLE) return extractTitle();
        });

        stream.on('end', () => {
          rescheduleSoft(2000);
        });

        stream.on('error', () => {
          reschedule(5000);
        });
      }).catch((err: any) => {
        reschedule(5000);
      });
    };

    doAnalyze();
  }

  private getOrCreateConnection(streamUrl: string): StreamConnection {
    const existing = this.connections.get(streamUrl);
    if (existing) {
      // A silent socket must not serve its last song forever. Audio activity,
      // rather than song age, keeps long unchanged tracks valid.
      if(!existing.nowPlaying||Date.now()-existing.lastActivity<=45000)return existing;
      existing.destroy();
    }

    if (this.connections.size >= this.maxConnections) {
      let oldestUrl = '';
      let oldestTime = Infinity;
      Array.from(this.connections.entries()).forEach(([url, conn]) => {
        if (conn.sockets.size === 0 && conn.lastUpdate < oldestTime) {
          oldestTime = conn.lastUpdate;
          oldestUrl = url;
        }
      });
      // FIX: if no idle connection found, force-evict the absolute oldest
      // (otherwise cap is bypassed and connections grow unbounded).
      // Active subscribers will reconnect on next poll — degraded UX, not crash.
      if (!oldestUrl) {
        let fallbackOldestTime = Infinity;
        Array.from(this.connections.entries()).forEach(([url, conn]) => {
          if (conn.lastUpdate < fallbackOldestTime) {
            fallbackOldestTime = conn.lastUpdate;
            oldestUrl = url;
          }
        });
        if (oldestUrl) {
          console.warn(`⚠️ STREAM-META: cap=${this.maxConnections} reached, force-evicting active connection ${oldestUrl.substring(0, 60)}`);
        }
      }
      if (oldestUrl) {
        this.connections.get(oldestUrl)?.destroy();
        this.connections.delete(oldestUrl);
      }
    }

    const controller = new AbortController();
    const sockets = new Set<string>(existing?.sockets);
    const conn: StreamConnection = {
      controller,
      sockets,
      nowPlaying: undefined,
      metadata: {},
      lastUpdate: Date.now(),
      lastActivity: Date.now(),
      destroy: () => {
        controller.abort();
        this.connections.delete(streamUrl);
      },
    };

    this.connections.set(streamUrl, conn);

    this.analyzeStream(
      streamUrl,
      controller,
      (title, headers) => {
        const parsed = parseArtistTitle(title);
        if(!parsed.title&&!parsed.artist)return;
        conn.metadata = {
          ...parsed,
          station: headers?.icyName || undefined,
          genre: headers?.icyGenre || undefined,
        };
        conn.nowPlaying = title;
        conn.lastUpdate = Date.now();
      },
      (err) => {
        logger.log(`❌ Stream metadata error for ${streamUrl}: ${err.message}`);
      },
      headers=>{
        conn.nowPlaying=undefined;
        conn.metadata={station:headers?.icyName||conn.metadata.station,genre:headers?.icyGenre||conn.metadata.genre};
      },
      ()=>{conn.lastActivity=Date.now();}
    );

    return conn;
  }

  subscribe(streamUrl: string, clientId: string): void {
    const conn = this.getOrCreateConnection(streamUrl);
    conn.sockets.add(clientId);
  }

  unsubscribe(streamUrl: string, clientId: string): void {
    const conn = this.connections.get(streamUrl);
    if (!conn) return;
    conn.sockets.delete(clientId);

    if (conn.sockets.size === 0) {
      setTimeout(() => {
        const check = this.connections.get(streamUrl);
        if (check && check.sockets.size === 0) {
          check.destroy();
          logger.log(`🛑 Stream connection closed (no listeners): ${streamUrl}`);
        }
      }, 30000);
    }
  }

  getMetadata(streamUrl: string): MetadataResult {
    const conn = this.connections.get(streamUrl);
    if (!conn || (conn.nowPlaying&&Date.now()-conn.lastActivity>45000)) return {};
    return conn.metadata;
  }

  async getStationMetadata(station: any): Promise<MetadataResult> {
    if (!station) return {};
    const streamUrl = station.url_resolved || station.urlResolved || station.url;
    if (!streamUrl) return {};

    const conn = this.getOrCreateConnection(streamUrl);
    if (conn.nowPlaying) {
      return conn.metadata;
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: MetadataResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(check);
        resolve(value);
      };
      const timeout = setTimeout(() => settle(conn.metadata), 8000);
      const check = setInterval(() => {
        if (conn.nowPlaying) settle(conn.metadata);
      }, 500);
    });
  }

  getActiveConnections(): number {
    return this.connections.size;
  }

  getConnectionStats(): { url: string; listeners: number; lastUpdate: number }[] {
    const stats: { url: string; listeners: number; lastUpdate: number }[] = [];
    this.connections.forEach((conn, url) => {
      stats.push({
        url: url.substring(0, 60),
        listeners: conn.sockets.size,
        lastUpdate: Date.now() - conn.lastUpdate,
      });
    });
    return stats;
  }

  cleanup(): void {
    this.connections.forEach((conn) => {
      conn.destroy();
    });
    this.connections.clear();
    logger.log('🧹 StreamMetadataService: All connections closed');
  }
}
