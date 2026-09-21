import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meta signs every webhook delivery with your app secret:
 *   X-Hub-Signature-256: sha256=<hex hmac of the RAW request body>
 *
 * The raw bytes matter. Re-serialising the parsed JSON changes key order and
 * whitespace, and the signature will never match.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null | undefined,
  appSecret: string | undefined,
): boolean {
  if (!header || !appSecret) return false;

  const prefix = 'sha256=';
  if (!header.startsWith(prefix)) return false;

  const provided = header.slice(prefix.length).trim();
  if (!/^[0-9a-f]+$/i.test(provided)) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  const a = Buffer.from(provided.toLowerCase(), 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
