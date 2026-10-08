import { z } from 'zod';

/**
 * What The Reader must return. Anything it gets wrong is coerced to null rather
 * than trusted — a bad extraction must never poison the lead record.
 */
export const ReaderSchema = z.object({
  name: z.string().trim().min(1).max(120).nullable().catch(null),
  budget: z.string().trim().max(60).nullable().catch(null),
  timeline: z.enum(['0-3 months', '3-6 months', '6+ months']).nullable().catch(null),
  purpose: z.enum(['own_construction', 'investment']).nullable().catch(null),
  interested_plot: z.string().trim().max(60).nullable().catch(null),
  language: z.enum(['english', 'kannada', 'telugu', 'hindi', 'tamil']).catch('english'),
  asked_for_documents: z.boolean().catch(false),
  asked_about_loan: z.boolean().catch(false),
  asked_about_registration_or_possession: z.boolean().catch(false),
  asked_about_specific_plot: z.boolean().catch(false),
  asked_about_price_or_offer: z.boolean().catch(false),
  /** Is this a real conversation, or someone barely replying? */
  engaged: z.boolean().catch(false),
  visit_agreed: z.boolean().catch(false),
  visit_datetime_iso: z.string().trim().max(40).nullable().catch(null),
  visit_label: z.string().trim().max(80).nullable().catch(null),
  disqualified: z.boolean().catch(false),
  disqualify_reason: z.string().trim().max(200).nullable().catch(null),
  summary: z.string().trim().max(300).catch(''),
});

export type ReaderResult = z.infer<typeof ReaderSchema>;

/**
 * Models wrap JSON in prose or code fences however firmly you ask them not to.
 * Pull out the first balanced object rather than trusting the whole string.
 */
export function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through
  }

  // Prose often contains braces of its own ("{maybe}"), so a candidate that
  // fails to parse must not end the search — keep trying later ones.
  for (let start = cleaned.indexOf('{'); start !== -1; start = cleaned.indexOf('{', start + 1)) {
    const end = matchingBrace(cleaned, start);
    if (end === -1) continue;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Not this one. Try the next opening brace.
    }
  }

  return null;
}

/** Index of the brace closing the one at `start`, or -1. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Straighten out the shapes models genuinely return.
 *
 * Every rule here comes from an output we actually saw. Without it the schema's
 * `.catch()` clauses turn a near-miss into a silent wrong answer rather than a
 * visible failure: "Kannada" became english, "true" became false, and a buyer
 * who had agreed a visit was quietly recorded as having agreed nothing.
 */

const NULLISH = new Set(['', 'null', 'none', 'nil', 'n/a', 'na', '-', '--', 'unknown', 'undefined']);

/** Lower-cased, trimmed, with the dashes and spaces models vary folded flat. */
function token(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')  // en dash, em dash and friends
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return value === 1;
  const t = token(value);
  if (t === null) return undefined;
  if (['true', 'yes', 'y', '1'].includes(t)) return true;
  if (['false', 'no', 'n', '0', ...NULLISH].includes(t)) return false;
  return undefined;
}

/** A string the model meant as "nothing" becomes a real null. */
function coerceNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return NULLISH.has(trimmed.toLowerCase()) ? null : trimmed;
}

const TIMELINE: Record<string, '0-3 months' | '3-6 months' | '6+ months'> = {
  '0-3 months': '0-3 months', '0-3 month': '0-3 months', '0-3months': '0-3 months',
  '0-3': '0-3 months', '1-3 months': '0-3 months', 'immediate': '0-3 months',
  'immediately': '0-3 months', 'this month': '0-3 months', 'asap': '0-3 months',
  '3-6 months': '3-6 months', '3-6 month': '3-6 months', '3-6months': '3-6 months',
  '3-6': '3-6 months', '4-6 months': '3-6 months',
  '6+ months': '6+ months', '6+months': '6+ months', '6+': '6+ months',
  '6 + months': '6+ months', 'more than 6 months': '6+ months', '6-12 months': '6+ months',
  'over 6 months': '6+ months', '1 year': '6+ months',
};

const PURPOSE: Record<string, 'own_construction' | 'investment'> = {
  'own_construction': 'own_construction', 'own construction': 'own_construction',
  'own-construction': 'own_construction', 'ownconstruction': 'own_construction',
  'own house': 'own_construction', 'own home': 'own_construction',
  'self use': 'own_construction', 'self-use': 'own_construction',
  'end use': 'own_construction', 'end-use': 'own_construction',
  'construction': 'own_construction', 'residence': 'own_construction',
  'investment': 'investment', 'invest': 'investment', 'investing': 'investment',
  'resale': 'investment', 'rental': 'investment',
};

const LANGUAGES = ['english', 'kannada', 'telugu', 'hindi', 'tamil'] as const;

export function coerceReaderRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  for (const key of ['asked_for_documents', 'asked_about_loan', 'visit_agreed',
    'asked_about_registration_or_possession', 'asked_about_specific_plot',
    'asked_about_price_or_offer', 'engaged', 'disqualified']) {
    const coerced = coerceBoolean(out[key]);
    if (coerced !== undefined) out[key] = coerced;
  }

  for (const key of ['name', 'budget', 'interested_plot', 'visit_datetime_iso',
    'visit_label', 'disqualify_reason']) {
    const coerced = coerceNullableString(out[key]);
    if (coerced !== undefined) out[key] = coerced;
  }

  const timeline = token(out.timeline);
  if (timeline !== null) out.timeline = TIMELINE[timeline] ?? (NULLISH.has(timeline) ? null : out.timeline);

  const purpose = token(out.purpose);
  if (purpose !== null) out.purpose = PURPOSE[purpose] ?? (NULLISH.has(purpose) ? null : out.purpose);

  // A capitalised or decorated language must not fall back to english — that
  // would file a Kannada buyer as an English one.
  const language = token(out.language);
  if (language !== null) {
    const match = LANGUAGES.find((l) => language === l || language.startsWith(l) || language.includes(l));
    if (match) out.language = match;
  }

  if (typeof out.summary !== 'string' && out.summary != null) out.summary = String(out.summary);

  return out;
}

/** Parse whatever the model said into a trustworthy result, or null. */
export function parseReaderOutput(text: string): ReaderResult | null {
  const raw = extractJson(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const parsed = ReaderSchema.safeParse(coerceReaderRaw(raw as Record<string, unknown>));
  return parsed.success ? parsed.data : null;
}
