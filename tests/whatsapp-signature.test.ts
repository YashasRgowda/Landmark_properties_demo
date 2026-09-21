import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaSignature } from '@/lib/whatsapp/signature';

const SECRET = 'test-app-secret';
const BODY = JSON.stringify({ entry: [{ id: '1' }] });
const sign = (body: string, secret = SECRET) =>
  'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');

describe('verifyMetaSignature', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyMetaSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it('rejects a body that was changed after signing', () => {
    const tampered = BODY.replace('"1"', '"2"');
    expect(verifyMetaSignature(tampered, sign(BODY), SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyMetaSignature(BODY, sign(BODY, 'other-secret'), SECRET)).toBe(false);
  });

  it('rejects missing, malformed and unsigned requests', () => {
    expect(verifyMetaSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyMetaSignature(BODY, '', SECRET)).toBe(false);
    expect(verifyMetaSignature(BODY, 'sha256=', SECRET)).toBe(false);
    expect(verifyMetaSignature(BODY, 'not-a-signature', SECRET)).toBe(false);
    expect(verifyMetaSignature(BODY, sign(BODY).replace('sha256=', ''), SECRET)).toBe(false);
    expect(verifyMetaSignature(BODY, 'sha256=zzzz', SECRET)).toBe(false);
  });

  it('rejects everything when the app secret is not configured', () => {
    expect(verifyMetaSignature(BODY, sign(BODY), undefined)).toBe(false);
    expect(verifyMetaSignature(BODY, sign(BODY), '')).toBe(false);
  });

  it('is sensitive to key order, so the raw body must be used', () => {
    const a = JSON.stringify({ x: 1, y: 2 });
    const b = JSON.stringify({ y: 2, x: 1 });
    expect(verifyMetaSignature(b, sign(a), SECRET)).toBe(false);
  });
});
