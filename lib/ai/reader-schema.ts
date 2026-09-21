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

  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Parse whatever the model said into a trustworthy result, or null. */
export function parseReaderOutput(text: string): ReaderResult | null {
  const raw = extractJson(text);
  if (!raw || typeof raw !== 'object') return null;
  const parsed = ReaderSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
