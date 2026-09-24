import type { ReaderResult } from './ai/reader-schema';

/**
 * Scoring is code, never the AI (golden rule 1 and 2). The Reader reports what
 * the buyer said; this decides what it is worth. Same facts in, same score out,
 * every time — and it can be argued with by a human.
 */

export type Category = 'HOT' | 'WARM' | 'COLD' | 'REJECT';

export type ScoreBreakdown = {
  score: number;
  category: Category;
  reasons: { signal: string; points: number }[];
};

/**
 * Turn "₹45 lakh", "45L", "45 ಲಕ್ಷ", "45 लाख" into rupees.
 *
 * Buyers in this corridor write the unit in their own language far more often
 * than in English, so every script we reply in must also be understood here —
 * a missed budget silently costs the lead 3 points and can drop a serious
 * buyer from WARM to COLD.
 */
const LAKH_WORDS = [
  'lakh', 'lakhs', 'lac', 'lacs',
  'ಲಕ್ಷ', 'ಲಕ್ಷಗಳು',       // Kannada
  'लाख',                     // Hindi / Marathi
  'లక్ష', 'లక్షలు',           // Telugu
  'லட்சம்', 'லட்சங்கள்',      // Tamil
];

const CRORE_WORDS = [
  'crore', 'crores', 'cr',
  'ಕೋಟಿ',                    // Kannada
  'करोड़', 'करोड',            // Hindi
  'కోటి',                     // Telugu
  'கோடி',                     // Tamil
];

function unitPattern(words: string[]): RegExp {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${escaped.join('|')})`, 'i');
}

export function parseBudgetToRupees(budget: string | null | undefined): number | null {
  if (!budget) return null;
  const text = String(budget).toLowerCase().replace(/,/g, '');

  const crore = unitPattern(CRORE_WORDS).exec(text);
  if (crore) return Math.round(Number(crore[1]) * 1_00_00_000);

  const lakh = unitPattern(LAKH_WORDS).exec(text);
  if (lakh) return Math.round(Number(lakh[1]) * 1_00_000);

  // Bare "45L" — only after the word forms, so "45 lakh" never lands here.
  const shortL = /(\d+(?:\.\d+)?)\s*l\b/.exec(text);
  if (shortL) return Math.round(Number(shortL[1]) * 1_00_000);

  const plain = /(\d{5,})/.exec(text);
  if (plain) return Number(plain[1]);

  return null;
}

export function scoreLead(facts: ReaderResult, entryPriceRupees: number): ScoreBreakdown {
  if (facts.disqualified) {
    return {
      score: 0,
      category: 'REJECT',
      reasons: [{ signal: facts.disqualify_reason || 'not a buyer', points: 0 }],
    };
  }

  const reasons: ScoreBreakdown['reasons'] = [];
  const add = (signal: string, points: number) => {
    if (points > 0) reasons.push({ signal, points });
  };

  if (facts.visit_agreed && facts.visit_datetime_iso) add('Visit agreed with a specific day', 4);
  if (facts.asked_for_documents) add('Asked for khata / DC / approval documents', 3);

  const budget = parseBudgetToRupees(facts.budget);
  if (budget !== null && budget >= entryPriceRupees) add('Budget at or above entry price', 3);

  if (facts.timeline === '0-3 months') add('Timeline 0–3 months', 3);
  else if (facts.timeline === '3-6 months') add('Timeline 3–6 months', 2);

  if (facts.asked_about_registration_or_possession) add('Asked about registration or possession', 2);
  if (facts.asked_about_specific_plot) add('Asked about a specific plot or dimension', 2);
  if (facts.asked_about_loan) add('Asked about plot loan', 1);
  if (facts.purpose) add('Purpose known', 1);

  const score = reasons.reduce((total, r) => total + r.points, 0);
  let category = categorise(score);

  // A man who has agreed a day and an hour to come and stand on the plot is not
  // a cold lead, whatever else he has or has not said. On the raw table a visit
  // alone scores 4, which lands in COLD and buries him at the bottom of the
  // agent's list — the one lead who should be at the top.
  if (facts.visit_agreed && facts.visit_datetime_iso && category === 'COLD') {
    category = 'WARM';
    reasons.push({ signal: 'Floor applied: a booked visit is never COLD', points: 0 });
  }

  return { score, category, reasons };
}

export function categorise(score: number): Category {
  if (score >= 9) return 'HOT';
  if (score >= 5) return 'WARM';
  if (score >= 1) return 'COLD';
  return 'COLD';
}
