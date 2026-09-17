import { describe, expect, it } from 'vitest';
import { backoffMs, MAX_ATTEMPTS } from '@/lib/queue-policy';

const MIN = 60_000;

describe('backoffMs', () => {
  it('waits 1 min, then 5 min, then 30 min', () => {
    expect(backoffMs(1)).toBe(1 * MIN);
    expect(backoffMs(2)).toBe(5 * MIN);
    expect(backoffMs(3)).toBe(30 * MIN);
  });

  it('holds at 30 min for later attempts', () => {
    expect(backoffMs(4)).toBe(30 * MIN);
    expect(backoffMs(99)).toBe(30 * MIN);
  });

  it('never returns zero or a negative delay', () => {
    for (const n of [-5, 0, 1, 2, 3, 4, 10]) {
      expect(backoffMs(n), `attempts=${n}`).toBeGreaterThan(0);
    }
  });

  it('gives up after 5 attempts', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });
});
