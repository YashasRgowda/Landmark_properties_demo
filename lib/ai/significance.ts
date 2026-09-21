/**
 * Did this message move the conversation on?
 *
 * The Reader normally runs every third buyer message to keep cost down. But a
 * buyer who says "Sunday 11 AM" has just booked a visit, and waiting two more
 * messages to notice means the reminder, the agent handover and the visit row
 * all arrive late. So a message carrying a date, a time or a budget is read
 * straight away.
 *
 * Patterns are anchored on purpose. The old prototype matched `am|pm` loosely
 * and treated "I **am** looking" as a time.
 */

/** A number followed by a clock word: "11 AM", "11 ಗಂಟೆ", "11 గంటలకు", "11 மணி", "11 बजे". */
const TIME = /\b\d{1,2}\s*(?::\s*\d{2})?\s*(a\.?m\.?|p\.?m\.?|o'clock|ಗಂಟೆ|గంట|மணி|बजे|বাজে)/i;

/** Day names across the languages we support. */
const DAY_WORDS = [
  // English
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'today', 'tomorrow', 'weekend',
  // Kannada
  'ಸೋಮವಾರ', 'ಮಂಗಳವಾರ', 'ಬುಧವಾರ', 'ಗುರುವಾರ', 'ಶುಕ್ರವಾರ', 'ಶನಿವಾರ', 'ಭಾನುವಾರ',
  'ಇಂದು', 'ನಾಳೆ',
  // Telugu
  'సోమవారం', 'మంగళవారం', 'బుధవారం', 'గురువారం', 'శుక్రవారం', 'శనివారం', 'ఆదివారం',
  'ఈరోజు', 'రేపు',
  // Hindi
  'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार', 'रविवार', 'इतवार',
  'आज', 'कल',
  // Tamil
  'திங்கள்', 'செவ்வாய்', 'புதன்', 'வியாழன்', 'வெள்ளி', 'சனி', 'ஞாயிறு',
  'இன்று', 'நாளை',
];

/** Money words. A stated budget is worth points, so notice it immediately. */
const MONEY_WORDS = [
  'lakh', 'lakhs', 'lac', 'crore', 'crores', 'budget',
  'ಲಕ್ಷ', 'ಕೋಟಿ', 'ಬಜೆಟ್',
  'లక్ష', 'కోటి', 'బడ్జెట్',
  'लाख', 'करोड़', 'बजट',
  'லட்சம்', 'கோடி', 'பட்ஜெட்',
];

function containsWord(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((word) => {
    const w = word.toLowerCase();
    // Latin words need boundaries so "sunday" does not match inside another
    // word; Indic scripts have no case or word-boundary support in JS regex,
    // so a direct search is both correct and safe for them.
    if (/^[a-z']+$/.test(w)) {
      return new RegExp(`\\b${w}\\b`, 'i').test(lower);
    }
    return lower.includes(w);
  });
}

/**
 * True when the message is worth reading now rather than at the next multiple
 * of three.
 */
export function isSignificantMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  if (TIME.test(text)) return true;
  if (containsWord(text, DAY_WORDS)) return true;
  if (containsWord(text, MONEY_WORDS)) return true;
  // A bare rupee amount: "45,00,000" or "₹45"
  if (/₹\s*\d/.test(text)) return true;
  return false;
}
