/**
 * The first-hour ladder — the core of the flowchart.
 *
 * A lead arrives, gets a WhatsApp immediately whatever the hour, and two minutes
 * later the system asks one question: did that message land, and did he answer?
 * What happens next depends on the answer and on the time of day, and it is
 * decided here — pure, no database, no clock of its own, so every branch can be
 * tested directly instead of by waiting until 11 PM.
 *
 * The rule that matters most: a lead must never be left with nobody assigned to
 * ring him. If in doubt, this creates the call task.
 */
import { currentWindow, nextOfficeOpen, type Window } from './time-window';
import { PRIORITY_NORMAL, PRIORITY_TOP, type CallReason, type WaState } from './db/schema';

/** How long after sending we check whether the message landed. */
export const DELIVERY_CHECK_DELAY_MS = 2 * 60_000;

/** In office hours, how long a lead may wait before an agent rings him. */
const OFFICE_DELAY_MS: Record<'DELIVERED' | 'READ', number> = {
  // Message delivered but unopened: he is busy. Give him ten minutes.
  DELIVERED: 10 * 60_000,
  // Opened and not answered: he made a choice. Give him a little longer.
  READ: 15 * 60_000,
};

export type CallDecision =
  | { call: false; because: 'he is already talking to us' }
  | { call: true; dueAt: Date; priority: number; reason: CallReason; because: string };

/**
 * What to do two minutes after the first message.
 *
 * `now` is passed in rather than read, so the night-time branches are testable
 * at any hour of the day.
 */
export function decideFirstHourCall(waState: WaState, now: Date): CallDecision {
  const window = currentWindow(now);

  // He replied. Meera has the conversation; a call now would talk over her.
  if (waState === 'REPLIED') {
    return { call: false, because: 'he is already talking to us' };
  }

  // Not on WhatsApp at all. This is a phone-only lead and the only way to
  // reach him is a call — so it must be a good one, in office hours, at the
  // top of the queue. Nobody wants a cold sales call at half past eight.
  if (waState === 'NOT_ON_WHATSAPP') {
    if (window === 'OFFICE') {
      return {
        call: true, dueAt: new Date(now), priority: PRIORITY_TOP, reason: 'PHONE_ONLY',
        because: 'not on WhatsApp — the phone is the only way to reach him',
      };
    }
    return {
      call: true, dueAt: nextOfficeOpen(now), priority: PRIORITY_TOP, reason: 'PHONE_ONLY',
      because: 'not on WhatsApp — parked for first thing in the morning, top of the queue',
    };
  }

  const reason: CallReason = waState === 'READ' ? 'READ_NO_REPLY' : 'DELIVERED_UNREAD';
  const label = waState === 'READ' ? 'read it and did not reply' : 'has not opened it';

  if (window === 'OFFICE') {
    return {
      call: true,
      dueAt: new Date(now.getTime() + OFFICE_DELAY_MS[waState]),
      priority: PRIORITY_NORMAL,
      reason,
      because: `${label} — ring him in ${OFFICE_DELAY_MS[waState] / 60_000} minutes`,
    };
  }

  if (window === 'EVENING') {
    return {
      call: true, dueAt: new Date(now), priority: PRIORITY_NORMAL, reason,
      because: `${label} — one evening attempt`,
    };
  }

  return {
    call: true, dueAt: nextOfficeOpen(now), priority: PRIORITY_NORMAL, reason,
    because: `${label} — no calls at night, so first thing in the morning`,
  };
}

/**
 * The hard rule, as a function so it can be asserted rather than hoped for:
 * during office hours no lead may go longer than this without a call task
 * existing for him. The task's own due time may be later — what must never
 * happen is nobody having been told to ring him at all.
 */
export const MAX_MINUTES_WITHOUT_A_CALL_TASK = 10;

export function breachesTheTenMinuteRule(args: {
  waState: WaState;
  firstMessageAt: Date;
  hasCallTask: boolean;
  now: Date;
}): boolean {
  if (args.hasCallTask) return false;
  if (args.waState === 'REPLIED') return false;
  if (currentWindow(args.now) !== 'OFFICE') return false;

  const waited = args.now.getTime() - args.firstMessageAt.getTime();
  return waited > MAX_MINUTES_WITHOUT_A_CALL_TASK * 60_000;
}

export type { Window };
