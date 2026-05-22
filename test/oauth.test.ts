import { describe, it, expect, vi, beforeEach } from "vitest";
import { OAuthClient, type OAuthCredentials, type OAuthTokens } from "../src/pco/oauth.js";
import { PatAuthProvider, OAuthAuthProvider } from "../src/pco/auth-provider.js";
import { MemoryTokenStorage } from "../src/pco/token-storage.js";

describe("OAuthClient", () => {
  const credentials: OAuthCredentials = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/callback",
  };

  it("buildAuthorizationUrl produces the expected URL with required query params", () => {
    const client = new OAuthClient(credentials);
    const state = "test-state-123";

    const url = new URL(client.buildAuthorizationUrl(state));

    expect(url.origin + url.pathname).toBe("https://api.planningcenteronline.com/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/callback");
    expect(url.searchParams.get("scope")).toBe("services people");
    expect(url.searchParams.get("state")).toBe("test-state-123");
  });

  it("buildAuthorizationUrl uses custom scopes when provided", () => {
    const customCredentials = {
      ...credentials,
      scopes: ["services", "custom-scope"],
    };
    const client = new OAuthClient(customCredentials);

    const url = new URL(client.buildAuthorizationUrl("state"));

    expect(url.searchParams.get("scope")).toBe("services custom-scope");
  });
});

describe("PatAuthProvider", () => {
  it("getAuthHeader returns Basic auth with base64 encoded credentials", async () => {
    const provider = new PatAuthProvider("test-app-id", "test-secret");

    const header = await provider.getAuthHeader();

    // "test-app-id:test-secret" in base64
    const expectedToken = Buffer.from("test-app-id:test-secret").toString("base64");
    expect(header).toBe(`Basic ${expectedToken}`);
  });
});

describe("OAuthAuthProvider", () => {
  const mockTokens: OAuthTokens = {
    accessToken: "access-token-123",
    refreshToken: "refresh-token-456",
    expiresAt: Date.now() + 3600_000, // 1 hour from now
    tokenType: "Bearer",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAuthHeader returns current token if not near expiry", async () => {
    const mockClient = {
      refresh: vi.fn(),
    } as unknown as OAuthClient;

    const storage = new MemoryTokenStorage();
    const provider = new OAuthAuthProvider(mockClient, mockTokens, storage);

    const header = await provider.getAuthHeader();

    expect(header).toBe("Bearer access-token-123");
    expect(mockClient.refresh).not.toHaveBeenCalled();
  });

  it("getAuthHeader calls refresh and returns new token if within 60s expiry window", async () => {
    const expiringSoonTokens: OAuthTokens = {
      ...mockTokens,
      expiresAt: Date.now() + 30_000, // 30 seconds from now
    };

    const newTokens: OAuthTokens = {
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: Date.now() + 3600_000,
      tokenType: "Bearer",
    };

    const mockClient = {
      refresh: vi.fn().mockResolvedValue(newTokens),
    } as unknown as OAuthClient;

    const storage = new MemoryTokenStorage();
    const provider = new OAuthAuthProvider(mockClient, expiringSoonTokens, storage);

    const header = await provider.getAuthHeader();

    expect(mockClient.refresh).toHaveBeenCalledWith("refresh-token-456");
    expect(header).toBe("Bearer new-access-token");
  });
});
