/**
 * Does this inbound message mean "stop messaging me"?
 *
 * Deliberately strict: the whole message must be the keyword, ignoring case,
 * spacing and punctuation. A loose regex is how the old prototype broke — it
 * matched fragments inside ordinary sentences (mistake 3). "Please don't stop
 * sending me updates" must NOT opt someone out.
 */
const KEYWORDS = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'optout',
  'opt out',
  'remove me',
  'removeme',
  'cancel',
  'quit',
  'end',
]);

export function isOptOutMessage(body: string | null | undefined): boolean {
  if (!body) return false;

  const cleaned = body
    .trim()
    .toLowerCase()
    .replace(/[.!,;:'"()\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return false;
  if (KEYWORDS.has(cleaned)) return true;

  // "opt-out" and "opt_out" spellings
  return KEYWORDS.has(cleaned.replace(/[-_]/g, ' ')) || KEYWORDS.has(cleaned.replace(/[-_]/g, ''));
}
