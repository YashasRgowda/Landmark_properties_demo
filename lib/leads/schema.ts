import { z } from 'zod';
import { normalisePhone } from '@/lib/phone';

/**
 * The intake contract. Deliberately forgiving on everything except the phone
 * number: a lead with a broken email is still a lead worth calling, but a lead
 * with no reachable number is nothing at all.
 */
export const IntakeSchema = z.object({
  name: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().min(1, 'phone is required'),
  email: z.string().trim().max(320).optional().nullable(),
  source: z.string().trim().min(1, 'source is required').max(80),
  campaign: z.string().trim().max(200).optional().nullable(),
  project: z.string().trim().max(200).optional().nullable(),
});

export type IntakeInput = z.infer<typeof IntakeSchema>;

/** Loose email check. Used to discard junk, never to reject the lead. */
export function cleanEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) ? trimmed : null;
}

export type ParsedIntake = {
  ok: true;
  value: IntakeInput & { normalisedPhone: string };
  warnings: string[];
} | {
  ok: false;
  errors: string[];
};

/**
 * Validate and normalise one enquiry. Returns warnings for anything we quietly
 * dropped so the caller can log it rather than discover it months later.
 */
export function parseIntake(raw: unknown): ParsedIntake {
  const parsed = IntakeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    };
  }

  const warnings: string[] = [];
  const normalisedPhone = normalisePhone(parsed.data.phone);
  if (!normalisedPhone) {
    return { ok: false, errors: [`phone: "${parsed.data.phone}" is not a valid Indian mobile number`] };
  }

  const email = cleanEmail(parsed.data.email);
  if (parsed.data.email && !email) {
    warnings.push(`email "${parsed.data.email}" did not look valid and was dropped`);
  }

  return {
    ok: true,
    value: { ...parsed.data, email, normalisedPhone },
    warnings,
  };
}
