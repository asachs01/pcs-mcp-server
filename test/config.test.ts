import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear PCO-related env vars for clean tests
    delete process.env.PCO_PAT_APP_ID;
    delete process.env.PCO_PAT_SECRET;
    delete process.env.PCO_OAUTH_CLIENT_ID;
    delete process.env.PCO_OAUTH_CLIENT_SECRET;
    delete process.env.PCO_DEFAULT_SERVICE_TYPE_ID;
    delete process.env.TRANSPORT;
    delete process.env.PORT;
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves PAT credentials when APP_ID and SECRET are present", () => {
    process.env.PCO_PAT_APP_ID = "test-app-id";
    process.env.PCO_PAT_SECRET = "test-secret";

    const config = loadConfig();

    expect(config.auth).toEqual({
      mode: "pat",
      appId: "test-app-id",
      secret: "test-secret",
    });
  });

  it("resolves OAuth credentials when CLIENT_ID and CLIENT_SECRET are present", () => {
    process.env.PCO_OAUTH_CLIENT_ID = "test-client-id";
    process.env.PCO_OAUTH_CLIENT_SECRET = "test-client-secret";

    const config = loadConfig();

    expect(config.auth).toEqual({
      mode: "oauth",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      redirectUri: "http://localhost:3000/callback", // default
    });
  });

  it("uses custom OAuth redirect URI when provided", () => {
    process.env.PCO_OAUTH_CLIENT_ID = "test-client-id";
    process.env.PCO_OAUTH_CLIENT_SECRET = "test-client-secret";
    process.env.PCO_OAUTH_REDIRECT_URI = "http://example.com/callback";

    const config = loadConfig();

    expect(config.auth).toEqual({
      mode: "oauth",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      redirectUri: "http://example.com/callback",
    });
  });

  it("throws when no credentials are present", () => {
    expect(() => loadConfig()).toThrow(
      "Planning Center credentials missing. Set PCO_PAT_APP_ID + PCO_PAT_SECRET (PAT) or PCO_OAUTH_CLIENT_ID + PCO_OAUTH_CLIENT_SECRET (OAuth)."
    );
  });

  it("prefers PAT when both PAT and OAuth credentials are present", () => {
    process.env.PCO_PAT_APP_ID = "pat-app";
    process.env.PCO_PAT_SECRET = "pat-secret";
    process.env.PCO_OAUTH_CLIENT_ID = "oauth-client";
    process.env.PCO_OAUTH_CLIENT_SECRET = "oauth-secret";

    const config = loadConfig();

    expect(config.auth.mode).toBe("pat");
  });

  it("applies CLI overrides for transport and port", () => {
    process.env.PCO_PAT_APP_ID = "test-app";
    process.env.PCO_PAT_SECRET = "test-secret";
    process.env.TRANSPORT = "stdio";
    process.env.PORT = "3000";

    const config = loadConfig(["--transport", "http", "--port", "4242"]);

    expect(config.transport).toBe("http");
    expect(config.port).toBe(4242);
  });

  it("uses environment defaults when CLI flags are not provided", () => {
    process.env.PCO_PAT_APP_ID = "test-app";
    process.env.PCO_PAT_SECRET = "test-secret";
    process.env.TRANSPORT = "http";
    process.env.PORT = "5000";
    process.env.LOG_LEVEL = "debug";

    const config = loadConfig();

    expect(config.transport).toBe("http");
    expect(config.port).toBe(5000);
    expect(config.logLevel).toBe("debug");
  });

  it("sets default service type ID when provided", () => {
    process.env.PCO_PAT_APP_ID = "test-app";
    process.env.PCO_PAT_SECRET = "test-secret";
    process.env.PCO_DEFAULT_SERVICE_TYPE_ID = "12345";

    const config = loadConfig();

    expect(config.defaults.serviceTypeId).toBe("12345");
  });

  it("uses built-in defaults for missing optional config", () => {
    process.env.PCO_PAT_APP_ID = "test-app";
    process.env.PCO_PAT_SECRET = "test-secret";

    const config = loadConfig();

    expect(config.transport).toBe("stdio");
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe("info");
    expect(config.defaults.serviceTypeId).toBeUndefined();
  });
});