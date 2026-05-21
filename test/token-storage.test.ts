import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OAuthTokens } from "../src/pco/oauth.js";
import { MemoryTokenStorage, EnvTokenStorage, FileTokenStorage } from "../src/pco/token-storage.js";
import { OAuthAuthProvider } from "../src/pco/auth-provider.js";

const mockTokens: OAuthTokens = {
  accessToken: "access-123",
  refreshToken: "refresh-456",
  expiresAt: Date.now() + 3600000,
  tokenType: "Bearer",
};

describe("MemoryTokenStorage", () => {
  let storage: MemoryTokenStorage;

  beforeEach(() => {
    storage = new MemoryTokenStorage();
  });

  it("returns null when no tokens are stored", async () => {
    expect(await storage.load()).toBe(null);
  });

  it("round-trips tokens correctly", async () => {
    await storage.save(mockTokens);
    const loaded = await storage.load();
    expect(loaded).toEqual(mockTokens);
  });

  it("clears tokens", async () => {
    await storage.save(mockTokens);
    await storage.clear();
    expect(await storage.load()).toBe(null);
  });
});

describe("EnvTokenStorage", () => {
  let originalEnv: string | undefined;
  let storage: EnvTokenStorage;

  beforeEach(() => {
    originalEnv = process.env.PCO_OAUTH_TOKENS;
    delete process.env.PCO_OAUTH_TOKENS;
    storage = new EnvTokenStorage();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PCO_OAUTH_TOKENS = originalEnv;
    } else {
      delete process.env.PCO_OAUTH_TOKENS;
    }
  });

  it("loads from env var on construction", async () => {
    process.env.PCO_OAUTH_TOKENS = JSON.stringify(mockTokens);
    storage = new EnvTokenStorage();

    const loaded = await storage.load();
    expect(loaded).toEqual(mockTokens);
  });

  it("returns null when env var is not set", async () => {
    expect(await storage.load()).toBe(null);
  });

  it("returns null when env var contains invalid JSON", async () => {
    process.env.PCO_OAUTH_TOKENS = "invalid-json";
    storage = new EnvTokenStorage();

    expect(await storage.load()).toBe(null);
  });

  it("save updates internal cache", async () => {
    await storage.save(mockTokens);
    const loaded = await storage.load();
    expect(loaded).toEqual(mockTokens);
  });

  it("returns cached value after save", async () => {
    const tokens1 = { ...mockTokens, accessToken: "token1" };
    const tokens2 = { ...mockTokens, accessToken: "token2" };

    await storage.save(tokens1);
    expect(await storage.load()).toEqual(tokens1);

    await storage.save(tokens2);
    expect(await storage.load()).toEqual(tokens2);
  });

  it("clears cached tokens", async () => {
    await storage.save(mockTokens);
    await storage.clear();
    expect(await storage.load()).toBe(null);
  });
});

describe("FileTokenStorage", () => {
  let testDir: string;
  let storage: FileTokenStorage;

  beforeEach(async () => {
    testDir = join(tmpdir(), `pco-test-${Date.now()}-${Math.random()}`);
    await mkdir(testDir, { recursive: true });
    storage = new FileTokenStorage(join(testDir, "tokens.json"));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("returns null when file doesn't exist", async () => {
    expect(await storage.load()).toBe(null);
  });

  it("round-trips tokens correctly", async () => {
    await storage.save(mockTokens);
    const loaded = await storage.load();
    expect(loaded).toEqual(mockTokens);
  });

  it("produces files with mode 0600 on non-Windows", async () => {
    if (process.platform === "win32") {
      return; // Skip mode check on Windows
    }

    await storage.save(mockTokens);
    const stats = await stat(join(testDir, "tokens.json"));
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("creates directory if it doesn't exist", async () => {
    const nestedPath = join(testDir, "nested", "dir", "tokens.json");
    const nestedStorage = new FileTokenStorage(nestedPath);

    await nestedStorage.save(mockTokens);
    const loaded = await nestedStorage.load();
    expect(loaded).toEqual(mockTokens);
  });

  it("clears tokens by removing file", async () => {
    await storage.save(mockTokens);
    expect(await storage.load()).toEqual(mockTokens);

    await storage.clear();
    expect(await storage.load()).toBe(null);
  });

  it("handles clear when file doesn't exist", async () => {
    // Should not throw
    await storage.clear();
    expect(await storage.load()).toBe(null);
  });
});

describe("OAuthAuthProvider with TokenStorage", () => {
  let mockClient: any;
  let mockStorage: any;
  let provider: OAuthAuthProvider;

  beforeEach(() => {
    mockClient = {
      refresh: async (refreshToken: string) => {
        return {
          ...mockTokens,
          accessToken: "refreshed-access",
          expiresAt: Date.now() + 3600000,
        };
      },
    };

    mockStorage = {
      load: async () => null,
      save: async () => {},
      clear: async () => {},
    };
  });

  it("calls storage.save after a refresh", async () => {
    const expiredTokens = {
      ...mockTokens,
      expiresAt: Date.now() - 1000, // Expired
    };

    provider = new OAuthAuthProvider(mockClient, expiredTokens, mockStorage);

    let savedTokens: OAuthTokens | null = null;
    mockStorage.save = async (tokens: OAuthTokens) => {
      savedTokens = tokens;
    };

    await provider.getAuthHeader();

    expect(savedTokens).toEqual({
      ...mockTokens,
      accessToken: "refreshed-access",
      expiresAt: expect.any(Number),
    });
  });

  it("lazy-loads from storage when no initial tokens", async () => {
    mockStorage.load = async () => mockTokens;
    provider = new OAuthAuthProvider(mockClient, null, mockStorage);

    const header = await provider.getAuthHeader();
    expect(header).toBe(`Bearer ${mockTokens.accessToken}`);
  });

  it("throws error when no tokens available anywhere", async () => {
    mockStorage.load = async () => null;
    provider = new OAuthAuthProvider(mockClient, null, mockStorage);

    await expect(provider.getAuthHeader()).rejects.toThrow(
      "No OAuth tokens available. Run the authorize flow first."
    );
  });

  it("uses initial tokens without loading from storage", async () => {
    let loadCalled = false;
    mockStorage.load = async () => {
      loadCalled = true;
      return mockTokens;
    };

    provider = new OAuthAuthProvider(mockClient, mockTokens, mockStorage);

    const header = await provider.getAuthHeader();
    expect(header).toBe(`Bearer ${mockTokens.accessToken}`);
    expect(loadCalled).toBe(false);
  });
});