import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PcoClient } from "../../src/pco/client.js";
import { LruTtlCache } from "../../src/pco/cache.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockAuthProvider = {
  getAuthHeader: vi.fn().mockResolvedValue("Bearer mock-token"),
};

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("PcoClient cache integration", () => {
  let client: PcoClient;
  let cache: LruTtlCache<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new LruTtlCache({ maxEntries: 100 });
    client = new PcoClient(mockAuthProvider, mockLogger, {
      rateLimitCapacity: 1000, // High limit to avoid rate limiting in tests
      rateLimitWindowMs: 1000,
      cache,
    });

    mockFetch.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: "1", type: "service_type" }] }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should cache GET responses and avoid duplicate requests", async () => {
    // First call - should hit the API
    const result1 = await client.get("/services/v2/service_types", undefined, { ttlMs: 60_000 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result1).toEqual({ data: [{ id: "1", type: "service_type" }] });

    // Second identical call - should hit cache, not API
    const result2 = await client.get("/services/v2/service_types", undefined, { ttlMs: 60_000 });
    expect(mockFetch).toHaveBeenCalledTimes(1); // Still only called once
    expect(result2).toEqual({ data: [{ id: "1", type: "service_type" }] });

    // Cache should have the entry
    expect(cache.size()).toBe(1);
  });

  it("should invalidate cache on POST/PATCH/DELETE operations", async () => {
    // Set up cache with a GET request
    await client.get("/services/v2/service_types", undefined, { ttlMs: 60_000 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(cache.size()).toBe(1);

    // Mock POST response
    mockFetch.mockResolvedValueOnce({
      status: 201,
      text: async () => JSON.stringify({ data: { id: "new", type: "service_type" } }),
    });

    // POST operation should invalidate cache
    await client.post("/services/v2/service_types/1/plans", { title: "New Plan" });
    expect(cache.size()).toBe(0); // Cache should be cleared

    // Next GET should hit API again
    mockFetch.mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: "1", type: "service_type" }, { id: "2", type: "service_type" }] }),
    });

    const result = await client.get("/services/v2/service_types", undefined, { ttlMs: 60_000 });
    expect(mockFetch).toHaveBeenCalledTimes(3); // Initial GET, POST, then new GET
    expect(result).toEqual({ data: [{ id: "1", type: "service_type" }, { id: "2", type: "service_type" }] });
  });

  it("should not cache when cache option is not provided", async () => {
    // First call without cache option
    await client.get("/services/v2/service_types");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call without cache option - should hit API again
    await client.get("/services/v2/service_types");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Cache should remain empty
    expect(cache.size()).toBe(0);
  });

  it("should not cache when client has no cache configured", async () => {
    const clientWithoutCache = new PcoClient(mockAuthProvider, mockLogger, {
      rateLimitCapacity: 1000,
      rateLimitWindowMs: 1000,
      // No cache provided
    });

    // Calls with cache option should still work but not cache
    await clientWithoutCache.get("/services/v2/service_types", undefined, { ttlMs: 60_000 });
    await clientWithoutCache.get("/services/v2/service_types", undefined, { ttlMs: 60_000 });

    expect(mockFetch).toHaveBeenCalledTimes(2); // Both calls hit the API
  });

  it("should differentiate cache entries by query parameters", async () => {
    // First call with different query params
    await client.get("/services/v2/service_types", { include: "plans" }, { ttlMs: 60_000 });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call with different query params - should hit API
    await client.get("/services/v2/service_types", { include: "songs" }, { ttlMs: 60_000 });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Third call matching first query - should hit cache
    await client.get("/services/v2/service_types", { include: "plans" }, { ttlMs: 60_000 });
    expect(mockFetch).toHaveBeenCalledTimes(2); // No additional API call

    expect(cache.size()).toBe(2); // Two different cache entries
  });

  it("should handle cache TTL expiration", async () => {
    vi.useFakeTimers();

    // Set short TTL
    await client.get("/services/v2/service_types", undefined, { ttlMs: 100 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(cache.size()).toBe(1);

    // Advance time past TTL
    vi.advanceTimersByTime(150);

    // Next call should hit API again due to expiration
    await client.get("/services/v2/service_types", undefined, { ttlMs: 100 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});