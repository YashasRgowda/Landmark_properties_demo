import { describe, expect, it } from 'vitest';
import { extractJson, parseReaderOutput } from '@/lib/ai/reader-schema';

const good = JSON.stringify({
  name: 'Ramesh', budget: '45 lakh', timeline: '0-3 months', purpose: 'own_construction',
  interested_plot: '30x40', language: 'kannada', asked_for_documents: true,
  asked_about_loan: false, asked_about_registration_or_possession: true,
  asked_about_specific_plot: true, visit_agreed: true,
  visit_datetime_iso: '2026-10-04T11:00:00+05:30', visit_label: 'Sunday 11 AM',
  disqualified: false, disqualify_reason: null, summary: 'Wants 30x40, ready in 3 months.',
});

describe('extractJson', () => {
  it('reads plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads JSON inside a code fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('reads JSON buried in prose', () => {
    expect(extractJson('Here you go:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it('handles nested objects and braces inside strings', () => {
    expect(extractJson('{"a":{"b":2},"c":"} not the end {"}')).toEqual({ a: { b: 2 }, c: '} not the end {' });
  });

  it('returns null for junk', () => {
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('{"broken":')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});

describe('parseReaderOutput', () => {
  it('parses a good reading', () => {
    const r = parseReaderOutput(good);
    expect(r?.name).toBe('Ramesh');
    expect(r?.language).toBe('kannada');
    expect(r?.visit_agreed).toBe(true);
  });

  it('survives the model inventing an enum value', () => {
    const r = parseReaderOutput(JSON.stringify({ ...JSON.parse(good), timeline: 'next year', language: 'marathi' }));
    expect(r?.timeline).toBeNull();
    expect(r?.language).toBe('english');
  });

  it('survives missing keys', () => {
    const r = parseReaderOutput('{"summary":"just looking"}');
    expect(r?.summary).toBe('just looking');
    expect(r?.visit_agreed).toBe(false);
    expect(r?.disqualified).toBe(false);
    expect(r?.name).toBeNull();
  });

  it('reads the near-misses rather than discarding them', () => {
    // These used to fall back to false, which silently lost an agreed visit and
    // a document request. A model writing "yes" plainly means yes.
    const r = parseReaderOutput('{"visit_agreed":"yes","asked_for_documents":1,"name":123}');
    expect(r?.visit_agreed).toBe(true);
    expect(r?.asked_for_documents).toBe(true);
    expect(r?.name).toBeNull();  // a number is not a name
  });

  it('still refuses a value it cannot read at all', () => {
    const r = parseReaderOutput('{"visit_agreed":{"maybe":1},"asked_for_documents":[]}');
    expect(r?.visit_agreed).toBe(false);
    expect(r?.asked_for_documents).toBe(false);
  });

  it('returns null when there is no JSON at all', () => {
    expect(parseReaderOutput('I could not read that conversation.')).toBeNull();
  });
});
