import { describe, expect, it } from 'vitest';
import { fromZonedTime } from 'date-fns-tz';
import {
  DELIVERY_CHECK_DELAY_MS,
  breachesTheTenMinuteRule,
  decideFirstHourCall,
} from '../lib/first-hour';
import { PRIORITY_NORMAL, PRIORITY_TOP } from '../lib/db/schema';

/** An IST wall-clock time on Thursday 24 September 2026, as a UTC instant. */
const ist = (hhmm: string, day = 24) =>
  fromZonedTime(`2026-09-${String(day).padStart(2, '0')}T${hhmm}:00`, 'Asia/Kolkata');

const TWO_PM = ist('14:00');      // OFFICE
const EIGHT_PM = ist('20:00');    // EVENING
const ELEVEN_PM = ist('23:00');   // NIGHT
const THREE_AM = ist('03:00');    // NIGHT, before the same morning's opening

/** The IST clock time of an instant, as "HH:MM". */
const clock = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);

const dayOf = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit' }).format(at);

describe('a buyer who is already talking to us', () => {
  it('is never called, at any hour', () => {
    for (const now of [TWO_PM, EIGHT_PM, ELEVEN_PM, THREE_AM]) {
      expect(decideFirstHourCall('REPLIED', now).call, clock(now)).toBe(false);
    }
  });
});

describe('a phone-only lead (not on WhatsApp)', () => {
  it('is called straight away during office hours, at the top of the queue', () => {
    const d = decideFirstHourCall('NOT_ON_WHATSAPP', TWO_PM);
    expect(d.call).toBe(true);
    expect(d.call && clock(d.dueAt)).toBe('14:00');
    expect(d.call && d.priority).toBe(PRIORITY_TOP);
    expect(d.call && d.reason).toBe('PHONE_ONLY');
  });

  it('THE ACCEPTANCE TEST: at 11 PM he is parked for 9:30 AM tomorrow, top priority', () => {
    const d = decideFirstHourCall('NOT_ON_WHATSAPP', ELEVEN_PM);
    expect(d.call).toBe(true);
    expect(d.call && clock(d.dueAt)).toBe('09:30');
    expect(d.call && dayOf(d.dueAt)).toBe('25');   // the NEXT day
    expect(d.call && d.priority).toBe(PRIORITY_TOP);
  });

  it('at 3 AM he is parked for 9:30 AM the SAME morning, not tomorrow', () => {
    const d = decideFirstHourCall('NOT_ON_WHATSAPP', THREE_AM);
    expect(d.call && clock(d.dueAt)).toBe('09:30');
    expect(d.call && dayOf(d.dueAt)).toBe('24');
  });

  it('is not cold-called in the evening — it waits for the morning', () => {
    const d = decideFirstHourCall('NOT_ON_WHATSAPP', EIGHT_PM);
    expect(d.call && clock(d.dueAt)).toBe('09:30');
    expect(d.call && dayOf(d.dueAt)).toBe('25');
    expect(d.call && d.priority).toBe(PRIORITY_TOP);
  });
});

describe('the message landed but he has not opened it', () => {
  it('THE ACCEPTANCE TEST: in office hours, a call is due in 10 minutes', () => {
    const d = decideFirstHourCall('DELIVERED', TWO_PM);
    expect(d.call).toBe(true);
    expect(d.call && clock(d.dueAt)).toBe('14:10');
    expect(d.call && d.priority).toBe(PRIORITY_NORMAL);
    expect(d.call && d.reason).toBe('DELIVERED_UNREAD');
  });

  it('in the evening, one attempt now', () => {
    const d = decideFirstHourCall('DELIVERED', EIGHT_PM);
    expect(d.call && clock(d.dueAt)).toBe('20:00');
  });

  it('at night, nothing until 9:30 AM', () => {
    const d = decideFirstHourCall('DELIVERED', ELEVEN_PM);
    expect(d.call && clock(d.dueAt)).toBe('09:30');
    expect(d.call && dayOf(d.dueAt)).toBe('25');
  });
});

describe('he read it and chose not to reply', () => {
  it('gets a little longer than an unopened message — 15 minutes, not 10', () => {
    const d = decideFirstHourCall('READ', TWO_PM);
    expect(d.call && clock(d.dueAt)).toBe('14:15');
    expect(d.call && d.reason).toBe('READ_NO_REPLY');
  });

  it('behaves like the unread case outside office hours', () => {
    const evening = decideFirstHourCall('READ', EIGHT_PM);
    expect(evening.call && clock(evening.dueAt)).toBe('20:00');

    const night = decideFirstHourCall('READ', ELEVEN_PM);
    expect(night.call && clock(night.dueAt)).toBe('09:30');
  });
});

describe('the whole table, at every hour', () => {
  it('always produces a call task unless he replied', () => {
    for (const hour of ['00:30', '06:00', '09:29', '09:30', '13:00', '18:59',
      '19:00', '20:59', '21:00', '23:59']) {
      for (const state of ['NOT_ON_WHATSAPP', 'DELIVERED', 'READ'] as const) {
        expect(decideFirstHourCall(state, ist(hour)).call, `${state} at ${hour}`).toBe(true);
      }
      expect(decideFirstHourCall('REPLIED', ist(hour)).call, `REPLIED at ${hour}`).toBe(false);
    }
  });

  it('never schedules a call into a night hour', () => {
    for (const hour of ['00:30', '06:00', '13:00', '20:00', '23:00']) {
      for (const state of ['NOT_ON_WHATSAPP', 'DELIVERED', 'READ'] as const) {
        const d = decideFirstHourCall(state, ist(hour));
        if (!d.call) continue;
        const minutes = Number(clock(d.dueAt).slice(0, 2)) * 60 + Number(clock(d.dueAt).slice(3));
        expect(minutes, `${state} at ${hour} -> ${clock(d.dueAt)}`)
          .toBeGreaterThanOrEqual(9 * 60 + 30);
        expect(minutes).toBeLessThan(21 * 60);
      }
    }
  });

  it('never schedules a call in the past', () => {
    for (const hour of ['00:30', '09:30', '14:00', '20:00', '23:00']) {
      for (const state of ['NOT_ON_WHATSAPP', 'DELIVERED', 'READ'] as const) {
        const now = ist(hour);
        const d = decideFirstHourCall(state, now);
        if (d.call) expect(d.dueAt.getTime(), `${state} at ${hour}`).toBeGreaterThanOrEqual(now.getTime());
      }
    }
  });

  it('gives every decision a reason a human can read', () => {
    for (const state of ['NOT_ON_WHATSAPP', 'DELIVERED', 'READ', 'REPLIED'] as const) {
      expect(decideFirstHourCall(state, TWO_PM).because.length).toBeGreaterThan(10);
    }
  });
});

describe('the delivery check itself', () => {
  it('runs two minutes after the first message', () => {
    expect(DELIVERY_CHECK_DELAY_MS).toBe(120_000);
  });
});

describe('the ten-minute rule', () => {
  const firstMessageAt = ist('14:00');

  it('is not breached when a call task exists', () => {
    expect(breachesTheTenMinuteRule({
      waState: 'DELIVERED', firstMessageAt, hasCallTask: true, now: ist('16:00'),
    })).toBe(false);
  });

  it('IS breached when office hours have passed 10 minutes with no task', () => {
    expect(breachesTheTenMinuteRule({
      waState: 'DELIVERED', firstMessageAt, hasCallTask: false, now: ist('14:11'),
    })).toBe(true);
  });

  it('is not breached inside the first 10 minutes', () => {
    expect(breachesTheTenMinuteRule({
      waState: 'DELIVERED', firstMessageAt, hasCallTask: false, now: ist('14:09'),
    })).toBe(false);
  });

  it('does not apply to a lead who replied', () => {
    expect(breachesTheTenMinuteRule({
      waState: 'REPLIED', firstMessageAt, hasCallTask: false, now: ist('18:00'),
    })).toBe(false);
  });

  it('does not apply at night, when calling is not allowed anyway', () => {
    expect(breachesTheTenMinuteRule({
      waState: 'DELIVERED', firstMessageAt: ist('23:00'), hasCallTask: false, now: ist('23:30'),
    })).toBe(false);
  });
});
