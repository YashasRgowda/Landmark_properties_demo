/**
 * Following up on buyers who go quiet — the rules.
 *
 * Pure: no database, no clock of its own. Which sequence a quiet buyer gets,
 * what each step does and when it is due are all decided here, so every case
 * can be tested directly instead of by waiting fourteen days.
 *
 * WhatsApp and calls only. SMS was in the original plan for buyers who never
 * reply; it is left out until there is an SMS provider, and those steps are
 * calls instead.
 */
import { currentWindow, nextOfficeOpen } from './time-window';
import { fromIst, istParts } from './visit-time';
import type { CallReason, ChaseState } from './db/schema';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** What a WhatsApp step is for — the Writer is told this, in plain words. */
export type ChasePurpose =
  | 'reintroduce'    // he never answered: who we are and why it is worth a look
  | 'check_in'       // he chatted and stopped: pick up where he left off
  | 'in_writing'     // he stopped answering calls: everything he needs, written down
  | 'missed_visit'   // he did not come: no pressure, is everything all right
  | 'new_date'       // offer him two new visit slots
  | 'feedback'       // he visited: how did he find it
  | 'objections'     // he visited and went quiet: answer what usually holds people back
  | 'drip';          // the slow monthly update after everything else

export type ChaseStep =
  | { kind: 'whatsapp'; day: number; hour?: number; minute?: number; purpose: ChasePurpose }
  | { kind: 'call'; day: number; hour?: number; minute?: number; note: string };

/**
 * The six sequences, plus the slow drip everyone falls into afterwards.
 *
 * `day` counts from the moment he entered the sequence; `day: 0` is straight
 * away. Hours are India time and deliberately varied — the same buyer is not
 * rung at 11 AM every time, because if 11 AM did not suit him once it will not
 * suit him on the fourth attempt either.
 */
export const CHASE_STEPS: Record<ChaseState, ChaseStep[]> = {
  // Never replied to anything: six touches over the following twelve days.
  NEVER_ANSWERED: [
    { kind: 'whatsapp', day: 0, purpose: 'reintroduce' },
    { kind: 'call', day: 2, hour: 16, note: 'Never replied — first follow-up call' },
    { kind: 'whatsapp', day: 4, hour: 19, minute: 30, purpose: 'reintroduce' },
    { kind: 'call', day: 7, hour: 10, minute: 30, note: 'Never replied — try a morning' },
    { kind: 'whatsapp', day: 10, hour: 12, minute: 30, purpose: 'reintroduce' },
    { kind: 'call', day: 12, hour: 17, minute: 30, note: 'Never replied — last call, try the evening' },
  ],
  // Chatted, then stopped: a message at 48 hours, a person on day 4.
  WA_GHOST: [
    { kind: 'whatsapp', day: 0, purpose: 'check_in' },
    { kind: 'call', day: 2, hour: 11, note: 'Stopped replying on WhatsApp — a person rings' },
  ],
  // Answered a call once, unreachable since: write it all down, then two calls
  // at different hours.
  CALL_GHOST: [
    { kind: 'whatsapp', day: 0, purpose: 'in_writing' },
    { kind: 'call', day: 1, hour: 11, note: 'Not answering calls — try late morning' },
    { kind: 'call', day: 2, hour: 17, minute: 30, note: 'Not answering calls — try the evening' },
  ],
  // Booked and did not come: same day, next day, then a new date.
  NO_SHOW: [
    { kind: 'whatsapp', day: 0, purpose: 'missed_visit' },
    { kind: 'call', day: 1, hour: 11, note: 'Missed his site visit — call and rebook' },
    { kind: 'whatsapp', day: 2, hour: 12, purpose: 'new_date' },
  ],
  // Visited, then quiet (he enters a day after the visit): feedback now,
  // objections on day 3 after the visit, a person on day 7.
  POST_VISIT_SILENT: [
    { kind: 'whatsapp', day: 0, purpose: 'feedback' },
    { kind: 'whatsapp', day: 2, hour: 12, purpose: 'objections' },
    { kind: 'call', day: 6, hour: 11, note: 'Visited and went quiet — a week on' },
  ],
  // Was close to buying: the owner rings today, at the top of the queue.
  LATE_STAGE: [
    { kind: 'call', day: 0, note: 'Was close to buying and has gone quiet — ring today' },
  ],
  // Every sequence ran out with no reply. Gentle, monthly, then stop. The lead
  // stays in the system forever; it is never deleted.
  COLD_DRIP: [
    { kind: 'whatsapp', day: 30, hour: 11, purpose: 'drip' },
    { kind: 'whatsapp', day: 60, hour: 11, purpose: 'drip' },
    { kind: 'whatsapp', day: 90, hour: 11, purpose: 'drip' },
  ],
};

export const CHASE_LABELS: Record<ChaseState, string> = {
  NEVER_ANSWERED: 'Never replied',
  WA_GHOST: 'Stopped replying',
  CALL_GHOST: 'Not answering calls',
  NO_SHOW: 'Missed his visit',
  POST_VISIT_SILENT: 'Quiet after visiting',
  LATE_STAGE: 'Was close to buying',
  COLD_DRIP: 'Monthly update',
};

/** Which call reason a chase call is filed under, and how urgent it is. */
export function callFor(state: ChaseState): { reason: CallReason; top: boolean } {
  if (state === 'LATE_STAGE') return { reason: 'LATE_STAGE', top: true };
  if (state === 'NO_SHOW') return { reason: 'NO_SHOW', top: false };
  return { reason: 'CHASE', top: false };
}

/* -------------------------------------------------------------- timing */

/** WhatsApp follow-ups go out between these hours, India time. */
const WHATSAPP_FROM_MIN = 9 * 60;
const WHATSAPP_UNTIL_MIN = 21 * 60;

/**
 * The earliest acceptable moment at or after `at`.
 *
 * Calls: office hours only. The first-hour ladder allows one evening attempt
 * because a new lead is warm; a follow-up call at 8 PM to someone who has been
 * quiet for days is just an interruption.
 * WhatsApp: 9 AM to 9 PM. A follow-up is never urgent enough for 2 AM.
 */
export function sendableAt(kind: ChaseStep['kind'], at: Date): Date {
  if (kind === 'call') {
    return currentWindow(at) === 'OFFICE' ? at : nextOfficeOpen(at);
  }
  const p = istParts(at);
  const minutes = p.hour * 60 + p.minute;
  if (minutes >= WHATSAPP_FROM_MIN && minutes < WHATSAPP_UNTIL_MIN) return at;
  const dayShift = minutes >= WHATSAPP_UNTIL_MIN ? 1 : 0;
  return fromIst(p.year, p.month, p.day + dayShift, WHATSAPP_FROM_MIN / 60, 0);
}

/** When a step is due, given when the sequence started and the time now. */
export function stepDueAt(step: ChaseStep, startedAt: Date, now: Date): Date {
  let due: Date;
  if (step.day === 0) {
    due = new Date(now);
  } else {
    const start = istParts(startedAt);
    due = fromIst(start.year, start.month, start.day + step.day, step.hour ?? 11, step.minute ?? 0);
    if (due.getTime() < now.getTime()) due = new Date(now);
  }
  return sendableAt(step.kind, due);
}

/* ------------------------------------------------ the WhatsApp 24-hour rule */

/**
 * Meta lets a business write freely only within 24 hours of the buyer's last
 * message. After that, only a pre-approved template may be sent. A quarter of
 * an hour is kept back so a message composed at 23h59 is not refused at 24h01.
 */
export const SERVICE_WINDOW_MS = DAY - 15 * 60_000;

export function insideServiceWindow(lastInboundAt: Date | null, now: Date): boolean {
  return Boolean(lastInboundAt) && now.getTime() - lastInboundAt!.getTime() < SERVICE_WINDOW_MS;
}

/* ------------------------------------------------------- who is quiet */

/** How long silence has to last before each kind of follow-up starts. */
export const QUIET_AFTER = {
  NEVER_ANSWERED: 48 * HOUR,
  WA_GHOST: 48 * HOUR,
  CALL_GHOST: 48 * HOUR,
  POST_VISIT_SILENT: 24 * HOUR,
  LATE_STAGE: 24 * HOUR,
} as const;

/** A visit this long past with nobody saying whether he came gets a call to find out. */
export const VISIT_CHECK_AFTER = 3 * HOUR;

/** Missed calls after an answered one before he counts as unreachable. */
export const MISSED_CALLS_FOR_GHOST = 2;

/** Statuses that are finished: nothing is chased. */
const CLOSED = new Set(['WON', 'LOST', 'REJECTED']);

export type QuietFacts = {
  status: string;
  category: string | null;
  optedOut: boolean;
  createdAt: Date;
  /** Our first message to him, if any went out. */
  firstOutboundAt: Date | null;
  lastInboundAt: Date | null;
  inboundCount: number;
  /** The last call he picked up. */
  lastAnsweredCallAt: Date | null;
  /** Calls not answered since that one. */
  missedCallsSinceAnswered: number;
  lastVisit: { status: string; visitAt: Date } | null;
  hasActiveChase: boolean;
  /** The most recent sequence that has ended, if any. */
  lastEndedChase: { status: string; endedAt: Date } | null;
};

export type QuietVerdict = { state: ChaseState; because: string } | null;

/**
 * Should this buyer start a follow-up sequence now, and which one?
 *
 * The most specific situation wins, in this order: a missed visit, a buyer
 * who was close to buying, one who visited, one who stopped taking calls, one
 * who stopped chatting, and one who never answered at all.
 */
export function classifyQuietLead(f: QuietFacts, now: Date): QuietVerdict {
  if (f.optedOut) return null;
  if (CLOSED.has(f.status)) return null;
  if (f.hasActiveChase) return null;

  // Still NEW means we never even sent the opening message — every lead gets
  // one within seconds of arriving. That is a stuck lead to fix, not a quiet
  // buyer to chase; following up on it would message someone who has never
  // heard from us.
  if (f.status === 'NEW') return null;

  const t = now.getTime();
  const visit = f.lastVisit;

  // A visit still ahead is not silence — he is coming. Reminders cover it.
  if (visit && visit.status === 'BOOKED' && visit.visitAt.getTime() > t) return null;

  // A visit that has passed but nobody has marked: wait for the answer
  // (a VISIT_CHECK call asks for it) rather than guess.
  if (visit && visit.status === 'BOOKED') return null;

  // Heard from him since the last sequence ran out? Then that sequence is
  // history and the question starts afresh. If not, it already did its job —
  // the drip is what follows, and it was started when the sequence ended.
  if (f.lastEndedChase && f.lastEndedChase.status === 'EXHAUSTED') {
    const since = f.lastEndedChase.endedAt.getTime();
    const heardSince = (f.lastInboundAt?.getTime() ?? 0) > since
      || (f.lastAnsweredCallAt?.getTime() ?? 0) > since;
    if (!heardSince) return null;
  }

  // Picking up the phone is not silence.
  const quietSince = Math.max(f.lastInboundAt?.getTime() ?? 0, f.lastAnsweredCallAt?.getTime() ?? 0);
  const quietFor = quietSince ? t - quietSince : 0;

  if (visit && visit.status === 'NO_SHOW' && quietSince < visit.visitAt.getTime()) {
    return { state: 'NO_SHOW', because: 'booked a visit and did not come' };
  }

  if (f.category === 'HOT' && quietSince && quietFor >= QUIET_AFTER.LATE_STAGE) {
    return { state: 'LATE_STAGE', because: 'a HOT lead, quiet for a day' };
  }

  if (visit && visit.status === 'ATTENDED') {
    const since = Math.max(visit.visitAt.getTime(), quietSince);
    if (t - since >= QUIET_AFTER.POST_VISIT_SILENT) {
      return { state: 'POST_VISIT_SILENT', because: 'visited, and quiet for a day since' };
    }
    return null;
  }

  if (f.lastAnsweredCallAt && f.missedCallsSinceAnswered >= MISSED_CALLS_FOR_GHOST
      && quietFor >= QUIET_AFTER.CALL_GHOST) {
    return { state: 'CALL_GHOST', because: `answered once, then missed ${f.missedCallsSinceAnswered} calls` };
  }

  if (f.inboundCount > 0 && quietFor >= QUIET_AFTER.WA_GHOST) {
    return { state: 'WA_GHOST', because: 'chatted, then stopped for two days' };
  }

  if (f.inboundCount === 0 && !f.lastAnsweredCallAt) {
    const since = (f.firstOutboundAt ?? f.createdAt).getTime();
    if (t - since >= QUIET_AFTER.NEVER_ANSWERED) {
      return { state: 'NEVER_ANSWERED', because: 'no reply to anything for two days' };
    }
  }

  return null;
}

/** A booked visit whose time has gone by without anyone marking the outcome. */
export function needsVisitCheck(visit: { status: string; visitAt: Date }, now: Date): boolean {
  return visit.status === 'BOOKED' && now.getTime() - visit.visitAt.getTime() >= VISIT_CHECK_AFTER;
}

/* ---------------------------------------------------------- visit reminders */

/**
 * When to remind him about his visit: a day before. If the visit is sooner
 * than that — booked this evening for tomorrow morning — then on the morning
 * itself, three hours ahead but not before 8 AM. If even that has passed, he
 * booked it minutes ago and needs no reminder.
 */
export function reminderAt(visitAt: Date, now: Date): Date | null {
  const dayBefore = new Date(visitAt.getTime() - DAY);
  if (dayBefore.getTime() > now.getTime()) return dayBefore;

  const p = istParts(visitAt);
  const eightAm = fromIst(p.year, p.month, p.day, 8, 0);
  const threeBefore = new Date(Math.max(visitAt.getTime() - 3 * HOUR, eightAm.getTime()));
  if (threeBefore.getTime() > now.getTime() && threeBefore.getTime() < visitAt.getTime()) {
    return threeBefore;
  }
  return null;
}

/**
 * Two slots to offer a buyer who missed his visit: the coming Saturday and
 * Sunday at 11 AM, at least two days out so he has time to plan. Computed here
 * so the Writer never invents a date.
 */
export function newVisitSlots(now: Date): Date[] {
  const slots: Date[] = [];
  const p = istParts(now);
  for (let d = 2; slots.length < 2 && d < 16; d++) {
    const at = fromIst(p.year, p.month, p.day + d, 11, 0);
    const weekday = istParts(at).weekday;
    if (weekday === 6 || weekday === 0) slots.push(at);
  }
  return slots;
}
