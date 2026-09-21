import { describe, expect, it } from 'vitest';
import { isOptOutMessage } from '@/lib/whatsapp/opt-out';

describe('isOptOutMessage', () => {
  it('catches the real opt-out words', () => {
    for (const body of [
      'STOP', 'stop', ' Stop ', 'stop.', 'STOP!',
      'unsubscribe', 'Unsubscribe.', 'UNSUBSCRIBE',
      'opt out', 'opt-out', 'optout', 'OPT OUT',
      'remove me', 'cancel', 'quit',
    ]) {
      expect(isOptOutMessage(body), JSON.stringify(body)).toBe(true);
    }
  });

  it('does NOT opt out a buyer who used the word in a sentence', () => {
    for (const body of [
      "please don't stop sending me updates",
      'I will stop by the site on Sunday',
      'stopped by yesterday',
      'can you cancel my 4pm and make it 5?',
      'Is the road work going to stop soon?',
      'I want to visit, please quit sending the same price list',
      'non-stop calls from brokers',
    ]) {
      expect(isOptOutMessage(body), JSON.stringify(body)).toBe(false);
    }
  });

  it('ignores empty and missing input', () => {
    expect(isOptOutMessage('')).toBe(false);
    expect(isOptOutMessage('   ')).toBe(false);
    expect(isOptOutMessage(null)).toBe(false);
    expect(isOptOutMessage(undefined)).toBe(false);
  });

  it('does not treat ordinary enquiries as opt-outs', () => {
    expect(isOptOutMessage('What is the price of 30x40?')).toBe(false);
    expect(isOptOutMessage('ಬೆಲೆ ಎಷ್ಟು?')).toBe(false);
  });
});
