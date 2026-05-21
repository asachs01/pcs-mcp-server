// Sliding-window limiter. PCO allows N requests per windowMs; we record
// timestamps and gate acquire() on the oldest falling out of the window.
export class RateLimiter {
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly timestamps: number[] = [];

  constructor(opts: { capacity: number; windowMs: number }) {
    this.capacity = opts.capacity;
    this.windowMs = opts.windowMs;
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      // Drop expired timestamps.
      while (this.timestamps.length && now - this.timestamps[0]! > this.windowMs) {
        this.timestamps.shift();
      }
      if (this.timestamps.length < this.capacity) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0]!;
      const waitMs = this.windowMs - (now - oldest) + 5;
      await sleep(waitMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
