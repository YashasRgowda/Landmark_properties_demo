import { describe, expect, it } from 'vitest';
import { detectLanguage, isWrongLanguage, mixesIndianScripts, scriptsIn } from '@/lib/ai/language';

describe('detectLanguage', () => {
  it('reads each script', () => {
    expect(detectLanguage('ಬೆಲೆ ಎಷ್ಟು?')).toBe('kannada');
    expect(detectLanguage('ధర ఎంత?')).toBe('telugu');
    expect(detectLanguage('प्लॉट का रेट क्या है?')).toBe('hindi');
    expect(detectLanguage('விலை என்ன?')).toBe('tamil');
  });

  it('treats Latin letters as English', () => {
    expect(detectLanguage('what is the price?')).toBe('english');
    expect(detectLanguage('bele estu? 30x40 site ideya?')).toBe('english');
    expect(detectLanguage('')).toBe('english');
  });

  it('is not confused by prices and digits', () => {
    expect(detectLanguage('ಬೆಲೆ ₹42 lakh')).toBe('kannada');
    expect(detectLanguage('ధర ₹3,500 per sq ft')).toBe('telugu');
  });

  it('picks the dominant script when the buyer mixes', () => {
    expect(detectLanguage('ధర ఎంత? ಬೆಲೆ')).toBe('telugu');
  });
});

describe('mixesIndianScripts', () => {
  it('catches the bug this module exists for', () => {
    // The real failure: Telugu sentence, Kannada question.
    expect(mixesIndianScripts('ధర ₹3,500 per sq ft. ಮೀರು ಸೌಂತ ಇಂಟಿಕೋ ನೋಡುತ್ತಿದ್ದೀರಾ?')).toBe(true);
  });

  it('allows one Indian script plus English words', () => {
    expect(mixesIndianScripts('ధర ₹3,500 per sq ft.')).toBe(false);
    expect(mixesIndianScripts('ಬೆಲೆ ₹42 lakh')).toBe(false);
    expect(mixesIndianScripts('The price is ₹42 lakh')).toBe(false);
  });
});

describe('isWrongLanguage', () => {
  it('accepts a reply in the asked-for language', () => {
    expect(isWrongLanguage('ధర ₹3,500', 'telugu')).toBe(false);
    expect(isWrongLanguage('The price is ₹42 lakh', 'english')).toBe(false);
  });

  it('rejects the wrong script', () => {
    expect(isWrongLanguage('ಬೆಲೆ ₹42 lakh', 'telugu')).toBe(true);
    expect(isWrongLanguage('The price is ₹42 lakh', 'telugu')).toBe(true);
    expect(isWrongLanguage('ಬೆಲೆ ₹42 lakh', 'english')).toBe(true);
  });

  it('rejects a mixed reply even when it contains the right script', () => {
    expect(isWrongLanguage('ధర ₹3,500. ಮೀರು ನೋಡುತ್ತಿದ್ದೀರಾ?', 'telugu')).toBe(true);
  });
});

describe('scripts we never reply in', () => {
  it('notices a foreign script sneaking in', () => {
    // Real failure: a Telugu reply that slipped a Malayalam word in.
    const leaked = 'ఆదివారం ఉదయం 11 గంటలకు. ഞാന്‍ Yelahanka నుండి';
    expect(scriptsIn(leaked)).toContain('malayalam');
    expect(isWrongLanguage(leaked, 'telugu')).toBe(true);
  });

  it('rejects other Indian scripts too', () => {
    expect(isWrongLanguage('ধর কত?', 'telugu')).toBe(true);   // Bengali
    expect(isWrongLanguage('ભાવ શું છે?', 'kannada')).toBe(true); // Gujarati
    expect(isWrongLanguage('ਕੀਮਤ ਕੀ ਹੈ?', 'hindi')).toBe(true);  // Gurmukhi
  });

  it('still treats a clean reply as clean', () => {
    expect(isWrongLanguage('ధర ₹3,500 per sq ft.', 'telugu')).toBe(false);
  });

  it('does not let a foreign script become the detected language', () => {
    expect(detectLanguage('ഞാന്‍ വരുന്നു')).toBe('english');
  });
});

describe('scriptsIn', () => {
  it('lists every script present', () => {
    expect(scriptsIn('ధర ಬೆಲೆ')).toEqual(['telugu', 'kannada']);
    expect(scriptsIn('plain english')).toEqual([]);
  });
});

import { repairConfusableScript } from '@/lib/ai/language';

describe('repairConfusableScript', () => {
  it('moves stray Kannada letters into Telugu', () => {
    // "ఖాతా" written with a Kannada 'ತ' in the middle — what the model produces.
    const broken = 'ఖాತా ఉందా?';
    expect(scriptsIn(broken)).toEqual(['telugu', 'kannada']);

    const fixed = repairConfusableScript(broken, 'telugu');
    expect(scriptsIn(fixed)).toEqual(['telugu']);
    expect(fixed).toBe('ఖాతా ఉందా?');
  });

  it('moves stray Telugu letters into Kannada', () => {
    const broken = 'ಖಾతಾ ಇದೆಯಾ?';
    expect(scriptsIn(broken)).toEqual(['telugu', 'kannada']);
    expect(scriptsIn(repairConfusableScript(broken, 'kannada'))).toEqual(['kannada']);
  });

  it('refuses to transliterate a whole sentence in the wrong language', () => {
    // Kannada sentence, target Telugu. Shifting every letter would produce
    // Kannada words in Telugu script — gibberish that passes a script check.
    const kannadaSentence = 'ಎಲ್ಲಾ ಪ್ಲಾಟ್‌ಗಳಿಗೂ E-Khata ಸಿಕ್ಕಿದೆ';
    expect(repairConfusableScript(kannadaSentence, 'telugu')).toBe(kannadaSentence);
  });

  it('leaves a clean message untouched', () => {
    const clean = 'ధర ₹3,500 per sq ft.';
    expect(repairConfusableScript(clean, 'telugu')).toBe(clean);
  });

  it('never touches other languages, digits or English', () => {
    expect(repairConfusableScript('रेट ₹3,500', 'telugu')).toBe('रेट ₹3,500');
    expect(repairConfusableScript('விலை', 'telugu')).toBe('விலை');
    expect(repairConfusableScript('30x40 ₹42 lakh', 'telugu')).toBe('30x40 ₹42 lakh');
  });

  it('does nothing for languages that are not confusable', () => {
    const hindi = 'रेट क्या है?';
    expect(repairConfusableScript(hindi, 'hindi')).toBe(hindi);
    expect(repairConfusableScript(hindi, 'english')).toBe(hindi);
  });
});
