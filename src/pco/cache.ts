export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Simple LRU + TTL cache. Bounded by maxEntries; least-recently-used
 * eviction when full. Per-entry TTL via expiresAt. Thread-safe is not
 * a concern here — Node runs JS single-threaded.
 */
export class LruTtlCache<T = unknown> {
  private readonly maxEntries: number;
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(opts: { maxEntries: number }) {
    this.maxEntries = opts.maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }

    // Bump to most recently used by delete + re-insert
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs;
    const entry: CacheEntry<T> = { value, expiresAt };

    // Remove if already exists (for LRU ordering)
    this.entries.delete(key);

    // Evict oldest if at capacity
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string;
      this.entries.delete(oldestKey);
    }

    this.entries.set(key, entry);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Number of entries currently held (post-expiry-prune). */
  size(): number {
    // Prune expired entries and return count
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.entries.delete(key);
    }

    return this.entries.size;
  }
}