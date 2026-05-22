import type { Logger } from "../logger.js";
import { RateLimiter } from "./rate-limiter.js";
import type { AuthProvider } from "./auth-provider.js";

const BASE_URL = "https://api.planningcenteronline.com";

export interface PcoError extends Error {
  status: number;
  body: unknown;
}

export class PcoClient {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly authProvider: AuthProvider,
    private readonly logger: Logger,
    defaults?: { rateLimitCapacity?: number; rateLimitWindowMs?: number },
  ) {
    // PCO: 100 req / 20s. Stay a hair under to leave headroom for bursts.
    this.limiter = new RateLimiter({
      capacity: defaults?.rateLimitCapacity ?? 95,
      windowMs: defaults?.rateLimitWindowMs ?? 20_000,
    });
  }

  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.fetch<T>("GET", path, { query });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.fetch<T>("POST", path, { body });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.fetch<T>("PATCH", path, { body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.fetch<T>("DELETE", path);
  }

  private async fetch<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    await this.limiter.acquire();

    const url = new URL(path.startsWith("/") ? path : `/${path}`, BASE_URL);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

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

    return parsed as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
