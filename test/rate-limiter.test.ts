import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../src/pco/rate-limiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows capacity calls immediately", async () => {
    const limiter = new RateLimiter({ capacity: 3, windowMs: 1000 });

    const start = Date.now();

    // These should all complete immediately
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10); // Should be near-instant
  });

  it("blocks the (capacity+1)th call until window slides", async () => {
    const limiter = new RateLimiter({ capacity: 2, windowMs: 1000 });

    // Fill the capacity
    await limiter.acquire();
    await limiter.acquire();

    // Start the blocked call in background
    let resolved = false;
    const blockedPromise = limiter.acquire().then(() => {
      resolved = true;
    });

    // Advance time by half the window - should still be blocked
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(false);

    // Advance past the full window (plus a bit for the internal +5ms buffer)
    await vi.advanceTimersByTimeAsync(510);

    // Now it should resolve
    await blockedPromise;
    expect(resolved).toBe(true);
  });

  it("handles multiple blocked calls in sequence", async () => {
    const limiter = new RateLimiter({ capacity: 1, windowMs: 100 });

    // First call - immediate
    await limiter.acquire();

    // Second call - should block
    const promise1 = limiter.acquire();
    const promise2 = limiter.acquire();

    // Advance to unblock first call
    await vi.advanceTimersByTimeAsync(105);
    await promise1;

    // Advance to unblock second call
    await vi.advanceTimersByTimeAsync(105);
    await promise2;

    // Both should complete without throwing
    expect(true).toBe(true);
  });

  it("correctly expires old timestamps", async () => {
    const limiter = new RateLimiter({ capacity: 2, windowMs: 1000 });

    // Fill capacity
    await limiter.acquire();
    await limiter.acquire();

    // Advance time past the window
    await vi.advanceTimersByTimeAsync(1010);

    // Should be able to acquire immediately again
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(10);
  });
});
