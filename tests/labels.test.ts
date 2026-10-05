import { describe, expect, it } from 'vitest';
import { CALL_REASON, LEAD_STATUS, callReason, category, initials, leadStatus, relativeTime, sourceName } from '../lib/labels';
import { CALL_REASONS, LEAD_STATUSES } from '../lib/db/schema';

const NOW = new Date('2026-10-05T12:00:00Z');

describe('plain-language labels', () => {
  it('every lead status has a plain label — none can leak through raw', () => {
    for (const s of LEAD_STATUSES) expect(LEAD_STATUS[s], s).toBeDefined();
  });
  it('every call reason is a full sentence', () => {
    for (const r of CALL_REASONS) {
      expect(CALL_REASON[r], r).toBeDefined();
      expect(CALL_REASON[r].label.split(' ').length, r).toBeGreaterThanOrEqual(3);
    }
  });
  it('no label shows an underscore or shouting capitals', () => {
    for (const s of LEAD_STATUSES) expect(leadStatus(s).label).not.toMatch(/_|^[A-Z ]{4,}$/);
  });
  it('an unknown value still reads like words', () => {
    expect(leadStatus('SOME_NEW_THING').label).toBe('Some New Thing');
    expect(callReason('ODD_REASON').label).toBe('Odd Reason');
  });
  it('an unscored lead says New, not blank', () => {
    expect(category(null).label).toBe('New');
  });
  it('portal names are written properly', () => {
    expect(sourceName('magicbricks')).toBe('MagicBricks');
    expect(sourceName('unknownportal')).toBe('Unknownportal');
  });
});

describe('time, the way people say it', () => {
  it.each([
    [new Date(NOW.getTime() - 20_000), 'just now'],
    [new Date(NOW.getTime() - 5 * 60_000), '5 minutes ago'],
    [new Date(NOW.getTime() + 10 * 60_000), 'in 10 minutes'],
    [new Date(NOW.getTime() - 3 * 3_600_000), '3 hours ago'],
    [new Date(NOW.getTime() - 26 * 3_600_000), 'yesterday'],
    [new Date(NOW.getTime() + 26 * 3_600_000), 'tomorrow'],
    [new Date(NOW.getTime() - 5 * 86_400_000), '5 days ago'],
  ])('%s', (at, expected) => {
    expect(relativeTime(at, NOW)).toBe(expected);
  });
});

describe('avatar initials', () => {
  it.each([['Priya Sharma', 'PS'], ['Rajesh (broker)', 'RB'], ['Arjun', 'A'], [null, '?'], ['  ', '?']])('%s', (n, e) => {
    expect(initials(n)).toBe(e);
  });
});
