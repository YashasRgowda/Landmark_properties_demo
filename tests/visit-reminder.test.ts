import { describe, expect, it } from 'vitest';
import { visitReminderText } from '../lib/visit-reminder';
import { DEMO_ASHRAYA } from '../lib/project-data-values';

describe('the visit reminder', () => {
  const text = visitReminderText({ name: 'Ravi Shankar', when: 'Saturday, 3 October at 5:00 PM', project: DEMO_ASHRAYA });

  it('has the day and time exactly as booked', () => {
    expect(text).toContain('Saturday, 3 October at 5:00 PM');
  });
  it('has the map link, untouched', () => {
    expect(text).toContain(DEMO_ASHRAYA.maps_link);
  });
  it('offers the pickup', () => {
    expect(text).toContain(DEMO_ASHRAYA.pickup);
  });
  it('greets him by first name, or plainly', () => {
    expect(text).toMatch(/^Hi Ravi,/);
    expect(visitReminderText({ name: null, when: 'x', project: DEMO_ASHRAYA })).toMatch(/^Hello,/);
  });
  it('tells him how to change it', () => {
    expect(text).toMatch(/change the time/);
  });
});
