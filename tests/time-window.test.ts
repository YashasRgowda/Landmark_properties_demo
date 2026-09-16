import { describe, expect, it } from 'vitest';
import { callsAllowed, currentWindow, nextOfficeOpen } from '@/lib/time-window';

/** IST is UTC+05:30 all year — no daylight saving to worry about. */
const ist = (s: string) => new Date(`${s}+05:30`);

describe('currentWindow', () => {
  it('matches the acceptance test', () => {
    expect(currentWindow(ist('2026-09-03T23:00:00'))).toBe('NIGHT');
    expect(currentWindow(ist('2026-09-03T14:00:00'))).toBe('OFFICE');
  });

  it('places each hour of the day in the right window', () => {
    const cases: [string, string][] = [
      ['00:00:00', 'NIGHT'],
      ['03:00:00', 'NIGHT'],
      ['09:29:59', 'NIGHT'],
      ['09:30:00', 'OFFICE'], // office opens
      ['12:00:00', 'OFFICE'],
      ['18:59:59', 'OFFICE'],
      ['19:00:00', 'EVENING'], // office shuts, ringing still fine
      ['20:59:59', 'EVENING'],
      ['21:00:00', 'NIGHT'], // nobody rings anybody
      ['23:59:59', 'NIGHT'],
    ];
    for (const [time, expected] of cases) {
      expect(currentWindow(ist(`2026-09-03T${time}`)), time).toBe(expected);
    }
  });

  it('reads the IST clock, not the machine clock', () => {
    // 20:00 UTC on 3 Sep is 01:30 IST on 4 Sep — night, not evening.
    expect(currentWindow(new Date('2026-09-03T20:00:00Z'))).toBe('NIGHT');
    // 08:30 UTC is 14:00 IST — office.
    expect(currentWindow(new Date('2026-09-03T08:30:00Z'))).toBe('OFFICE');
  });
});

describe('callsAllowed', () => {
  it('forbids calls at night and allows them otherwise', () => {
    expect(callsAllowed(ist('2026-09-03T23:00:00'))).toBe(false);
    expect(callsAllowed(ist('2026-09-03T07:00:00'))).toBe(false);
    expect(callsAllowed(ist('2026-09-03T14:00:00'))).toBe(true);
    expect(callsAllowed(ist('2026-09-03T20:00:00'))).toBe(true);
  });
});

describe('nextOfficeOpen', () => {
  it('returns 9:30 AM IST, which is 04:00 UTC', () => {
    expect(nextOfficeOpen(ist('2026-09-03T23:00:00')).toISOString()).toBe(
      '2026-09-04T04:00:00.000Z',
    );
  });

  it('parks a late-night lead on this morning, not tomorrow', () => {
    // 02:00 IST on 4 Sep — the 9:30 that morning has not happened yet.
    expect(nextOfficeOpen(ist('2026-09-04T02:00:00')).toISOString()).toBe(
      '2026-09-04T04:00:00.000Z',
    );
  });

  it('rolls to tomorrow once today 9:30 has passed', () => {
    expect(nextOfficeOpen(ist('2026-09-03T14:00:00')).toISOString()).toBe(
      '2026-09-04T04:00:00.000Z',
    );
    expect(nextOfficeOpen(ist('2026-09-03T20:00:00')).toISOString()).toBe(
      '2026-09-04T04:00:00.000Z',
    );
  });

  it('is strictly in the future at the boundary', () => {
    const at = ist('2026-09-03T09:30:00');
    const next = nextOfficeOpen(at);
    expect(next.getTime()).toBeGreaterThan(at.getTime());
    expect(next.toISOString()).toBe('2026-09-04T04:00:00.000Z');

    expect(nextOfficeOpen(ist('2026-09-03T09:29:59')).toISOString()).toBe(
      '2026-09-03T04:00:00.000Z',
    );
  });

  it('crosses month and year ends', () => {
    expect(nextOfficeOpen(ist('2026-09-30T23:00:00')).toISOString()).toBe(
      '2026-10-01T04:00:00.000Z',
    );
    expect(nextOfficeOpen(ist('2026-12-31T23:00:00')).toISOString()).toBe(
      '2027-01-01T04:00:00.000Z',
    );
  });

  it('always lands inside the OFFICE window', () => {
    for (let hour = 0; hour < 24; hour++) {
      const at = ist(`2026-09-03T${String(hour).padStart(2, '0')}:15:00`);
      expect(currentWindow(nextOfficeOpen(at)), `from ${hour}:15`).toBe('OFFICE');
    }
  });
});
