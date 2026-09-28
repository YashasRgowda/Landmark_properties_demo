import { describe, expect, it } from 'vitest';
import { hasAnyFilter, parseLeadFilters } from '../lib/leads/filters';

describe('reading the leads filters from the address bar', () => {
  it('reads a category, a status and a source', () => {
    const f = parseLeadFilters({ category: 'hot', status: 'chatting', source: '99acres' });
    expect(f).toMatchObject({ category: 'HOT', status: 'CHATTING', source: '99acres' });
  });

  it('can ask for leads that have not been scored yet', () => {
    expect(parseLeadFilters({ category: 'none' }).category).toBe('NONE');
  });

  it('ignores a value that is not real, rather than trusting it', () => {
    expect(parseLeadFilters({ category: 'VIP', status: 'DROP TABLE' })).toMatchObject({ category: null, status: null });
  });

  it('treats a typed phone number as a phone search, however it is written', () => {
    for (const q of ['98450 00000', '+91 98450 00000', '9845000000', '+91-98450-00000', '919845000000']) {
      expect(parseLeadFilters({ q }).phoneDigits, q).toBe('9845000000');
    }
  });

  it('searches part of a number too', () => {
    expect(parseLeadFilters({ q: '0000' }).phoneDigits).toBe('0000');
  });

  it('treats words as a name search', () => {
    expect(parseLeadFilters({ q: 'Ravi' })).toMatchObject({ nameText: 'Ravi', phoneDigits: null });
  });

  it('empty or missing means no filter', () => {
    expect(hasAnyFilter(parseLeadFilters({}))).toBe(false);
    expect(hasAnyFilter(parseLeadFilters({ q: '  ', category: '' }))).toBe(false);
  });
});
