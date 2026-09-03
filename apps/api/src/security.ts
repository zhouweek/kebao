import { timingSafeEqual } from "node:crypto";

export function maskPhone(phone: string): string {
  const value = phone.trim();
  if (value.length <= 4) return "*".repeat(value.length);
  if (value.length <= 7) {
    return `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`;
  }
  return `${value.slice(0, 3)}${"*".repeat(value.length - 7)}${value.slice(-4)}`;
}

export function safeTokenEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly records = new Map<string, RateLimitRecord>();

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const current = this.now();
    const previous = this.records.get(key);
    const record =
      !previous || previous.resetAt <= current
        ? { count: 0, resetAt: current + this.windowMs }
        : previous;
    record.count += 1;
    this.records.set(key, record);
    if (this.records.size > 10_000) {
      for (const [recordKey, item] of this.records) {
        if (item.resetAt <= current) this.records.delete(recordKey);
      }
    }
    return {
      allowed: record.count <= this.maximum,
      remaining: Math.max(0, this.maximum - record.count),
      resetAt: record.resetAt,
    };
  }
}
