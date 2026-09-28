/**
 * The leads list's filters, read from the address bar. Pure, so a hand-edited
 * or stale link can never inject a value the query was not built for.
 */
import { CATEGORIES, LEAD_STATUSES } from '../db/schema';

export type LeadFilters = {
  category: (typeof CATEGORIES)[number] | 'NONE' | null;
  status: (typeof LEAD_STATUSES)[number] | null;
  source: string | null;
  /** Digits typed into the search box — matched against the phone number. */
  phoneDigits: string | null;
  /** Anything else typed — matched against the name. */
  nameText: string | null;
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;

export function parseLeadFilters(params: Params): LeadFilters {
  const category = one(params.category)?.toUpperCase() ?? null;
  const status = one(params.status)?.toUpperCase() ?? null;
  const source = one(params.source);
  const q = one(params.q);

  // "98450 00000", "+91-98450-00000" and "9845000000" are all the same search.
  const digits = q ? q.replace(/\D/g, '') : '';
  const isPhone = q !== null && digits.length >= 3 && /^[\d\s+\-()]+$/.test(q);

  return {
    category: category === 'NONE' ? 'NONE'
      : (CATEGORIES as readonly string[]).includes(category ?? '') ? (category as LeadFilters['category']) : null,
    status: (LEAD_STATUSES as readonly string[]).includes(status ?? '') ? (status as LeadFilters['status']) : null,
    source: source && source.length <= 60 ? source : null,
    // A pasted +91 is the country code, not part of what to look for.
    phoneDigits: isPhone ? (digits.length > 10 && digits.startsWith('91') ? digits.slice(2) : digits) : null,
    nameText: q && !isPhone ? q.slice(0, 80) : null,
  };
}

export function hasAnyFilter(f: LeadFilters): boolean {
  return Boolean(f.category || f.status || f.source || f.phoneDigits || f.nameText);
}
