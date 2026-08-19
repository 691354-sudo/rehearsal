export class LoginRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit = 10,
    private readonly windowMs = 15 * 60 * 1_000,
  ) {}

  blocked(key: string, now = Date.now()) {
    const recent = this.recent(key, now);
    return {
      blocked: recent.length >= this.limit,
      retryAfterSeconds: recent.length
        ? Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1_000))
        : 0,
    };
  }

  fail(key: string, now = Date.now()) {
    const recent = this.recent(key, now);
    recent.push(now);
    this.attempts.set(key, recent);
  }

  clear(key: string) {
    this.attempts.delete(key);
  }

  private recent(key: string, now: number) {
    const threshold = now - this.windowMs;
    const recent = (this.attempts.get(key) || []).filter((timestamp) => timestamp > threshold);
    if (recent.length) this.attempts.set(key, recent);
    else this.attempts.delete(key);
    return recent;
  }
}
