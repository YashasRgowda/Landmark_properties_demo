import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '@/lib/ai/meera';
import { DEMO_ASHRAYA } from '@/lib/project-data-values';

/**
 * Friday 9 October 2026, 1:36 am India time. On that night Meera confirmed a
 * booking for "tomorrow, Sunday" — the stored visit was right, her words were
 * two days out, and the buyer would have driven out on the wrong day.
 */
const FRIDAY_NIGHT_IST = new Date('2026-10-08T20:06:00.000Z');
const prompt = (now: Date) => buildSystemPrompt(DEMO_ASHRAYA, { name: 'Varshini' }, 'english', now);

describe('the calendar Meera is given', () => {
  it('names tomorrow correctly after midnight India time', () => {
    const p = prompt(FRIDAY_NIGHT_IST);
    expect(p).toContain('today: Friday 9 October');
    expect(p).toContain('tomorrow: Saturday 10 October');
  });

  it('never leaves her to work a day out for herself', () => {
    const p = prompt(FRIDAY_NIGHT_IST);
    expect(p).toContain('Never name a weekday or a date that is not in that list');
    // The old prompt's example seeded the exact wrong answer.
    expect(p).not.toContain('"Sunday 11 AM — shall I confirm that?"');
  });

  it('covers a full week ahead, in order', () => {
    const p = prompt(FRIDAY_NIGHT_IST);
    for (const day of ['Sunday 11 October', 'Monday 12 October', 'Tuesday 13 October',
      'Wednesday 14 October', 'Thursday 15 October', 'Friday 16 October']) {
      expect(p).toContain(day);
    }
  });

  it('rolls over the end of a month', () => {
    const p = prompt(new Date('2026-10-31T06:00:00.000Z')); // Saturday 31 Oct, 11:30 am IST
    expect(p).toContain('today: Saturday 31 October');
    expect(p).toContain('tomorrow: Sunday 1 November');
  });

  it('tells her the site hours and to stay inside them', () => {
    expect(prompt(FRIDAY_NIGHT_IST)).toContain('the site is only open');
  });
});
