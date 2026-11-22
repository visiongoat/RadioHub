import type { Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { privateApiCachePolicy } from '../middleware/cache-policy';

export interface ApiCapacityConfig {
  maxConnections: number;
  requestsPerMinute: number;
}

function boundedPositiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const text = value?.trim() || '';
  if (!/^\d+$/.test(text)) return fallback;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

/** Operator ceilings, not a claim that the current instance can serve them. */
export function readApiCapacityConfig(environment: NodeJS.ProcessEnv = process.env): ApiCapacityConfig {
  return {
    maxConnections: boundedPositiveInteger(environment.API_MAX_CONNECTIONS, 300, 20_000),
    requestsPerMinute: boundedPositiveInteger(environment.API_RATE_LIMIT_MAX, 600, 6_000),
  };
}

function limitedResponse(req: Request, res: Response, _next: NextFunction, options: { statusCode: number; message: unknown }) {
  // A quota result belongs to this IP, never to a shared public CDN response.
  privateApiCachePolicy(req, res, () => { res.status(options.statusCode).json(options.message); });
}

export function createGlobalApiLimiter(config = readApiCapacityConfig()) {
  return rateLimit({
    windowMs: 60_000,
    max: config.requestsPerMinute,
    standardHeaders: true,
    legacyHeaders: true,
    message: { error: 'Too many requests, please try again later.' },
    handler: limitedResponse,
    // Mounted at /api: Express strips that prefix from req.path. Checking for
    // /api here would silently exempt every actual API request. Do not trust a
    // caller-controlled User-Agent or IP header as an exemption or bucket key.
    skip: req => ['/health', '/healthz', '/readyz'].includes(req.path),
  });
}

export function createAuthApiLimiter() {
  return rateLimit({
    windowMs: 15 * 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: true,
    skipSuccessfulRequests: true,
    message: { error: 'Too many login attempts, please try again in 15 minutes.' },
    handler: limitedResponse,
  });
}

type MetricsServer = Pick<Server, 'getConnections' | 'maxConnections'> & {
  metadataWss?: { clients: { size: number } };
  castWss?: { clients: { size: number } };
  chatWss?: { clients: { size: number } };
};

/** Aggregate operational counts only: no peers, tickets, session IDs or URLs. */
export async function apiConnectionSnapshot(server: MetricsServer | undefined, config: ApiCapacityConfig) {
  const active = server ? await new Promise<number | null>(resolve => {
    const timeout = setTimeout(() => resolve(null), 250);
    timeout.unref();
    try {
      server.getConnections((error, count) => {
        clearTimeout(timeout);
        resolve(error ? null : count);
      });
    } catch {
      clearTimeout(timeout);
      resolve(null);
    }
  }) : null;
  return {
    active,
    limit: server?.maxConnections ?? config.maxConnections,
    perIpRequestsPerMinute: config.requestsPerMinute,
    websocket: {
      metadata: server?.metadataWss?.clients.size ?? 0,
      cast: server?.castWss?.clients.size ?? 0,
      chat: server?.chatWss?.clients.size ?? 0,
    },
  };
}
