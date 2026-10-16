import { describe, expect, it } from 'vitest';
import { scoreLead } from '@/lib/scoring';
import type { ReaderResult } from '@/lib/ai/reader-schema';

const ENTRY = 42_00_000;
const base: ReaderResult = {
  name: 'Varshini', budget: null, timeline: null, purpose: 'own_construction',
  interested_plot: '30x40', language: 'english', asked_for_documents: true,
  asked_about_loan: false, asked_about_registration_or_possession: false,
  asked_about_specific_plot: true, asked_about_price_or_offer: true,
  wants_a_call: true, engaged: true, visit_agreed: true,
  visit_datetime_iso: '2026-10-17T11:00:00+05:30', visit_label: 'Saturday 11 AM',
  disqualified: false, disqualify_reason: null, summary: 'Wants a 30x40.',
};

/**
 * The live test that found this: a chat full of buyer signals — a 30x40, own
 * construction, documents, a booked visit — then "I am a property agent, do
 * you give commission for referrals?". The lead stayed WARM and kept its place
 * on an agent's call list.
 */
describe('a broker is not a buyer, whatever else they asked', () => {
  it('outranks every buying signal in the same conversation', () => {
    const r = scoreLead({ ...base, disqualified: true, disqualify_reason: 'broker' }, ENTRY);
    expect(r.category).toBe('REJECT');
    expect(r.score).toBe(0);
    expect(r.reasons).toEqual([{ signal: 'broker', points: 0 }]);
  });

  it('beats the confirmed-visit promotion that would otherwise make them HOT', () => {
    const asBuyer = scoreLead({ ...base, budget: '50 lakh' }, ENTRY);
    expect(asBuyer.category).toBe('HOT');
    const asBroker = scoreLead({ ...base, budget: '50 lakh', disqualified: true, disqualify_reason: 'broker' }, ENTRY);
    expect(asBroker.category).toBe('REJECT');
  });

  it('says why, so an agent can argue with it', () => {
    for (const why of ['broker', 'wrong city', 'already bought', 'not buying']) {
      expect(scoreLead({ ...base, disqualified: true, disqualify_reason: why }, ENTRY).reasons[0].signal)
        .toBe(why);
    }
  });

  it('falls back to plain words when the model gives no reason', () => {
    expect(scoreLead({ ...base, disqualified: true, disqualify_reason: null }, ENTRY).reasons[0].signal)
      .toBe('not a buyer');
  });
});
