/**
 * Deciding whether a visit time is real.
 *
 * Pure and dependency-free on purpose: no `server-only`, no database, no clock
 * of its own. Every rule here is one the AI must not be trusted with, so the
 * rules live in code and are unit-tested directly (golden rule 1).
 *
 * India has a single fixed offset and no daylight saving, so the arithmetic is
 * exact — +05:30 all year, forever.
 */

export const IST_OFFSET_MINUTES = 330;

/** Beyond this a "visit date" is a hallucinated year, not a Saturday. */
export const MAX_DAYS_AHEAD = 120;

export type VisitRejection =
  | 'no_time_given'      // a date with no clock time — we cannot book that
  | 'unparseable'        // not a timestamp at all
  | 'in_the_past'
  | 'too_far_ahead'
  | 'before_opening'
  | 'after_closing';

export type VisitCheck =
  | {
      ok: true;
      at: Date;
      /** Wall-clock time in India, for messages and for the agent's screen. */
      istHour: number;
      istMinute: number;
      /** True when the label's clock time overruled a disagreeing timestamp. */
      correctedFromLabel: boolean;
    }
  | { ok: false; reason: VisitRejection };

/** India wall-clock fields for an instant. */
export function istParts(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** The instant at a given India wall-clock time. */
export function fromIst(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MINUTES * 60_000);
}

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;
const DATE_AND_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse whatever the model returned.
 *
 * A timestamp with no offset is the dangerous case: `new Date()` would read it
 * in the *server's* zone, so the same string books 10 AM in Mumbai and 4:30 AM
 * on a UTC host. A bare local time from this model always means India.
 */
export function parseVisitIso(iso: string): { at: Date } | { error: VisitRejection } {
  const text = iso.trim();
  if (!text) return { error: 'unparseable' };

  if (DATE_ONLY.test(text)) return { error: 'no_time_given' };

  if (HAS_OFFSET.test(text)) {
    const at = new Date(text);
    return Number.isNaN(at.getTime()) ? { error: 'unparseable' } : { at };
  }

  const m = DATE_AND_TIME.exec(text);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    const hour = Number(h);
    const minute = Number(mi);
    if (hour > 23 || minute > 59) return { error: 'unparseable' };
    const at = fromIst(Number(y), Number(mo) - 1, Number(d), hour, minute);
    return Number.isNaN(at.getTime()) ? { error: 'unparseable' } : { at };
  }

  // Last resort: let the platform try, but only if it yields a real date.
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? { error: 'unparseable' } : { at };
}

/**
 * The clock time inside a label like "Saturday 5 PM" or "ಭಾನುವಾರ 11 ಗಂಟೆ".
 * Returns null when the label carries no unambiguous time.
 */
export function timeFromLabel(label: string | null | undefined): { hour: number; minute: number } | null {
  if (!label) return null;
  // Indic digits write the same numbers; fold them to ASCII before matching.
  const text = foldDigits(label);

  // A dot is a minute separator in Indian usage: "4.30 pm" is half past four.
  const meridiem = /(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i.exec(text);
  if (meridiem) {
    let hour = Number(meridiem[1]);
    const minute = Number(meridiem[2] ?? 0);
    const isPm = /^p/i.test(meridiem[3]);
    if (hour > 12 || minute > 59) return null;
    if (hour === 12) hour = 0;
    if (isPm) hour += 12;
    return { hour, minute };
  }

  const twentyFour = /(?:^|[^\d:])(\d{1,2}):(\d{2})(?![\d:])/.exec(text);
  if (twentyFour) {
    const hour = Number(twentyFour[1]);
    const minute = Number(twentyFour[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  return null;
}
/**
 * Devanagari, Kannada, Telugu and Tamil digits -> ASCII.
 *
 * Each script's ten digits are one contiguous run starting at its own zero, so
 * subtracting that zero gives the value. A buyer who writes "11 ganTe" in
 * Kannada numerals still means eleven o'clock.
 */
const DIGIT_ZEROS = [0x0966, 0x0be6, 0x0c66, 0x0ce6]; // Devanagari, Tamil, Telugu, Kannada

export function foldDigits(text: string): string {
  return text.replace(/[\u0966-\u096F\u0BE6-\u0BEF\u0C66-\u0C6F\u0CE6-\u0CEF]/g, (ch) => {
    const code = ch.codePointAt(0)!;
    const zero = DIGIT_ZEROS.find((z) => code >= z && code <= z + 9);
    return zero === undefined ? ch : String(code - zero);
  });
}

export type VisitCheckOptions = {
  label?: string | null;
  now?: Date;
  openHour?: number;
  closeHour?: number;
  maxDaysAhead?: number;
};

/**
 * The single gate every booking passes through.
 *
 * Refusing is always safer than storing a wrong time: an unbooked visit shows
 * up as a lead still being chased, while a wrong time sends a buyer to a locked
 * gate and loses the sale.
 */
export function checkVisitTime(iso: string, options: VisitCheckOptions = {}): VisitCheck {
  const {
    label = null,
    now = new Date(),
    openHour = 10,
    closeHour = 18,
    maxDaysAhead = MAX_DAYS_AHEAD,
  } = options;

  const parsed = parseVisitIso(iso);
  if ('error' in parsed) return { ok: false, reason: parsed.error };

  let at = parsed.at;
  let correctedFromLabel = false;

  // The buyer's own words outrank the model's arithmetic. When the label names
  // a clock time and the timestamp disagrees, the label wins — this is exactly
  // how "5 PM" got stored as 6 PM.
  const fromLabel = timeFromLabel(label);
  if (fromLabel) {
    const parts = istParts(at);
    if (parts.hour !== fromLabel.hour || parts.minute !== fromLabel.minute) {
      at = fromIst(parts.year, parts.month, parts.day, fromLabel.hour, fromLabel.minute);
      correctedFromLabel = true;
    }
  }

  if (at.getTime() <= now.getTime()) return { ok: false, reason: 'in_the_past' };

  const daysAhead = (at.getTime() - now.getTime()) / 86_400_000;
  if (daysAhead > maxDaysAhead) return { ok: false, reason: 'too_far_ahead' };

  const parts = istParts(at);
  const minutes = parts.hour * 60 + parts.minute;
  if (minutes < openHour * 60) return { ok: false, reason: 'before_opening' };
  if (minutes > closeHour * 60) return { ok: false, reason: 'after_closing' };

  return { ok: true, at, istHour: parts.hour, istMinute: parts.minute, correctedFromLabel };
}

/** "Saturday, 26 September at 5:00 PM" — for reminders and the agent's screen. */
export function describeVisit(at: Date): string {
  const p = istParts(at);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const suffix = p.hour < 12 ? 'AM' : 'PM';
  return `${days[p.weekday]}, ${p.day} ${months[p.month]} at ${h12}:${String(p.minute).padStart(2, '0')} ${suffix}`;
}
