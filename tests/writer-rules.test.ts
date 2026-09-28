import { describe, expect, it } from 'vitest';
import { approvedFigures, fallbackFollowUp, inventedFigures, purposeInstruction } from '../lib/ai/writer-rules';
import { DEMO_ASHRAYA } from '../lib/project-data-values';
import type { ChasePurpose } from '../lib/chase';

const PURPOSES: ChasePurpose[] = ['reintroduce', 'check_in', 'in_writing', 'missed_visit',
  'new_date', 'feedback', 'objections', 'drip'];

describe('prices the Writer may use', () => {
  it('knows every approved figure', () => {
    const f = approvedFigures(DEMO_ASHRAYA);
    for (const x of ['42', '52.5', '84', '1.4', '3500', '2', '100', '3400']) expect(f.has(x), x).toBe(true);
  });

  it('passes a message that only uses approved prices', () => {
    expect(inventedFigures('Plots start at ₹42 lakh, ₹3,500 per sq ft.', DEMO_ASHRAYA)).toEqual([]);
  });

  it('catches an invented price', () => {
    expect(inventedFigures('Special offer: only ₹39 lakh this week!', DEMO_ASHRAYA)).toEqual(['39']);
  });

  it('catches an invented rate however it is written', () => {
    expect(inventedFigures('Now ₹ 3,200 per sq ft', DEMO_ASHRAYA)).toEqual(['3200']);
  });

  it('ignores numbers that are not prices — plot sizes, counts, times', () => {
    expect(inventedFigures('14 plots of 30x40 left, visit at 11 AM', DEMO_ASHRAYA)).toEqual([]);
  });

  it('ignores a full stop after a price', () => {
    expect(inventedFigures('It is ₹42 lakh.', DEMO_ASHRAYA)).toEqual([]);
  });
});

describe('the instruction for each follow-up', () => {
  it('exists for every purpose and says something', () => {
    for (const p of PURPOSES) expect(purposeInstruction(p, DEMO_ASHRAYA, ['A', 'B']).length, p).toBeGreaterThan(40);
  });

  it('gives a no-show the exact slots, so the Writer never invents a date', () => {
    const text = purposeInstruction('new_date', DEMO_ASHRAYA, ['Saturday 3 Oct at 11:00 AM', 'Sunday 4 Oct at 11:00 AM']);
    expect(text).toContain('Saturday 3 Oct at 11:00 AM');
    expect(text).toContain('Sunday 4 Oct at 11:00 AM');
  });

  it('never tells the Writer to mention that he has not replied', () => {
    expect(purposeInstruction('reintroduce', DEMO_ASHRAYA)).toMatch(/never mention/i);
  });
});

describe('the safe message used when the Writer cannot be trusted', () => {
  it('exists for every purpose and invents nothing', () => {
    for (const p of PURPOSES) {
      const text = fallbackFollowUp(p, DEMO_ASHRAYA, 'Ravi Shankar', ['Sat 11 AM', 'Sun 11 AM']);
      expect(text.length, p).toBeGreaterThan(30);
      expect(inventedFigures(text, DEMO_ASHRAYA), p).toEqual([]);
    }
  });

  it('greets him by first name only, or plainly when there is none', () => {
    expect(fallbackFollowUp('feedback', DEMO_ASHRAYA, 'Ravi Shankar')).toMatch(/^Hi Ravi,/);
    expect(fallbackFollowUp('feedback', DEMO_ASHRAYA, null)).toMatch(/^Hello,/);
    expect(fallbackFollowUp('feedback', DEMO_ASHRAYA, '   ')).toMatch(/^Hello,/);
  });

  it('offers the no-show the exact slots', () => {
    expect(fallbackFollowUp('new_date', DEMO_ASHRAYA, null, ['Sat 11 AM', 'Sun 11 AM'])).toContain('Sat 11 AM or Sun 11 AM');
  });

  it('the monthly update quotes real availability', () => {
    expect(fallbackFollowUp('drip', DEMO_ASHRAYA, null)).toContain('14 plots of 30x40');
  });
});
