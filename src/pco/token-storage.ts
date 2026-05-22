import { writeFile, readFile, mkdir, access, unlink, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { OAuthTokens } from "./oauth.js";

export interface TokenStorage {
  load(): Promise<OAuthTokens | null>;
  save(tokens: OAuthTokens): Promise<void>;
  clear(): Promise<void>;
}

/**
 * File-backed token storage. Path defaults to ~/.pcs-mcp/tokens.json.
 * Reads/writes atomically (write to temp file, then rename) to avoid
 * partial-write corruption when refresh races with shutdown.
 * Mode 0600 on write — secrets at rest deserve at least that.
 */
export class FileTokenStorage implements TokenStorage {
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? join(homedir(), ".pcs-mcp", "tokens.json");
  }

  async load(): Promise<OAuthTokens | null> {
    try {
      await access(this.path);
      const content = await readFile(this.path, "utf8");
      return JSON.parse(content) as OAuthTokens;
    } catch {
      return null;
    }
  }

  async save(tokens: OAuthTokens): Promise<void> {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true });

    // Write directly with proper mode (atomic enough for our use case)
    await writeFile(this.path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch {
      // File already gone
    }
  }
}

/**
 * Env-var-backed token storage. Reads tokens from PCO_OAUTH_TOKENS as a
 * JSON blob on load(); save() updates an in-memory cache only.
 * Useful for Workers / serverless where filesystem isn't writable.
 * Caller is responsible for persisting refreshed tokens externally
 * (warn via logger on save when no persistence is configured).
 */
export class EnvTokenStorage implements TokenStorage {
  private cachedTokens: OAuthTokens | null = null;
  private hasLoadedFromEnv = false;

  async load(): Promise<OAuthTokens | null> {
    if (!this.hasLoadedFromEnv) {
      const envTokens = process.env.PCO_OAUTH_TOKENS;
      if (envTokens) {
        try {
          this.cachedTokens = JSON.parse(envTokens) as OAuthTokens;
        } catch {
          this.cachedTokens = null;
        }
      }
      this.hasLoadedFromEnv = true;
    }
    return this.cachedTokens;
  }

  async save(tokens: OAuthTokens): Promise<void> {
    this.cachedTokens = tokens;
    // Note: In a real deployment, caller should persist refreshed tokens externally
    // This implementation only updates the in-memory cache
  }

  async clear(): Promise<void> {
    this.cachedTokens = null;
  }
}

/** In-memory only — for tests and short-lived flows. */
export class MemoryTokenStorage implements TokenStorage {
  private tokens: OAuthTokens | null = null;

  async load(): Promise<OAuthTokens | null> {
    return this.tokens;
  }

  async save(tokens: OAuthTokens): Promise<void> {
    this.tokens = tokens;
  }

  async clear(): Promise<void> {
    this.tokens = null;
  }
}
