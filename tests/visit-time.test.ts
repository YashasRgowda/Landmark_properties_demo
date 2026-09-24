import { describe, expect, it } from 'vitest';
import {
  checkVisitTime,
  describeVisit,
  foldDigits,
  fromIst,
  istParts,
  parseVisitIso,
  timeFromLabel,
} from '../lib/visit-time';

/** A fixed "now": Thursday 24 September 2026, 12:00 IST. */
const NOW = fromIst(2026, 8, 24, 12, 0);
const at = (h: number, m = 0, day = 26) => fromIst(2026, 8, day, h, m).toISOString();

describe('parsing whatever the model returns', () => {
  it('reads a proper IST timestamp', () => {
    const r = parseVisitIso('2026-09-26T17:00:00+05:30');
    expect('at' in r && istParts(r.at).hour).toBe(17);
  });

  it('reads the offset written without a colon', () => {
    const r = parseVisitIso('2026-09-26T17:00:00+0530');
    expect('at' in r && istParts(r.at).hour).toBe(17);
  });

  it('reads a UTC timestamp and converts it', () => {
    const r = parseVisitIso('2026-09-26T11:30:00Z');
    expect('at' in r && istParts(r.at).hour).toBe(17);
  });

  it('treats a timestamp with NO offset as India, not as the server zone', () => {
    // The bug this prevents: on a UTC host, bare "17:00" would become 22:30 IST.
    const r = parseVisitIso('2026-09-26T17:00:00');
    expect('at' in r && istParts(r.at).hour).toBe(17);
  });

  it('handles a space instead of T, and a missing seconds field', () => {
    expect('at' in parseVisitIso('2026-09-26 17:00')).toBe(true);
  });

  it('refuses a date with no clock time', () => {
    expect(parseVisitIso('2026-09-26')).toEqual({ error: 'no_time_given' });
  });

  it('refuses prose, empty strings and nonsense', () => {
    for (const bad of ['', '   ', 'Saturday', 'next week', 'null', '2026-13-45T99:99:00+05:30']) {
      expect(parseVisitIso(bad)).toHaveProperty('error');
    }
  });
});

describe('the clock time inside the label', () => {
  it.each([
    ['Saturday 5 PM', 17, 0],
    ['saturday 5pm', 17, 0],
    ['Sunday 11 AM', 11, 0],
    ['Sunday 11:30 AM', 11, 30],
    ['this Saturday at 4.30 p.m.', 16, 30],
    ['Sat 12 PM', 12, 0],
    ['Sat 12 AM', 0, 0],
    ['Sunday 17:00', 17, 0],
  ])('reads %s', (label, hour, minute) => {
    expect(timeFromLabel(label)).toEqual({ hour, minute });
  });

  it('reads Kannada numerals', () => {
    expect(timeFromLabel('ಭಾನುವಾರ ೧೧ AM')).toEqual({ hour: 11, minute: 0 });
  });

  it('gives up when the label has no time', () => {
    for (const label of ['Sunday', 'this weekend', '', null, undefined, 'ಭಾನುವಾರ']) {
      expect(timeFromLabel(label)).toBeNull();
    }
  });

  it('does not mistake a date or a plot size for a time', () => {
    expect(timeFromLabel('30x40 site')).toBeNull();
    expect(timeFromLabel('26/09/2026')).toBeNull();
  });
});

describe('folding Indic digits', () => {
  it('folds every supported script', () => {
    expect(foldDigits('೧೧')).toBe('11');   // Kannada
    expect(foldDigits('౧౧')).toBe('11');   // Telugu
    expect(foldDigits('११')).toBe('11');   // Devanagari
    expect(foldDigits('௧௧')).toBe('11');   // Tamil
  });

  it('leaves everything else alone', () => {
    expect(foldDigits('Sunday 11 AM')).toBe('Sunday 11 AM');
  });
});

describe('the booking gate', () => {
  it('accepts a normal afternoon slot', () => {
    const r = checkVisitTime(at(17), { label: 'Saturday 5 PM', now: NOW });
    expect(r.ok).toBe(true);
    expect(r.ok && r.istHour).toBe(17);
  });

  it('THE BUG: the label overrules a disagreeing timestamp', () => {
    // Buyer settled on 5 PM; the model reported his earlier 6 PM suggestion.
    const r = checkVisitTime(at(18), { label: 'Saturday 5 PM', now: NOW });
    expect(r.ok).toBe(true);
    expect(r.ok && r.istHour).toBe(17);
    expect(r.ok && r.correctedFromLabel).toBe(true);
  });

  it('leaves the timestamp alone when the label agrees', () => {
    const r = checkVisitTime(at(17), { label: 'Saturday 5 PM', now: NOW });
    expect(r.ok && r.correctedFromLabel).toBe(false);
  });

  it('leaves the timestamp alone when the label has no time in it', () => {
    const r = checkVisitTime(at(17), { label: 'Saturday', now: NOW });
    expect(r.ok && r.istHour).toBe(17);
    expect(r.ok && r.correctedFromLabel).toBe(false);
  });

  it('refuses the past', () => {
    expect(checkVisitTime(at(11, 0, 20), { now: NOW })).toEqual({ ok: false, reason: 'in_the_past' });
  });

  it('refuses a time that has just gone by today', () => {
    expect(checkVisitTime(at(11, 0, 24), { now: NOW })).toEqual({ ok: false, reason: 'in_the_past' });
  });

  it('accepts later today', () => {
    expect(checkVisitTime(at(16, 0, 24), { now: NOW }).ok).toBe(true);
  });

  it('refuses a hallucinated year', () => {
    const r = checkVisitTime(fromIst(2027, 8, 26, 17, 0).toISOString(), { now: NOW });
    expect(r).toEqual({ ok: false, reason: 'too_far_ahead' });
  });

  it('refuses before the gate opens', () => {
    expect(checkVisitTime(at(9, 30), { now: NOW })).toEqual({ ok: false, reason: 'before_opening' });
    expect(checkVisitTime(at(7, 0), { now: NOW })).toEqual({ ok: false, reason: 'before_opening' });
  });

  it('refuses after the gate shuts', () => {
    expect(checkVisitTime(at(18, 30), { now: NOW })).toEqual({ ok: false, reason: 'after_closing' });
    expect(checkVisitTime(at(21, 0), { now: NOW })).toEqual({ ok: false, reason: 'after_closing' });
  });

  it('accepts both boundaries exactly', () => {
    expect(checkVisitTime(at(10, 0), { now: NOW }).ok).toBe(true);
    expect(checkVisitTime(at(18, 0), { now: NOW }).ok).toBe(true);
  });

  it('a label cannot push a visit outside site hours', () => {
    // "Saturday 8 PM" must be refused, not quietly booked at the model's time.
    expect(checkVisitTime(at(17), { label: 'Saturday 8 PM', now: NOW }))
      .toEqual({ ok: false, reason: 'after_closing' });
  });

  it('a label cannot drag a visit into the past', () => {
    expect(checkVisitTime(at(16, 0, 24), { label: 'today 11 AM', now: NOW }))
      .toEqual({ ok: false, reason: 'in_the_past' });
  });

  it('honours site hours that differ from the default', () => {
    expect(checkVisitTime(at(9, 0), { now: NOW, openHour: 8 }).ok).toBe(true);
    expect(checkVisitTime(at(17, 0), { now: NOW, closeHour: 16 }))
      .toEqual({ ok: false, reason: 'after_closing' });
  });

  it('passes every rejection reason through rather than throwing', () => {
    for (const bad of ['', 'sometime', '2026-09-26']) {
      const r = checkVisitTime(bad, { now: NOW });
      expect(r.ok).toBe(false);
    }
  });
});

describe('describing a visit back to a human', () => {
  it('names the right day and a 12-hour time', () => {
    expect(describeVisit(fromIst(2026, 8, 26, 17, 0))).toBe('Saturday, 26 September at 5:00 PM');
  });

  it('handles noon and midnight without saying 0:00', () => {
    expect(describeVisit(fromIst(2026, 8, 26, 12, 0))).toContain('12:00 PM');
    expect(describeVisit(fromIst(2026, 8, 26, 0, 30))).toContain('12:30 AM');
  });

  it('does not slip a day at the UTC boundary', () => {
    // 10 AM IST on the 26th is 04:30 UTC — still the 26th in India.
    expect(describeVisit(fromIst(2026, 8, 26, 10, 0))).toContain('26 September');
  });
});
