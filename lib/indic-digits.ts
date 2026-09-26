/**
 * Indian-script numerals to ASCII.
 *
 * A buyer typing on a Kannada keyboard writes "೪೫ ಲಕ್ಷ", and JavaScript's \d
 * matches ASCII only — so without this his budget reads as nothing at all and
 * he silently loses three points. Shared by budget parsing and visit times.
 */

/** Each script's ten digits are one run starting at its own zero. */
const ZEROS = [
  0x0966, // Devanagari — Hindi, Marathi
  0x09e6, // Bengali
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Odia
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
];

const PATTERN = new RegExp(
  `[${ZEROS.map((z) => `\\u${z.toString(16).padStart(4, '0')}-\\u${(z + 9).toString(16).padStart(4, '0')}`).join('')}]`,
  'g',
);

export function foldIndicDigits(text: string): string {
  return text.replace(PATTERN, (ch) => {
    const code = ch.codePointAt(0)!;
    const zero = ZEROS.find((z) => code >= z && code <= z + 9);
    return zero === undefined ? ch : String(code - zero);
  });
}
