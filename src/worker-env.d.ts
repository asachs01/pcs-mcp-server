// Cloudflare Workers environment types for pcs-mcp-server

declare global {
  interface Env {
    // Planning Center authentication (set as Wrangler secrets)
    PCO_PAT_APP_ID?: string;
    PCO_PAT_SECRET?: string;
    PCO_OAUTH_CLIENT_ID?: string;
    PCO_OAUTH_CLIENT_SECRET?: string;

    // Optional configuration (can be set in wrangler.toml [vars])
    PCO_OAUTH_REDIRECT_URI?: string;
    PCO_DEFAULT_SERVICE_TYPE_ID?: string;
    LOG_LEVEL?: "error" | "warn" | "info" | "debug";
  }

  // Cloudflare Workers Runtime APIs
  interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException(): void;
  }

  // Export handler interface for Workers
  interface ExportedHandler<Env = unknown> {
    fetch?(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
  }
}

export {};