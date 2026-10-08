import { describe, expect, it } from 'vitest';
import { QUIET_CALL_REASONS } from '@/lib/calls/create';
import { CALL_REASONS } from '@/lib/db/schema';

/**
 * A buyer asked for the sales head to call, then carried on chatting, and the
 * callback was cancelled forty seconds after it was raised — every open call
 * was wiped on any inbound message. The hot-lead call went the same way, so
 * the buyers who most needed a human got one only if they stopped talking.
 */
describe('which calls a reply makes pointless', () => {
  it('drops the ones that exist because he was silent', () => {
    expect([...QUIET_CALL_REASONS].sort())
      .toEqual(['CHASE', 'DELIVERED_UNREAD', 'PHONE_ONLY', 'READ_NO_REPLY']);
  });

  it('never drops a promise or a handover', () => {
    for (const kept of ['HOT_LEAD', 'CALLBACK', 'LATE_STAGE', 'NO_SHOW', 'VISIT_CHECK'] as const) {
      expect(QUIET_CALL_REASONS).not.toContain(kept);
    }
  });

  it('names only reasons that exist', () => {
    for (const reason of QUIET_CALL_REASONS) expect(CALL_REASONS).toContain(reason);
  });
});
