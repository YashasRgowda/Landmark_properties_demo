/**
 * Indian phone normalisation. One phone number is one lead, forever, so every
 * spelling of the same number must collapse to exactly one string.
 *
 * Canonical form: 91XXXXXXXXXX — country code, no plus, 12 digits total.
 */

export const INDIA_CC = '91';

/** Indian mobile numbers are 10 digits and start 6, 7, 8 or 9. */
const MOBILE_10 = /^[6-9]\d{9}$/;

/**
 * Returns the canonical `91XXXXXXXXXX` form, or null if the input cannot be a
 * valid Indian mobile number. Never throws — callers pass raw portal data.
 *
 * Accepts: +91 98765 43210 · 09876543210 · 9876543210 · 919876543210
 *          +91-98765-43210 · 0091 98765 43210 · tel:+919876543210
 */
export function normalisePhone(input: string | null | undefined): string | null {
  if (!input) return null;

  // Keep digits only. A leading + is implied by the 91/0091 prefixes below.
  let digits = String(input).replace(/\D/g, '');
  if (!digits) return null;

  // 0091... international prefix
  if (digits.startsWith('00' + INDIA_CC)) digits = digits.slice(2);

  // 91XXXXXXXXXX — already country-coded
  if (digits.length === 12 && digits.startsWith(INDIA_CC)) {
    const local = digits.slice(2);
    return MOBILE_10.test(local) ? INDIA_CC + local : null;
  }

  // 0XXXXXXXXXX — national trunk prefix
  if (digits.length === 11 && digits.startsWith('0')) {
    const local = digits.slice(1);
    return MOBILE_10.test(local) ? INDIA_CC + local : null;
  }

  // XXXXXXXXXX — bare mobile
  if (digits.length === 10) {
    return MOBILE_10.test(digits) ? INDIA_CC + digits : null;
  }

  return null;
}

/** True when the input normalises to a valid Indian mobile number. */
export function isValidIndianMobile(input: string | null | undefined): boolean {
  return normalisePhone(input) !== null;
}

/** Display form for the admin screens: +91 98765 43210 */
export function formatPhone(canonical: string | null | undefined): string {
  if (!canonical) return '';
  const normalised = normalisePhone(canonical);
  if (!normalised) return String(canonical);
  const local = normalised.slice(2);
  return `+${INDIA_CC} ${local.slice(0, 5)} ${local.slice(5)}`;
}
