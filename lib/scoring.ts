import type { ReaderResult } from './ai/reader-schema';
import { foldIndicDigits } from './indic-digits';

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
  // Global: a range like "40-45 lakh" has the figure that matters at the END.
  return new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${escaped.join('|')})`, 'gi');
}

/** English number words a buyer might type instead of digits. */
const ONES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "forty five" -> 45, "fifteen" -> 15. Null when there is no number in words. */
function numberFromWords(text: string): number | null {
  const words = text.split(/[^a-z]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const tens = TENS[words[i]];
    if (tens !== undefined) {
      const ones = ONES[words[i + 1] ?? ''];
      return ones !== undefined && ones < 10 ? tens + ones : tens;
    }
    const ones = ONES[words[i]];
    if (ones !== undefined) return ones;
  }
  return null;
}

/** The LAST figure carrying a unit — the top of "40-45 lakh", which is the
 *  ceiling a buyer says he can stretch to, and what qualifying turns on. */
function lastMatch(pattern: RegExp, text: string): number | null {
  let value: number | null = null;
  for (const m of text.matchAll(pattern)) value = Number(m[1]);
  return value;
}

export function parseBudgetToRupees(budget: string | null | undefined): number | null {
  if (!budget) return null;
  const text = foldIndicDigits(String(budget)).toLowerCase().replace(/,/g, '');

  const crore = lastMatch(unitPattern(CRORE_WORDS), text);
  if (crore !== null) return Math.round(crore * 1_00_00_000);

  const lakh = lastMatch(unitPattern(LAKH_WORDS), text);
  if (lakh !== null) return Math.round(lakh * 1_00_000);

  // Bare "45L" — only after the word forms, so "45 lakh" never lands here.
  const shortL = /(\d+(?:\.\d+)?)\s*l\b/.exec(text);
  if (shortL) return Math.round(Number(shortL[1]) * 1_00_000);

  // Written out: "forty five lakh", "two crore".
  const spelled = numberFromWords(text);
  if (spelled !== null) {
    if (CRORE_WORDS.some((w) => text.includes(w))) return spelled * 1_00_00_000;
    if (LAKH_WORDS.some((w) => text.includes(w))) return spelled * 1_00_000;
  }

  const plain = /(\d{5,})/.exec(text);
  if (plain) return Number(plain[1]);

  /**
   * A bare number. On a plotted project "my budget is 45" means 45 lakh — no
   * buyer means forty-five rupees. Whole numbers only and not below five:
   * "1.5" and "3" are genuinely ambiguous between lakh and crore, and guessing
   * wrong there is worse than scoring nothing.
   */
  const bare = /^\s*(\d{1,3})\s*$/.exec(text);
  if (bare) {
    const n = Number(bare[1]);
    if (n >= 5) return n * 1_00_000;
  }

  return null;
}

/**
 * `entryPriceRupees` is null when we could not read the project's entry price.
 *
 * That must NOT become zero. The earlier version fell back to 0, and since
 * every budget is at or above zero, one unreadable price in the admin screen
 * silently awarded the budget points to every lead in the system — a ₹15 lakh
 * buyer scoring as though he could afford a ₹42 lakh plot, with nothing to show
 * anything had gone wrong. Not knowing the entry price means we cannot judge
 * the budget, so we award nothing and say so.
 */
export function scoreLead(facts: ReaderResult, entryPriceRupees: number | null): ScoreBreakdown {
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
  if (entryPriceRupees === null || entryPriceRupees <= 0) {
    if (budget !== null) {
      reasons.push({
        signal: 'Budget not judged — the project entry price could not be read',
        points: 0,
      });
    }
  } else if (budget !== null && budget >= entryPriceRupees) {
    add('Budget at or above entry price', 3);
  }

  if (facts.timeline === '0-3 months') add('Timeline 0–3 months', 3);
  else if (facts.timeline === '3-6 months') add('Timeline 3–6 months', 2);

  if (facts.asked_about_registration_or_possession) add('Asked about registration or possession', 2);
  if (facts.asked_about_specific_plot) add('Asked about a specific plot or dimension', 2);
  if (facts.asked_about_loan) add('Asked about plot loan', 1);
  if (facts.purpose) add('Purpose known', 1);

  const score = reasons.reduce((total, r) => total + r.points, 0);
  let category = categorise(score);

  const hasVisit = Boolean(facts.visit_agreed && facts.visit_datetime_iso);
  const canAffordIt =
    entryPriceRupees !== null && entryPriceRupees > 0 &&
    budget !== null && budget >= entryPriceRupees;

  /**
   * Two overrides on the table, both about the same thing: the table adds up
   * questions asked, and a man who has stopped asking and agreed to come is
   * past that.
   *
   * HOT is not a label, it is an instruction — a person rings him now. The
   * most valuable call in a plot business is the one that confirms tomorrow's
   * visit and arranges the pickup, so a buyer who has agreed a day AND can
   * afford the plot gets it, even though the table stops him at 8. He is not
   * promoted on the visit alone: without a budget we do not know he can buy.
   */
  if (hasVisit && canAffordIt && category !== 'HOT') {
    category = 'HOT';
    reasons.push({
      signal: 'Promoted to HOT: a confirmed visit from a buyer who can afford the plot',
      points: 0,
    });
  } else if (hasVisit && category === 'COLD') {
    // And a booked visit is never COLD. On the raw table a visit alone scores
    // 4, which would bury the one lead who should be near the top.
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
