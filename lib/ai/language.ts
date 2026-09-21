/**
 * Which language a message is written in, decided by code rather than by the
 * model (golden rule 1).
 *
 * This exists because a stored "he speaks Kannada" must never override what he
 * actually just wrote — that is how a reply ends up half Telugu, half Kannada.
 */
export type Language = 'english' | 'kannada' | 'telugu' | 'hindi' | 'tamil';

/** Unicode blocks. Telugu and Kannada are adjacent, so the order matters. */
const SCRIPTS: { language: Exclude<Language, 'english'>; test: RegExp }[] = [
  { language: 'telugu', test: /[ఀ-౿]/ },
  { language: 'kannada', test: /[ಀ-೿]/ },
  { language: 'hindi', test: /[ऀ-ॿ]/ },
  { language: 'tamil', test: /[஀-௿]/ },
];

/**
 * Scripts we never reply in, but must still recognise. A model reaching for
 * Malayalam or Bengali mid-sentence is just as broken as one reaching for
 * Kannada — and far easier to miss, because nobody is looking for it.
 */
const FOREIGN_SCRIPTS: { language: string; test: RegExp }[] = [
  { language: 'malayalam', test: /[ഀ-ൿ]/ },
  { language: 'bengali', test: /[ঀ-৿]/ },
  { language: 'gujarati', test: /[઀-૿]/ },
  { language: 'gurmukhi', test: /[਀-੿]/ },
  { language: 'odia', test: /[଀-୿]/ },
  { language: 'sinhala', test: /[඀-෿]/ },
];

/** Every Indian script present in the text, supported or not. */
export function scriptsIn(text: string): string[] {
  if (!text) return [];
  return [...SCRIPTS, ...FOREIGN_SCRIPTS]
    .filter((s) => s.test.test(text))
    .map((s) => s.language);
}

/** Only the scripts we actually reply in. */
function supportedScriptsIn(text: string): Exclude<Language, 'english'>[] {
  return SCRIPTS.filter((s) => s.test.test(text)).map((s) => s.language);
}

/**
 * The language of a buyer's message. Latin letters alone mean English —
 * a buyer writing "bele estu?" in English letters gets an English reply.
 */
export function detectLanguage(text: string): Language {
  // A script we do not support can never become the reply language.
  const found = supportedScriptsIn(text);
  if (found.length === 0) return 'english';
  if (found.length === 1) return found[0];

  // Mixed input: go with whichever script he used most.
  const counts = found.map((language) => {
    const spec = SCRIPTS.find((s) => s.language === language)!;
    const all = new RegExp(spec.test.source, 'g');
    return { language, n: (text.match(all) ?? []).length };
  });
  counts.sort((a, b) => b.n - a.n);
  return counts[0].language;
}

/**
 * True when a reply mixes two Indian scripts — never acceptable, and the exact
 * failure this module exists to catch.
 */
export function mixesIndianScripts(text: string): boolean {
  return scriptsIn(text).length > 1;
}

/** True when the reply is not in the language we asked for. */
export function isWrongLanguage(reply: string, expected: Language): boolean {
  const found = scriptsIn(reply);
  if (expected === 'english') return found.length > 0;
  return !found.includes(expected) || found.length > 1;
}

export const LANGUAGE_NAMES: Record<Language, string> = {
  english: 'English',
  kannada: 'Kannada',
  telugu: 'Telugu',
  hindi: 'Hindi',
  tamil: 'Tamil',
};

/**
 * Telugu and Kannada sit in adjacent Unicode blocks with the SAME layout —
 * every Telugu letter is exactly 0x80 below its Kannada twin (క U+0C15 /
 * ಕ U+0C95). Models mix the two constantly, producing a Telugu sentence with a
 * handful of Kannada letters in the middle of words.
 *
 * Because the blocks align, that is repairable in code with no guessing: shift
 * the stray characters into the right block. A character is only moved when the
 * result is a real letter in the target script, so nothing is invented.
 */
const BLOCK_OFFSET = 0x80;

/**
 * Only a light touch is safe. A handful of stray letters is a typo and worth
 * shifting; a message that is MOSTLY the other script is genuinely the wrong
 * language, and transliterating it would produce Kannada words spelled in
 * Telugu letters — script-correct gibberish, which is worse than admitting
 * defeat. Above this share of stray letters, refuse and let the caller
 * translate properly.
 */
const MAX_STRAY_SHARE = 0.15;

export function repairConfusableScript(text: string, target: Language): string {
  if (target !== 'telugu' && target !== 'kannada') return text;

  const strayIsKannada = target === 'telugu';
  const strayPattern = strayIsKannada ? /\p{Script=Kannada}/u : /\p{Script=Telugu}/u;
  const targetPattern = target === 'telugu' ? /\p{Script=Telugu}/u : /\p{Script=Kannada}/u;

  const chars = [...text];
  const stray = chars.filter((c) => strayPattern.test(c)).length;
  const onTarget = chars.filter((c) => targetPattern.test(c)).length;
  const indic = stray + onTarget;

  if (stray === 0 || indic === 0) return text;
  if (stray / indic > MAX_STRAY_SHARE) return text; // wrong language, not a typo

  return chars
    .map((ch) => {
      if (!strayPattern.test(ch)) return ch;
      const shifted = String.fromCodePoint(
        ch.codePointAt(0)! + (strayIsKannada ? -BLOCK_OFFSET : BLOCK_OFFSET),
      );
      return targetPattern.test(shifted) ? shifted : ch;
    })
    .join('');
}
