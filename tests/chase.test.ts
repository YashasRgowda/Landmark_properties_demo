import { describe, expect, it } from 'vitest';
import {
  CHASE_STEPS,
  QUIET_AFTER,
  classifyQuietLead,
  insideServiceWindow,
  needsVisitCheck,
  newVisitSlots,
  reminderAt,
  sendableAt,
  stepDueAt,
  type QuietFacts,
} from '../lib/chase';
import { CHASE_STATES } from '../lib/db/schema';
import { fromIst, istParts } from '../lib/visit-time';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Thursday 1 October 2026, 14:00 IST. */
const NOW = fromIst(2026, 9, 1, 14, 0);
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ahead = (ms: number) => new Date(NOW.getTime() + ms);
const clock = (d: Date) => { const p = istParts(d); return `${p.hour}:${String(p.minute).padStart(2, '0')}`; };

const base: QuietFacts = {
  status: 'CHATTING', category: 'WARM', optedOut: false, createdAt: ago(10 * DAY),
  firstOutboundAt: ago(10 * DAY), lastInboundAt: null, inboundCount: 0,
  lastAnsweredCallAt: null, missedCallsSinceAnswered: 0, lastVisit: null,
  hasActiveChase: false, lastEndedChase: null,
};
const facts = (over: Partial<QuietFacts>): QuietFacts => ({ ...base, ...over });
const state = (over: Partial<QuietFacts>) => classifyQuietLead(facts(over), NOW)?.state ?? null;

describe('which sequence a quiet buyer gets', () => {
  it('THE ACCEPTANCE TEST: no reply for 2 days → NEVER_ANSWERED', () => {
    expect(state({ firstOutboundAt: ago(2 * DAY + HOUR) })).toBe('NEVER_ANSWERED');
  });

  it('...but not a moment before two days', () => {
    expect(state({ firstOutboundAt: ago(47 * HOUR) })).toBeNull();
  });

  it('a lead we could never message is still chased, counted from when he arrived', () => {
    expect(state({ firstOutboundAt: null, createdAt: ago(3 * DAY) })).toBe('NEVER_ANSWERED');
  });

  it('chatted then stopped for 48 hours → WA_GHOST', () => {
    expect(state({ inboundCount: 4, lastInboundAt: ago(49 * HOUR) })).toBe('WA_GHOST');
    expect(state({ inboundCount: 4, lastInboundAt: ago(40 * HOUR) })).toBeNull();
  });

  it('answered once, then missed two calls, quiet two days → CALL_GHOST', () => {
    expect(state({ lastAnsweredCallAt: ago(3 * DAY), missedCallsSinceAnswered: 2 })).toBe('CALL_GHOST');
  });

  it('one missed call is not enough to call him unreachable', () => {
    expect(state({ lastAnsweredCallAt: ago(3 * DAY), missedCallsSinceAnswered: 1 })).not.toBe('CALL_GHOST');
  });

  it('picking up the phone counts as not being quiet', () => {
    expect(state({ inboundCount: 3, lastInboundAt: ago(5 * DAY), lastAnsweredCallAt: ago(HOUR) })).toBeNull();
  });

  it('booked and did not come → NO_SHOW, straight away', () => {
    expect(state({ inboundCount: 2, lastInboundAt: ago(3 * DAY),
      lastVisit: { status: 'NO_SHOW', visitAt: ago(2 * HOUR) } })).toBe('NO_SHOW');
  });

  it('a no-show who has written since is not treated as a no-show', () => {
    expect(state({ inboundCount: 3, lastInboundAt: ago(HOUR),
      lastVisit: { status: 'NO_SHOW', visitAt: ago(5 * HOUR) } })).toBeNull();
  });

  it('visited and quiet for a day → POST_VISIT_SILENT', () => {
    expect(state({ inboundCount: 5, lastInboundAt: ago(3 * DAY),
      lastVisit: { status: 'ATTENDED', visitAt: ago(25 * HOUR) } })).toBe('POST_VISIT_SILENT');
  });

  it('visited only this morning → not yet', () => {
    expect(state({ inboundCount: 5, lastInboundAt: ago(3 * DAY),
      lastVisit: { status: 'ATTENDED', visitAt: ago(5 * HOUR) } })).toBeNull();
  });

  it('a HOT buyer quiet for a day → LATE_STAGE, ahead of everything but a no-show', () => {
    expect(state({ category: 'HOT', inboundCount: 6, lastInboundAt: ago(25 * HOUR) })).toBe('LATE_STAGE');
    expect(state({ category: 'HOT', inboundCount: 6, lastInboundAt: ago(3 * DAY),
      lastVisit: { status: 'ATTENDED', visitAt: ago(2 * DAY) } })).toBe('LATE_STAGE');
  });
});

describe('who is never chased', () => {
  it('anyone who said STOP', () => {
    expect(state({ optedOut: true, firstOutboundAt: ago(30 * DAY) })).toBeNull();
  });

  it('a lead that is won, lost or rejected', () => {
    for (const status of ['WON', 'LOST', 'REJECTED']) {
      expect(state({ status, firstOutboundAt: ago(30 * DAY) }), status).toBeNull();
    }
  });

  it('a lead still at NEW — we never sent him anything, so there is nothing to follow up', () => {
    expect(state({ status: 'NEW', firstOutboundAt: null, createdAt: ago(30 * DAY) })).toBeNull();
  });

  it('a lead already in a sequence', () => {
    expect(state({ hasActiveChase: true, firstOutboundAt: ago(30 * DAY) })).toBeNull();
  });

  it('a buyer with a visit still ahead — he is coming', () => {
    expect(state({ inboundCount: 3, lastInboundAt: ago(5 * DAY),
      lastVisit: { status: 'BOOKED', visitAt: ahead(DAY) } })).toBeNull();
  });

  it('a past visit nobody marked — wait for the answer, do not guess', () => {
    expect(state({ inboundCount: 3, lastInboundAt: ago(5 * DAY),
      lastVisit: { status: 'BOOKED', visitAt: ago(DAY) } })).toBeNull();
  });

  it('a lead whose sequence already ran out, with nothing heard since', () => {
    expect(state({ inboundCount: 2, lastInboundAt: ago(20 * DAY),
      lastEndedChase: { status: 'EXHAUSTED', endedAt: ago(5 * DAY) } })).toBeNull();
  });

  it('...but if he wrote again after it ran out, and went quiet again, he starts afresh', () => {
    expect(state({ inboundCount: 3, lastInboundAt: ago(3 * DAY),
      lastEndedChase: { status: 'EXHAUSTED', endedAt: ago(10 * DAY) } })).toBe('WA_GHOST');
  });

  it('a sequence cancelled by his reply does not block the next one', () => {
    expect(state({ inboundCount: 3, lastInboundAt: ago(3 * DAY),
      lastEndedChase: { status: 'CANCELLED', endedAt: ago(3 * DAY) } })).toBe('WA_GHOST');
  });
});

describe('the sequences themselves', () => {
  it('every state has steps, and every step is WhatsApp or a call', () => {
    for (const s of CHASE_STATES) {
      expect(CHASE_STEPS[s].length, s).toBeGreaterThan(0);
      for (const step of CHASE_STEPS[s]) expect(['whatsapp', 'call']).toContain(step.kind);
    }
  });

  it('never answered: six touches over twelve days, alternating WhatsApp and calls', () => {
    const steps = CHASE_STEPS.NEVER_ANSWERED;
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.kind)).toEqual(['whatsapp', 'call', 'whatsapp', 'call', 'whatsapp', 'call']);
    expect(steps.at(-1)!.day).toBe(12);
  });

  it('never rings him at the same hour twice', () => {
    const hours = CHASE_STEPS.NEVER_ANSWERED.filter((s) => s.kind === 'call').map((s) => `${s.hour}:${s.minute ?? 0}`);
    expect(new Set(hours).size).toBe(hours.length);
  });

  it('WhatsApp ghost: message now, a person on day 4 after he went quiet', () => {
    expect(CHASE_STEPS.WA_GHOST.map((s) => [s.kind, s.day])).toEqual([['whatsapp', 0], ['call', 2]]);
  });

  it('no-show: message the same day, call the next, a new date after', () => {
    const s = CHASE_STEPS.NO_SHOW;
    expect(s.map((x) => x.kind)).toEqual(['whatsapp', 'call', 'whatsapp']);
    expect(s[2].kind === 'whatsapp' && s[2].purpose).toBe('new_date');
  });

  it('post-visit: feedback, objections on day 3 after the visit, a person on day 7', () => {
    // He enters a day after the visit, so day 2 and day 6 here are days 3 and 7.
    expect(CHASE_STEPS.POST_VISIT_SILENT.map((s) => s.day)).toEqual([0, 2, 6]);
  });

  it('late stage: a call today', () => {
    expect(CHASE_STEPS.LATE_STAGE).toEqual([expect.objectContaining({ kind: 'call', day: 0 })]);
  });
});

describe('when each step is due', () => {
  it('a day-0 step is due now', () => {
    expect(stepDueAt(CHASE_STEPS.WA_GHOST[0], NOW, NOW).getTime()).toBe(NOW.getTime());
  });

  it('a later step lands on its day and hour, India time', () => {
    const due = stepDueAt(CHASE_STEPS.NEVER_ANSWERED[1], NOW, NOW);
    expect(istParts(due).day).toBe(3);   // 1 October + 2
    expect(clock(due)).toBe('16:00');
  });

  it('a step whose time has already gone is due now, not in the past', () => {
    const lateStart = ago(10 * DAY);
    expect(stepDueAt(CHASE_STEPS.NEVER_ANSWERED[1], lateStart, NOW).getTime()).toBe(NOW.getTime());
  });

  it('never rings anyone outside office hours', () => {
    const midnight = fromIst(2026, 9, 1, 23, 30);
    const due = stepDueAt(CHASE_STEPS.LATE_STAGE[0], midnight, midnight);
    expect(clock(due)).toBe('9:30');
    expect(istParts(due).day).toBe(2);
  });

  it('does not ring at 8 PM either — a follow-up is not a first-hour call', () => {
    const eight = fromIst(2026, 9, 1, 20, 0);
    expect(clock(sendableAt('call', eight))).toBe('9:30');
  });

  it('holds a WhatsApp follow-up until 9 AM rather than sending at 2 AM', () => {
    const twoAm = fromIst(2026, 9, 1, 2, 0);
    const due = sendableAt('whatsapp', twoAm);
    expect(clock(due)).toBe('9:00');
    expect(istParts(due).day).toBe(1);
  });

  it('a WhatsApp at 10 PM waits for 9 AM the next day', () => {
    const due = sendableAt('whatsapp', fromIst(2026, 9, 1, 22, 0));
    expect(clock(due)).toBe('9:00');
    expect(istParts(due).day).toBe(2);
  });

  it('every step of every sequence, from every hour, lands at a decent time', () => {
    for (const s of CHASE_STATES) {
      for (const step of CHASE_STEPS[s]) {
        for (let h = 0; h < 24; h++) {
          const start = fromIst(2026, 9, 1, h, 15);
          const due = stepDueAt(step, start, start);
          const p = istParts(due);
          const minutes = p.hour * 60 + p.minute;
          if (step.kind === 'call') {
            expect(minutes, `${s} call from ${h}:15`).toBeGreaterThanOrEqual(9 * 60 + 30);
            expect(minutes).toBeLessThan(19 * 60);
          } else {
            expect(minutes, `${s} whatsapp from ${h}:15`).toBeGreaterThanOrEqual(9 * 60);
            expect(minutes).toBeLessThan(21 * 60);
          }
          expect(due.getTime()).toBeGreaterThanOrEqual(start.getTime());
        }
      }
    }
  });
});

describe('the WhatsApp 24-hour rule', () => {
  it('open within a day of his last message', () => {
    expect(insideServiceWindow(ago(2 * HOUR), NOW)).toBe(true);
  });
  it('closed after a day', () => {
    expect(insideServiceWindow(ago(25 * HOUR), NOW)).toBe(false);
  });
  it('closed a little early, so a message is never refused at the boundary', () => {
    expect(insideServiceWindow(ago(24 * HOUR - 5 * 60_000), NOW)).toBe(false);
  });
  it('closed if he never wrote at all', () => {
    expect(insideServiceWindow(null, NOW)).toBe(false);
  });
});

describe('visit reminders', () => {
  it('a day before the visit', () => {
    const visit = ahead(3 * DAY);
    expect(reminderAt(visit, NOW)!.getTime()).toBe(visit.getTime() - DAY);
  });

  it('booked tonight for tomorrow: remind that morning, three hours ahead', () => {
    const tonight = fromIst(2026, 9, 1, 20, 0);
    const visit = fromIst(2026, 9, 2, 15, 0);
    expect(clock(reminderAt(visit, tonight)!)).toBe('12:00');
  });

  it('never before 8 AM', () => {
    const tonight = fromIst(2026, 9, 1, 20, 0);
    const visit = fromIst(2026, 9, 2, 10, 0);
    expect(clock(reminderAt(visit, tonight)!)).toBe('8:00');
  });

  it('no reminder for a visit a couple of hours away — he just booked it', () => {
    expect(reminderAt(ahead(2 * HOUR), NOW)).toBeNull();
  });
});

describe('the rest', () => {
  it('a passed visit with no outcome is checked after three hours', () => {
    expect(needsVisitCheck({ status: 'BOOKED', visitAt: ago(4 * HOUR) }, NOW)).toBe(true);
    expect(needsVisitCheck({ status: 'BOOKED', visitAt: ago(HOUR) }, NOW)).toBe(false);
    expect(needsVisitCheck({ status: 'ATTENDED', visitAt: ago(9 * HOUR) }, NOW)).toBe(false);
  });

  it('offers a no-show two weekend slots, 11 AM, at least two days out', () => {
    const slots = newVisitSlots(NOW);   // Thursday
    expect(slots).toHaveLength(2);
    for (const s of slots) {
      expect([0, 6]).toContain(istParts(s).weekday);
      expect(clock(s)).toBe('11:00');
      expect(s.getTime() - NOW.getTime()).toBeGreaterThan(DAY);
    }
  });

  it('the quiet thresholds match the plan', () => {
    expect(QUIET_AFTER.NEVER_ANSWERED).toBe(48 * HOUR);
    expect(QUIET_AFTER.WA_GHOST).toBe(48 * HOUR);
  });
});
