import { OAuthClient, type OAuthTokens } from "./oauth.js";
import type { TokenStorage } from "./token-storage.js";

export interface AuthProvider {
  /** Returns the Authorization header value, refreshing tokens as needed. */
  getAuthHeader(): Promise<string>;
}

export class PatAuthProvider implements AuthProvider {
  private readonly authHeader: string;

  constructor(appId: string, secret: string) {
    const token = Buffer.from(`${appId}:${secret}`).toString("base64");
    this.authHeader = `Basic ${token}`;
  }

  async getAuthHeader(): Promise<string> {
    return this.authHeader;
  }
}

export class OAuthAuthProvider implements AuthProvider {
  private tokens: OAuthTokens | null;

  constructor(
    private readonly client: OAuthClient,
    initialTokens: OAuthTokens | null,
    private readonly storage: TokenStorage,
  ) {
    this.tokens = initialTokens;
  }

  async getAuthHeader(): Promise<string> {
    // Lazy-load from storage if no initial tokens
    if (!this.tokens) {
      this.tokens = await this.storage.load();
      if (!this.tokens) {
        throw new Error("No OAuth tokens available. Run the authorize flow first.");
      }
    }

    // Refresh if expiring within 60 seconds
    if (this.tokens.expiresAt <= Date.now() + 60_000) {
      this.tokens = await this.client.refresh(this.tokens.refreshToken);
      await this.storage.save(this.tokens);
    }

    return `${this.tokens.tokenType} ${this.tokens.accessToken}`;
  }
}
