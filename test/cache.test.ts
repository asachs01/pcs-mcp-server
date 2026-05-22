import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LruTtlCache } from "../src/pco/cache.js";

describe("LruTtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should store and retrieve values", () => {
    const cache = new LruTtlCache({ maxEntries: 10 });

    cache.set("key1", "value1", 1000);
    expect(cache.get("key1")).toBe("value1");
    expect(cache.size()).toBe(1);
  });

  it("should return undefined for non-existent keys", () => {
    const cache = new LruTtlCache({ maxEntries: 10 });

    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("should expire entries after TTL", () => {
    const cache = new LruTtlCache({ maxEntries: 10 });

    cache.set("key1", "value1", 10);
    expect(cache.get("key1")).toBe("value1");

    // Advance time past TTL
    vi.advanceTimersByTime(15);
    expect(cache.get("key1")).toBeUndefined();
  });

  it("should evict oldest entries when at max capacity", () => {
    const cache = new LruTtlCache({ maxEntries: 2 });

    cache.set("key1", "value1", 1000);
    cache.set("key2", "value2", 1000);
    cache.set("key3", "value3", 1000); // Should evict key1

    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBe("value2");
    expect(cache.get("key3")).toBe("value3");
    expect(cache.size()).toBe(2);
  });

  it("should implement LRU by bumping accessed entries to most recent", () => {
    const cache = new LruTtlCache({ maxEntries: 2 });

    cache.set("key1", "value1", 1000);
    cache.set("key2", "value2", 1000);

    // Access key1, making it most recent
    expect(cache.get("key1")).toBe("value1");

    // Add key3, should evict key2 (least recently used)
    cache.set("key3", "value3", 1000);

    expect(cache.get("key1")).toBe("value1"); // Still there
    expect(cache.get("key2")).toBeUndefined(); // Evicted
    expect(cache.get("key3")).toBe("value3"); // New entry
  });

  it("should delete entries", () => {
    const cache = new LruTtlCache({ maxEntries: 10 });

    cache.set("key1", "value1", 1000);
    expect(cache.get("key1")).toBe("value1");

    cache.delete("key1");
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("should clear all entries", () => {
    const cache = new LruTtlCache({ maxEntries: 10 });

    cache.set("key1", "value1", 1000);
    cache.set("key2", "value2", 1000);
    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBeUndefined();
  });

  it("should prune expired entries in size() method", () => {
    const cache = new LruTtlCache({ maxEntries: 10 });

    cache.set("key1", "value1", 10);
    cache.set("key2", "value2", 1000);
    expect(cache.size()).toBe(2);

    // Advance time to expire key1
    vi.advanceTimersByTime(15);
    expect(cache.size()).toBe(1); // Should prune expired key1

    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBe("value2");
  });

  it("should handle setting same key multiple times", () => {
    const cache = new LruTtlCache({ maxEntries: 2 });

    cache.set("key1", "value1", 1000);
    cache.set("key1", "value1-updated", 1000);

    expect(cache.get("key1")).toBe("value1-updated");
    expect(cache.size()).toBe(1);
  });

  it("should work with different value types", () => {
    const cache = new LruTtlCache<{ name: string; count: number }>({ maxEntries: 10 });

    const obj = { name: "test", count: 42 };
    cache.set("obj", obj, 1000);
    expect(cache.get("obj")).toEqual(obj);

    cache.set("num", 123 as any, 1000);
    expect(cache.get("num")).toBe(123);

    cache.set("bool", true as any, 1000);
    expect(cache.get("bool")).toBe(true);
  });
});