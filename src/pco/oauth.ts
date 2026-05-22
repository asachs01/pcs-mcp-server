import { randomUUID } from "node:crypto";

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[]; // default ["services", "people"]
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  tokenType: "Bearer";
}

export class OAuthClient {
  private readonly credentials: OAuthCredentials;
  private readonly baseUrl = "https://api.planningcenteronline.com";

  constructor(credentials: OAuthCredentials) {
    this.credentials = {
      ...credentials,
      scopes: credentials.scopes ?? ["services", "people"],
    };
  }

  /** Build the URL the user opens in their browser to authorize. */
  buildAuthorizationUrl(state: string): string {
    const url = new URL(`${this.baseUrl}/oauth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.credentials.clientId);
    url.searchParams.set("redirect_uri", this.credentials.redirectUri);
    url.searchParams.set("scope", this.credentials.scopes!.join(" "));
    url.searchParams.set("state", state);

    return url.toString();
  }

  /** Exchange an auth code for tokens. */
  async exchangeCode(code: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      code,
      redirect_uri: this.credentials.redirectUri,
    });

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    if (response.status >= 400) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokenData = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      tokenType: "Bearer",
    };
  }

  /** Refresh tokens using the refresh_token. */
  async refresh(refreshToken: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      refresh_token: refreshToken,
    });

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    if (response.status >= 400) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const tokenData = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      tokenType: "Bearer",
    };
  }
}
