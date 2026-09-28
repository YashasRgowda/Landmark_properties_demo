import { describe, expect, it } from 'vitest';
import { leadDrought, officeMinutesBetween } from '../lib/lead-drought';
import { fromIst } from '../lib/visit-time';

const ist = (day: number, h: number, m = 0) => fromIst(2026, 9, day, h, m); // October 2026

describe('counting office minutes', () => {
  it('counts a gap inside one working day exactly', () => {
    expect(officeMinutesBetween(ist(1, 10, 0), ist(1, 12, 30))).toBe(150);
  });

  it('does not count the night', () => {
    // 6 PM to 10 AM next day: 60 minutes before close + 30 after opening.
    expect(officeMinutesBetween(ist(1, 18, 0), ist(2, 10, 0))).toBe(90);
  });

  it('does not count time before opening', () => {
    expect(officeMinutesBetween(ist(1, 6, 0), ist(1, 9, 30))).toBe(0);
  });

  it('spans several days', () => {
    // A full office day is 9:30–19:00 = 570 minutes.
    expect(officeMinutesBetween(ist(1, 9, 30), ist(3, 9, 30))).toBe(2 * 570);
  });

  it('is zero backwards in time', () => {
    expect(officeMinutesBetween(ist(2, 10), ist(1, 10))).toBe(0);
  });
});

describe('the alert', () => {
  it('fires after two office hours with no lead', () => {
    const d = leadDrought(ist(1, 10, 0), ist(1, 12, 5));
    expect(d?.quietOfficeMinutes).toBe(125);
    expect(d?.message).toMatch(/2 office hours/);
  });

  it('stays quiet under two hours', () => {
    expect(leadDrought(ist(1, 10, 0), ist(1, 11, 55))).toBeNull();
  });

  it('THE FALSE ALARM IT AVOIDS: last lead at 7 PM, it is now 9:40 AM', () => {
    expect(leadDrought(ist(1, 19, 0), ist(2, 9, 40))).toBeNull();
  });

  it('...but by 11:31 AM the morning has been quiet too long', () => {
    expect(leadDrought(ist(1, 19, 0), ist(2, 11, 31))).not.toBeNull();
  });

  it('never alerts at night, when nobody can act on it', () => {
    expect(leadDrought(ist(1, 9, 30), ist(1, 22, 0))).toBeNull();
  });

  it('does not alert on a brand-new system with no leads yet', () => {
    expect(leadDrought(null, ist(1, 15, 0))).toBeNull();
  });
});
