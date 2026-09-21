import { describe, expect, it } from 'vitest';
import { isSignificantMessage } from '@/lib/ai/significance';

describe('isSignificantMessage', () => {
  it('spots an agreed visit in every language', () => {
    expect(isSignificantMessage('I will come this Sunday at 11 AM')).toBe(true);
    expect(isSignificantMessage('ಭಾನುವಾರ ಬೆಳಿಗ್ಗೆ 11 ಗಂಟೆಗೆ ಬರುತ್ತೇನೆ')).toBe(true);
    expect(isSignificantMessage('ఆదివారం 11 గంటలకు వస్తాను')).toBe(true);
    expect(isSignificantMessage('रविवार 11 बजे आऊंगा')).toBe(true);
    expect(isSignificantMessage('ஞாயிறு 11 மணிக்கு வருகிறேன்')).toBe(true);
  });

  it('spots a stated budget in every language', () => {
    expect(isSignificantMessage('my budget is 45 lakh')).toBe(true);
    expect(isSignificantMessage('ನನ್ನ ಬಜೆಟ್ 45 ಲಕ್ಷ')).toBe(true);
    expect(isSignificantMessage('నా బడ్జెట్ 45 లక్ష')).toBe(true);
    expect(isSignificantMessage('मेरा बजट 45 लाख है')).toBe(true);
    expect(isSignificantMessage('₹45,00,000')).toBe(true);
    expect(isSignificantMessage('1.4 crore')).toBe(true);
  });

  it('does NOT fire on the old prototype bug', () => {
    // "am" inside a word must never read as a time (mistake 3 in the spec).
    expect(isSignificantMessage('I am looking for a plot')).toBe(false);
    expect(isSignificantMessage('I am interested')).toBe(false);
    expect(isSignificantMessage('the campus is nearby')).toBe(false);
    expect(isSignificantMessage('Ampm Layout')).toBe(false);
  });

  it('ignores ordinary questions', () => {
    expect(isSignificantMessage('what is the price?')).toBe(false);
    expect(isSignificantMessage('ಬೆಲೆ ಎಷ್ಟು?')).toBe(false);
    expect(isSignificantMessage('ధర ఎంత?')).toBe(false);
    expect(isSignificantMessage('is it E-Khata?')).toBe(false);
    expect(isSignificantMessage('')).toBe(false);
    expect(isSignificantMessage(null)).toBe(false);
  });

  it('spots a time even without a day', () => {
    expect(isSignificantMessage('can I come at 4pm?')).toBe(true);
    expect(isSignificantMessage('11:30 am works')).toBe(true);
  });
});
