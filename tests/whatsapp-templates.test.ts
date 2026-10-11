import { afterEach, describe, expect, it } from 'vitest';
import { templateFor } from '@/lib/whatsapp/templates';

const KEYS = ['WHATSAPP_FIRST_TEMPLATE', 'WHATSAPP_FIRST_TEMPLATE_LANG'] as const;
afterEach(() => { for (const k of KEYS) delete process.env[k]; });

describe('the opening template', () => {
  it('falls back to the sample template, which takes no values', () => {
    expect(templateFor('first', 'Varshini')).toEqual({
      template: 'hello_world', language: 'en_US', variables: [],
    });
  });

  it('uses the approved template and fills in the first name', () => {
    process.env.WHATSAPP_FIRST_TEMPLATE = 'landmark_welcome';
    process.env.WHATSAPP_FIRST_TEMPLATE_LANG = 'en';
    const t = templateFor('first', 'Varshini Rao');
    expect(t).toEqual({ template: 'landmark_welcome', language: 'en', variables: ['Varshini'] });
  });

  it('capitalises a name the portal sent in lower case', () => {
    process.env.WHATSAPP_FIRST_TEMPLATE = 'landmark_welcome';
    expect(templateFor('first', 'varshini').variables).toEqual(['Varshini']);
    expect(templateFor('first', 'suresh kumar').variables).toEqual(['Suresh']);
  });

  it('greets a buyer who gave no name at all', () => {
    process.env.WHATSAPP_FIRST_TEMPLATE = 'landmark_welcome';
    for (const name of [null, '', '   ']) {
      expect(templateFor('first', name).variables).toEqual(['There']);
    }
  });

  it('leaves a script without capitals alone', () => {
    process.env.WHATSAPP_FIRST_TEMPLATE = 'landmark_welcome';
    expect(templateFor('first', 'ವರ್ಷಿಣಿ').variables).toEqual(['ವರ್ಷಿಣಿ']);
  });

  it('puts extra values after the name, for a reminder', () => {
    process.env.WHATSAPP_REMINDER_TEMPLATE = 'landmark_reminder';
    expect(templateFor('reminder', 'varshini', ['Saturday 11 AM']).variables)
      .toEqual(['Varshini', 'Saturday 11 AM']);
  });
});
