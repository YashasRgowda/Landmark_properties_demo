import { LEAD_SOURCES, type LeadSource } from '@/lib/db/schema';

/**
 * Portals spell their own names inconsistently ("99Acres", "99 acres",
 * "Magicbricks.com"). Map the spellings we know onto the canonical values so
 * reporting groups correctly.
 *
 * An unrecognised source is NOT rejected. Losing a real buyer because a portal
 * renamed itself is far worse than storing an odd string, so anything unknown
 * is stored lowercased and reported back as a warning.
 */
const ALIASES: Record<string, LeadSource> = {
  '99acres': '99acres',
  '99 acres': '99acres',
  '99acres.com': '99acres',
  'ninetynineacres': '99acres',

  magicbricks: 'magicbricks',
  'magic bricks': 'magicbricks',
  'magicbricks.com': 'magicbricks',
  mb: 'magicbricks',

  housing: 'housing',
  'housing.com': 'housing',

  meta: 'meta',
  facebook: 'meta',
  fb: 'meta',
  instagram: 'meta',
  ig: 'meta',
  'facebook ads': 'meta',
  'meta ads': 'meta',

  website: 'website',
  web: 'website',
  site: 'website',
  organic: 'website',

  walkin: 'walkin',
  'walk in': 'walkin',
  'walk-in': 'walkin',
  direct: 'walkin',

  broker: 'broker',
  agent: 'broker',
  channelpartner: 'broker',
  'channel partner': 'broker',
  referral: 'broker',
};

export type SourceResult = {
  source: string;
  /** True when the value matched a known portal. */
  known: boolean;
};

export function canonicalSource(input: string): SourceResult {
  const cleaned = input.trim().toLowerCase().replace(/\s+/g, ' ');
  const mapped = ALIASES[cleaned] ?? ALIASES[cleaned.replace(/[\s_-]/g, '')];
  if (mapped) return { source: mapped, known: true };

  const known = (LEAD_SOURCES as readonly string[]).includes(cleaned);
  return { source: cleaned, known };
}
