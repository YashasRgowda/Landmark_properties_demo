import { describe, expect, it } from 'vitest';
import { categorise, parseBudgetToRupees, scoreLead } from '@/lib/scoring';
import type { ReaderResult } from '@/lib/ai/reader-schema';

const ENTRY = 42_00_000; // ₹42 lakh

const blank: ReaderResult = {
  name: null, budget: null, timeline: null, purpose: null, interested_plot: null,
  language: 'english', asked_for_documents: false, asked_about_loan: false,
  asked_about_registration_or_possession: false, asked_about_specific_plot: false,
  visit_agreed: false, visit_datetime_iso: null, visit_label: null,
  disqualified: false, disqualify_reason: null, summary: '',
};

describe('parseBudgetToRupees', () => {
  it('reads Indian money the way buyers write it', () => {
    expect(parseBudgetToRupees('₹45 lakh')).toBe(45_00_000);
    expect(parseBudgetToRupees('45L')).toBe(45_00_000);
    expect(parseBudgetToRupees('50 lakhs')).toBe(50_00_000);
    expect(parseBudgetToRupees('1.4 crore')).toBe(1_40_00_000);
    expect(parseBudgetToRupees('1 Cr')).toBe(1_00_00_000);
    expect(parseBudgetToRupees('45,00,000')).toBe(45_00_000);
    expect(parseBudgetToRupees('4500000')).toBe(4500000);
  });

  it('understands the unit in the buyer\'s own language', () => {
    expect(parseBudgetToRupees('45 ಲಕ್ಷ')).toBe(45_00_000);      // Kannada
    expect(parseBudgetToRupees('₹45 ಲಕ್ಷ')).toBe(45_00_000);
    expect(parseBudgetToRupees('45 लाख')).toBe(45_00_000);        // Hindi
    expect(parseBudgetToRupees('45 లక్ష')).toBe(45_00_000);       // Telugu
    expect(parseBudgetToRupees('45 லட்சம்')).toBe(45_00_000);     // Tamil
    expect(parseBudgetToRupees('1.4 ಕೋಟಿ')).toBe(1_40_00_000);
    expect(parseBudgetToRupees('2 करोड़')).toBe(2_00_00_000);
  });

  it('a Kannada budget still earns its points', () => {
    expect(scoreLead({ ...blank, budget: '45 ಲಕ್ಷ' }, ENTRY).score).toBe(3);
  });

  it('returns null when there is no number', () => {
    expect(parseBudgetToRupees(null)).toBeNull();
    expect(parseBudgetToRupees('')).toBeNull();
    expect(parseBudgetToRupees('not sure yet')).toBeNull();
  });
});

describe('scoreLead', () => {
  it('rejects a disqualified lead outright', () => {
    const r = scoreLead({ ...blank, disqualified: true, disqualify_reason: 'broker' }, ENTRY);
    expect(r.category).toBe('REJECT');
    expect(r.score).toBe(0);
  });

  it('scores each signal exactly as the spec says', () => {
    expect(scoreLead({ ...blank, visit_agreed: true, visit_datetime_iso: '2026-10-04T11:00:00+05:30' }, ENTRY).score).toBe(4);
    expect(scoreLead({ ...blank, asked_for_documents: true }, ENTRY).score).toBe(3);
    expect(scoreLead({ ...blank, budget: '45 lakh' }, ENTRY).score).toBe(3);
    expect(scoreLead({ ...blank, timeline: '0-3 months' }, ENTRY).score).toBe(3);
    expect(scoreLead({ ...blank, timeline: '3-6 months' }, ENTRY).score).toBe(2);
    expect(scoreLead({ ...blank, asked_about_registration_or_possession: true }, ENTRY).score).toBe(2);
    expect(scoreLead({ ...blank, asked_about_specific_plot: true }, ENTRY).score).toBe(2);
    expect(scoreLead({ ...blank, asked_about_loan: true }, ENTRY).score).toBe(1);
    expect(scoreLead({ ...blank, purpose: 'investment' }, ENTRY).score).toBe(1);
  });

  it('does not give budget points below the entry price', () => {
    expect(scoreLead({ ...blank, budget: '30 lakh' }, ENTRY).score).toBe(0);
    expect(scoreLead({ ...blank, budget: '42 lakh' }, ENTRY).score).toBe(3);
  });

  it('does not count a visit agreed without a real date', () => {
    expect(scoreLead({ ...blank, visit_agreed: true, visit_datetime_iso: null }, ENTRY).score).toBe(0);
  });

  it('marks a serious buyer HOT', () => {
    const hot = scoreLead({
      ...blank,
      visit_agreed: true, visit_datetime_iso: '2026-10-04T11:00:00+05:30',
      asked_for_documents: true, budget: '45 lakh', timeline: '0-3 months',
      purpose: 'own_construction',
    }, ENTRY);
    expect(hot.score).toBe(14);
    expect(hot.category).toBe('HOT');
  });

  it('marks a mildly interested buyer WARM', () => {
    const warm = scoreLead({ ...blank, asked_for_documents: true, timeline: '3-6 months' }, ENTRY);
    expect(warm.score).toBe(5);
    expect(warm.category).toBe('WARM');
  });

  it('marks a browser COLD', () => {
    expect(scoreLead({ ...blank, asked_about_loan: true }, ENTRY).category).toBe('COLD');
  });

  it('explains itself', () => {
    const r = scoreLead({ ...blank, asked_for_documents: true, timeline: '0-3 months' }, ENTRY);
    expect(r.reasons.map((x) => x.points)).toEqual([3, 3]);
  });
});

describe('categorise', () => {
  it('uses the spec thresholds', () => {
    expect(categorise(9)).toBe('HOT');
    expect(categorise(20)).toBe('HOT');
    expect(categorise(8)).toBe('WARM');
    expect(categorise(5)).toBe('WARM');
    expect(categorise(4)).toBe('COLD');
    expect(categorise(1)).toBe('COLD');
    expect(categorise(0)).toBe('COLD');
  });
});
