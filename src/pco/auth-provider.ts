import { OAuthClient, type OAuthTokens } from "./oauth.js";

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
  private tokens: OAuthTokens;

  constructor(
    private readonly client: OAuthClient,
    initialTokens: OAuthTokens,
  ) {
    this.tokens = initialTokens;
  }

  async getAuthHeader(): Promise<string> {
    // Refresh if expiring within 60 seconds
    if (this.tokens.expiresAt <= Date.now() + 60_000) {
      this.tokens = await this.client.refresh(this.tokens.refreshToken);
    }

    return `${this.tokens.tokenType} ${this.tokens.accessToken}`;
  }
}