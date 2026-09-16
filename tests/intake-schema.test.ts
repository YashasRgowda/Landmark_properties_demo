import { describe, expect, it } from 'vitest';
import { cleanEmail, parseIntake } from '@/lib/leads/schema';
import { canonicalSource } from '@/lib/leads/source';

describe('parseIntake', () => {
  const valid = { phone: '+91 98765 43210', source: '99acres' };

  it('accepts a minimal enquiry and normalises the phone', () => {
    const r = parseIntake(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.normalisedPhone).toBe('919876543210');
  });

  it('normalises every phone format to the same lead key', () => {
    const keys = ['+91 98765 43210', '09876543210', '9876543210'].map((phone) => {
      const r = parseIntake({ ...valid, phone });
      return r.ok ? r.value.normalisedPhone : null;
    });
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('919876543210');
  });

  it('rejects an unusable phone number', () => {
    const r = parseIntake({ ...valid, phone: '12345' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('phone');
  });

  it('requires phone and source', () => {
    expect(parseIntake({ source: '99acres' }).ok).toBe(false);
    expect(parseIntake({ phone: '9876543210' }).ok).toBe(false);
    expect(parseIntake({}).ok).toBe(false);
    expect(parseIntake(null).ok).toBe(false);
  });

  it('drops a junk email with a warning rather than losing the lead', () => {
    const r = parseIntake({ ...valid, email: 'not-an-email' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBeNull();
      expect(r.warnings[0]).toContain('email');
    }
  });

  it('keeps a good email, lowercased', () => {
    const r = parseIntake({ ...valid, email: '  Ravi@Example.COM ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe('ravi@example.com');
  });
});

describe('cleanEmail', () => {
  it('accepts real addresses and rejects junk', () => {
    expect(cleanEmail('a@b.co')).toBe('a@b.co');
    expect(cleanEmail('no-at-sign')).toBeNull();
    expect(cleanEmail('a@b')).toBeNull();
    expect(cleanEmail('')).toBeNull();
    expect(cleanEmail(null)).toBeNull();
  });
});

describe('canonicalSource', () => {
  it('folds portal spellings onto one value', () => {
    for (const input of ['99acres', '99 Acres', '99Acres.com', 'NINETYNINEACRES']) {
      expect(canonicalSource(input), input).toEqual({ source: '99acres', known: true });
    }
    expect(canonicalSource('Magic Bricks').source).toBe('magicbricks');
    expect(canonicalSource('Facebook').source).toBe('meta');
    expect(canonicalSource('walk-in').source).toBe('walkin');
  });

  it('passes an unknown source through instead of losing the lead', () => {
    const r = canonicalSource('  SomeNewPortal ');
    expect(r.source).toBe('somenewportal');
    expect(r.known).toBe(false);
  });
});
