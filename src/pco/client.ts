import type { Logger } from "../logger.js";
import { RateLimiter } from "./rate-limiter.js";
import type { AuthProvider } from "./auth-provider.js";
import type { LruTtlCache } from "./cache.js";

const BASE_URL = "https://api.planningcenteronline.com";

export interface PcoError extends Error {
  status: number;
  body: unknown;
}

export class PcoClient {
  private readonly limiter: RateLimiter;
  private readonly cache?: LruTtlCache<unknown>;

  constructor(
    private readonly authProvider: AuthProvider,
    private readonly logger: Logger,
    defaults?: {
      rateLimitCapacity?: number;
      rateLimitWindowMs?: number;
      cache?: LruTtlCache<unknown>;
    },
  ) {
    // PCO: 100 req / 20s. Stay a hair under to leave headroom for bursts.
    this.limiter = new RateLimiter({
      capacity: defaults?.rateLimitCapacity ?? 95,
      windowMs: defaults?.rateLimitWindowMs ?? 20_000,
    });
    this.cache = defaults?.cache;
  }

  async get<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
    cache?: { ttlMs: number },
  ): Promise<T> {
    return this.fetch<T>("GET", path, { query, cache });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const result = await this.fetch<T>("POST", path, { body });
    this.invalidateCache(path);
    return result;
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const result = await this.fetch<T>("PATCH", path, { body });
    this.invalidateCache(path);
    return result;
  }

  async delete<T>(path: string): Promise<T> {
    const result = await this.fetch<T>("DELETE", path);
    this.invalidateCache(path);
    return result;
  }

  private async fetch<T>(
    method: string,
    path: string,
    opts: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      cache?: { ttlMs: number };
    } = {},
  ): Promise<T> {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, BASE_URL);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    // Check cache for GET requests
    if (method === "GET" && opts.cache && this.cache) {
      const cacheKey = `${method} ${url.toString()}`;
      const cachedValue = this.cache.get(cacheKey);
      if (cachedValue !== undefined) {
        this.logger.debug("pco cache hit", { method, url: url.toString() });
        return cachedValue as T;
      }
    }

    await this.limiter.acquire();

    this.logger.debug("pco request", { method, url: url.toString() });

    const res = await fetch(url.toString(), {
      method: method as "GET" | "POST" | "PATCH" | "DELETE",
      headers: {
        Authorization: await this.authProvider.getAuthHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;

    if (res.status >= 400) {
      const err = new Error(`Planning Center API ${res.status} on ${method} ${path}`) as PcoError;
      err.status = res.status;
      err.body = parsed ?? text;
      throw err;
    }

    // Cache successful GET responses
    if (method === "GET" && opts.cache && this.cache) {
      const cacheKey = `${method} ${url.toString()}`;
      this.cache.set(cacheKey, parsed, opts.cache.ttlMs);
      this.logger.debug("pco cache set", { method, url: url.toString(), ttlMs: opts.cache.ttlMs });
    }

    return parsed as T;
  }

  private invalidateCache(path: string): void {
    if (!this.cache) return;

    // Conservative approach: clear all cache on any mutation
    // This is safe for the MCP server use case
    this.cache.clear();

    this.logger.debug("pco cache invalidated", { path });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
