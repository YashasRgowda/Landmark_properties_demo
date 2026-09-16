import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * The three time windows from the flowchart. Every scheduling decision in the
 * system asks this module what time it is — nothing else parses the clock.
 *
 * All logic runs in IST. All storage is UTC. The Date objects going in and
 * coming out of here are ordinary UTC instants; the IST-ness lives inside.
 */
export type Window = 'OFFICE' | 'EVENING' | 'NIGHT';

export const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';

/** "09:30" -> minutes since midnight. */
function parseHHMM(value: string, fallback: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value || '').trim());
  const [, h, m] = match ?? (/^(\d{1,2}):(\d{2})$/.exec(fallback) as RegExpExecArray);
  const hours = Number(h);
  const minutes = Number(m);
  if (hours > 23 || minutes > 59) return parseHHMM(fallback, fallback);
  return hours * 60 + minutes;
}

function bounds() {
  return {
    officeOpen: parseHHMM(process.env.OFFICE_OPEN ?? '', '09:30'),
    officeClose: parseHHMM(process.env.OFFICE_CLOSE ?? '', '19:00'),
    eveningClose: parseHHMM(process.env.EVENING_CLOSE ?? '', '21:00'),
  };
}

/** Minutes since midnight IST for a UTC instant. */
function istMinutes(at: Date): number {
  const ist = toZonedTime(at, TIMEZONE);
  return ist.getHours() * 60 + ist.getMinutes();
}

/**
 * OFFICE  09:30–19:00 IST — WhatsApp, plus a phone call within 10 minutes.
 * EVENING 19:00–21:00 IST — WhatsApp, plus one call attempt, then stop.
 * NIGHT   21:00–09:30 IST — WhatsApp only. No calls. Queue calls for 9:30 AM.
 *
 * Boundaries are inclusive at the start: exactly 09:30 is OFFICE, exactly
 * 19:00 is EVENING, exactly 21:00 is NIGHT.
 */
export function currentWindow(at: Date): Window {
  const { officeOpen, officeClose, eveningClose } = bounds();
  const minutes = istMinutes(at);
  if (minutes >= officeOpen && minutes < officeClose) return 'OFFICE';
  if (minutes >= officeClose && minutes < eveningClose) return 'EVENING';
  return 'NIGHT';
}

/**
 * The next 9:30 AM IST strictly after `at`, returned as a UTC instant.
 * Used to park call tasks that arrive at night.
 */
export function nextOfficeOpen(at: Date): Date {
  const { officeOpen } = bounds();
  const hours = Math.floor(officeOpen / 60);
  const minutes = officeOpen % 60;

  const ist = toZonedTime(at, TIMEZONE);

  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    const candidateLocal = new Date(
      ist.getFullYear(),
      ist.getMonth(),
      ist.getDate() + dayOffset,
      hours,
      minutes,
      0,
      0,
    );
    const candidateUtc = fromZonedTime(candidateLocal, TIMEZONE);
    if (candidateUtc.getTime() > at.getTime()) return candidateUtc;
  }

  // Unreachable in practice; keeps the return type honest.
  throw new Error('nextOfficeOpen: could not find a future office opening');
}

/** True when a phone call is allowed right now. WhatsApp is always allowed. */
export function callsAllowed(at: Date): boolean {
  return currentWindow(at) !== 'NIGHT';
}
