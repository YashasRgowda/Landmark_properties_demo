import { describe, expect, it } from 'vitest';
import { categorise, parseBudgetToRupees, scoreLead } from '../lib/scoring';
import type { ReaderResult } from '../lib/ai/reader-schema';

/**
 * Scoring decides which buyer a salesperson rings first, so every row of the
 * spec's table is asserted here, along with the boundaries between categories
 * and the parsing bugs that silently moved leads between them.
 */

const L = 100_000;
const CR = 10_000_000;
const ENTRY = 42 * L;

/** A lead who has said nothing of note. */
const nothing: ReaderResult = {
  name: null, budget: null, timeline: null, purpose: null, interested_plot: null,
  language: 'english', asked_for_documents: false, asked_about_loan: false,
  asked_about_registration_or_possession: false, asked_about_specific_plot: false,
  visit_agreed: false, visit_datetime_iso: null, visit_label: null,
  disqualified: false, disqualify_reason: null, summary: '',
};
const withFacts = (over: Partial<ReaderResult>): ReaderResult => ({ ...nothing, ...over });
const VISIT = { visit_agreed: true, visit_datetime_iso: '2026-09-27T11:00:00+05:30' };

describe('every row of the spec table is worth what it says', () => {
  it.each([
    ['Visit agreed with a specific day', VISIT, 4],
    ['Asked for documents', { asked_for_documents: true }, 3],
    ['Budget at or above entry', { budget: '45 lakh' }, 3],
    ['Timeline 0-3 months', { timeline: '0-3 months' as const }, 3],
    ['Timeline 3-6 months', { timeline: '3-6 months' as const }, 2],
    ['Asked about registration', { asked_about_registration_or_possession: true }, 2],
    ['Asked about a specific plot', { asked_about_specific_plot: true }, 2],
    ['Asked about a loan', { asked_about_loan: true }, 1],
    ['Purpose known', { purpose: 'investment' as const }, 1],
  ])('%s = +%i', (_label, facts, points) => {
    expect(scoreLead(withFacts(facts), ENTRY).score).toBe(points);
  });

  it('scores nothing for a lead who revealed nothing', () => {
    expect(scoreLead(nothing, ENTRY).score).toBe(0);
  });

  it('never counts both timeline bands', () => {
    expect(scoreLead(withFacts({ timeline: '0-3 months' }), ENTRY).score).toBe(3);
    expect(scoreLead(withFacts({ timeline: '6+ months' }), ENTRY).score).toBe(0);
  });

  it('gives nothing for a budget below the entry price', () => {
    expect(scoreLead(withFacts({ budget: '30 lakh' }), ENTRY).score).toBe(0);
  });

  it('counts a budget exactly at the entry price', () => {
    expect(scoreLead(withFacts({ budget: '42 lakh' }), ENTRY).score).toBe(3);
  });

  it('reaches the maximum the table allows', () => {
    const everything = withFacts({
      ...VISIT, asked_for_documents: true, budget: '1 crore', timeline: '0-3 months',
      asked_about_registration_or_possession: true, asked_about_specific_plot: true,
      asked_about_loan: true, purpose: 'own_construction',
    });
    expect(scoreLead(everything, ENTRY).score).toBe(19);
    expect(scoreLead(everything, ENTRY).category).toBe('HOT');
  });
});

describe('the category boundaries', () => {
  it.each([
    [0, 'COLD'], [1, 'COLD'], [4, 'COLD'],
    [5, 'WARM'], [8, 'WARM'],
    [9, 'HOT'], [19, 'HOT'],
  ])('a score of %i is %s', (score, category) => {
    expect(categorise(score)).toBe(category);
  });

  it('a disqualified lead is REJECT whatever else he said', () => {
    const r = scoreLead(withFacts({
      ...VISIT, disqualified: true, disqualify_reason: 'broker',
      budget: '1 crore', asked_for_documents: true, timeline: '0-3 months',
    }), ENTRY);
    expect(r.category).toBe('REJECT');
    expect(r.score).toBe(0);
  });

  it('a booked visit is floored at WARM, never COLD', () => {
    const r = scoreLead(withFacts(VISIT), ENTRY);
    expect(r.score).toBe(4);
    expect(r.category).toBe('WARM');
  });
});

describe('THE SILENT BUG: an unreadable entry price', () => {
  // `?? 0` meant every budget was "at or above" zero, so one bad edit in the
  // admin screen handed +3 to every lead in the system.
  it('awards nothing rather than everything when the entry price is unknown', () => {
    const buyer = withFacts({ budget: '15 lakh' });
    expect(scoreLead(buyer, null).score).toBe(0);
    expect(scoreLead(buyer, 0).score).toBe(0);
  });

  it('says plainly why the budget was not judged', () => {
    const r = scoreLead(withFacts({ budget: '15 lakh' }), null);
    expect(r.reasons.some((x) => /entry price could not be read/.test(x.signal))).toBe(true);
  });

  it('does not complain when the lead never stated a budget', () => {
    expect(scoreLead(nothing, null).reasons).toEqual([]);
  });

  it('a rich buyer is not punished for our misconfiguration beyond the 3 points', () => {
    const r = scoreLead(withFacts({ ...VISIT, budget: '1 crore', asked_for_documents: true }), null);
    expect(r.score).toBe(7);   // 4 + 3, minus the budget points we cannot judge
  });
});

describe('reading a budget the way buyers actually write one', () => {
  it.each([
    ['₹45 lakh', 45 * L], ['45 lakh', 45 * L], ['45 lakhs', 45 * L], ['45 lac', 45 * L],
    ['45 lacs', 45 * L], ['45L', 45 * L], ['45 L', 45 * L], ['Rs. 45 lakh', 45 * L],
    ['45,00,000', 45 * L], ['4500000', 45 * L], ['45', 45 * L],
    ['1.4 crore', 1.4 * CR], ['1.4 cr', 1.4 * CR], ['2 crores', 2 * CR],
  ])('%s', (input, expected) => {
    expect(parseBudgetToRupees(input)).toBe(expected);
  });

  it('reads the unit in the buyer’s own language', () => {
    expect(parseBudgetToRupees('45 ಲಕ್ಷ')).toBe(45 * L);   // Kannada
    expect(parseBudgetToRupees('45 लाख')).toBe(45 * L);     // Hindi
    expect(parseBudgetToRupees('45 లక్ష')).toBe(45 * L);    // Telugu
    expect(parseBudgetToRupees('45 லட்சம்')).toBe(45 * L);  // Tamil
    expect(parseBudgetToRupees('1 ಕೋಟಿ')).toBe(CR);
  });

  it('reads the buyer’s own NUMERALS, not just his words', () => {
    expect(parseBudgetToRupees('೪೫ ಲಕ್ಷ')).toBe(45 * L);   // Kannada digits
    expect(parseBudgetToRupees('४५ लाख')).toBe(45 * L);     // Devanagari digits
    expect(parseBudgetToRupees('౪౫ లక్ష')).toBe(45 * L);    // Telugu digits
  });

  it('reads a budget written out in words', () => {
    expect(parseBudgetToRupees('forty five lakh')).toBe(45 * L);
    expect(parseBudgetToRupees('forty lakhs')).toBe(40 * L);
    expect(parseBudgetToRupees('fifteen lakh')).toBe(15 * L);
    expect(parseBudgetToRupees('two crore')).toBe(2 * CR);
  });

  it('takes the TOP of a range — the ceiling he says he can stretch to', () => {
    expect(parseBudgetToRupees('40-45 lakh')).toBe(45 * L);
    expect(parseBudgetToRupees('40 to 45 lakh')).toBe(45 * L);
    expect(parseBudgetToRupees('between 45 and 50 lakh')).toBe(50 * L);
  });

  it('refuses what it cannot honestly read', () => {
    for (const junk of ['', '   ', 'not sure', 'budget nahi pata', 'will decide later',
      'depends', null, undefined, 'good price']) {
      expect(parseBudgetToRupees(junk), String(junk)).toBeNull();
    }
  });

  it('refuses a bare number too small to mean lakhs unambiguously', () => {
    // "3" could be three lakh or three crore. Guessing is worse than nothing.
    expect(parseBudgetToRupees('3')).toBeNull();
    expect(parseBudgetToRupees('1.5')).toBeNull();
  });

  it('a missed budget is what costs a serious buyer his points', () => {
    // The regression this guards: Kannada numerals parsed as nothing, dropping
    // a qualified buyer three points and a whole category.
    const buyer = withFacts({ ...VISIT, budget: '೪೫ ಲಕ್ಷ', purpose: 'own_construction' });
    expect(scoreLead(buyer, ENTRY).score).toBe(8);
  });
});

describe('the score is stable and explainable', () => {
  it('gives the same answer every time for the same facts', () => {
    const buyer = withFacts({ ...VISIT, budget: '45 lakh', purpose: 'own_construction' });
    const runs = Array.from({ length: 5 }, () => scoreLead(buyer, ENTRY));
    expect(new Set(runs.map((r) => `${r.score}:${r.category}`)).size).toBe(1);
  });

  it('every point awarded is explained', () => {
    const r = scoreLead(withFacts({ ...VISIT, budget: '45 lakh', purpose: 'investment' }), ENTRY);
    expect(r.reasons.reduce((t, x) => t + x.points, 0)).toBe(r.score);
    expect(r.reasons.filter((x) => x.points > 0)).toHaveLength(3);
  });
});
