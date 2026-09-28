import { describe, expect, it } from 'vitest';
import { LIMITS, clientIp, retryAfterSeconds, windowStart } from '../lib/rate-limit-policy';

describe('rate limit windows', () => {
  it('every request in the same minute shares a window', () => {
    const a = windowStart(new Date('2026-09-29T10:00:05Z'), 60_000);
    const b = windowStart(new Date('2026-09-29T10:00:59Z'), 60_000);
    expect(a.getTime()).toBe(b.getTime());
  });

  it('the next minute is a new window', () => {
    const a = windowStart(new Date('2026-09-29T10:00:59Z'), 60_000);
    const b = windowStart(new Date('2026-09-29T10:01:00Z'), 60_000);
    expect(b.getTime() - a.getTime()).toBe(60_000);
  });

  it('says how long to wait, never zero', () => {
    expect(retryAfterSeconds(new Date('2026-09-29T10:00:45Z'), 60_000)).toBe(15);
    expect(retryAfterSeconds(new Date('2026-09-29T10:00:59.900Z'), 60_000)).toBe(1);
  });
});

describe('who is asking', () => {
  it('takes the first address the proxy lists — the real client', () => {
    expect(clientIp('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
  });
  it('falls back to the real-ip header, then to "unknown"', () => {
    expect(clientIp(null, '198.51.100.2')).toBe('198.51.100.2');
    expect(clientIp('', '')).toBe('unknown');
  });
});

describe('the limits themselves', () => {
  it('a portal stuck in a loop is stopped after 5 posts of one buyer a minute', () => {
    expect(LIMITS.intakePerPhone.limit).toBe(5);
  });
  it('password guessing is capped per account and per address', () => {
    expect(LIMITS.loginPerEmail.limit).toBeLessThanOrEqual(10);
    expect(LIMITS.loginPerIp.windowMs).toBe(15 * 60_000);
  });
  it('no limit is so tight that a busy real day would trip it', () => {
    expect(LIMITS.intakeGlobal.limit).toBeGreaterThanOrEqual(100);
    expect(LIMITS.intakePerIp.limit).toBeGreaterThanOrEqual(30);
  });
});
