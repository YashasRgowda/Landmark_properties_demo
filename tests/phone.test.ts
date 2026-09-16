import { describe, expect, it } from 'vitest';
import { formatPhone, isValidIndianMobile, normalisePhone } from '@/lib/phone';

describe('normalisePhone', () => {
  it('collapses every spelling of the same number to one canonical form', () => {
    const expected = '919876543210';
    for (const input of [
      '+91 98765 43210',
      '09876543210',
      '9876543210',
      '919876543210',
      '+919876543210',
      '+91-98765-43210',
      '0091 98765 43210',
      '  9876543210  ',
      '(+91) 98765-43210',
      'tel:+919876543210',
    ]) {
      expect(normalisePhone(input), input).toBe(expected);
    }
  });

  it('accepts every valid Indian mobile prefix', () => {
    expect(normalisePhone('6000000000')).toBe('916000000000');
    expect(normalisePhone('7000000000')).toBe('917000000000');
    expect(normalisePhone('8000000000')).toBe('918000000000');
    expect(normalisePhone('9000000000')).toBe('919000000000');
  });

  it('rejects anything that is not an Indian mobile number', () => {
    for (const input of [
      '',
      '   ',
      'not a phone',
      '12345',
      '5876543210', // does not start 6-9
      '08012345', // too short
      '98765432101', // 11 digits, no trunk prefix
      '919876543', // country code with a short local part
      '441234567890', // wrong country
      '919876543210123',
      '05876543210', // trunk prefix, invalid mobile
    ]) {
      expect(normalisePhone(input), input).toBeNull();
    }
  });

  it('never throws on null or undefined', () => {
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
  });

  it('is idempotent', () => {
    const once = normalisePhone('+91 98765 43210');
    expect(normalisePhone(once)).toBe(once);
  });
});

describe('isValidIndianMobile', () => {
  it('agrees with normalisePhone', () => {
    expect(isValidIndianMobile('+91 98765 43210')).toBe(true);
    expect(isValidIndianMobile('5876543210')).toBe(false);
  });
});

describe('formatPhone', () => {
  it('renders the display form', () => {
    expect(formatPhone('919876543210')).toBe('+91 98765 43210');
    expect(formatPhone(null)).toBe('');
  });
});
