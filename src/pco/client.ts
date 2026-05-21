import { request } from "undici";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { RateLimiter } from "./rate-limiter.js";

const BASE_URL = "https://api.planningcenteronline.com";

export interface PcoError extends Error {
  status: number;
  body: unknown;
}

export class PcoClient {
  private readonly authHeader: string;
  private readonly limiter: RateLimiter;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.authHeader = buildAuthHeader(config);
    // PCO: 100 req / 20s. Stay a hair under to leave headroom for bursts.
    this.limiter = new RateLimiter({ capacity: 95, windowMs: 20_000 });
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

    const res = await request(url.toString(), {
      method: method as "GET" | "POST" | "PATCH" | "DELETE",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.body.text();
    const parsed = text ? safeJson(text) : undefined;

    if (res.statusCode >= 400) {
      const err = new Error(
        `Planning Center API ${res.statusCode} on ${method} ${path}`,
      ) as PcoError;
      err.status = res.statusCode;
      err.body = parsed ?? text;
      throw err;
    }

    return parsed as T;
  }
}

function buildAuthHeader(config: AppConfig): string {
  if (config.auth.mode === "pat") {
    const token = Buffer.from(`${config.auth.appId}:${config.auth.secret}`).toString("base64");
    return `Basic ${token}`;
  }
  // OAuth lands in Phase 4. For now, throw if reached.
  throw new Error("OAuth auth mode not yet implemented (Phase 4).");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
