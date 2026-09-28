import { describe, expect, it } from 'vitest';
import { decideReply } from '../lib/whatsapp/reply-decision';

describe('whether a message gets a reply', () => {
  it('answers a new message', () => {
    expect(decideReply({ forMessage: 'm1', latestInbound: 'm1', latestAlreadyAnswered: false }))
      .toEqual({ reply: true });
  });

  it('THE DEMO BUG: a stranded old message does not answer the chat a second time', () => {
    // "hi" was stuck; by the time it ran, "investment?" had been asked and answered.
    const d = decideReply({ forMessage: 'hi', latestInbound: 'investment', latestAlreadyAnswered: true });
    expect(d.reply).toBe(false);
  });

  it('a retry after the reply went out does not send it again', () => {
    const d = decideReply({ forMessage: 'm1', latestInbound: 'm1', latestAlreadyAnswered: true });
    expect(d.reply).toBe(false);
    expect(!d.reply && d.because).toMatch(/already been answered/);
  });

  it('a retry after the send failed DOES reply', () => {
    expect(decideReply({ forMessage: 'm1', latestInbound: 'm1', latestAlreadyAnswered: false }).reply)
      .toBe(true);
  });

  it('two quick messages get one reply, from the newer one', () => {
    const older = decideReply({ forMessage: 'm1', latestInbound: 'm2', latestAlreadyAnswered: false });
    const newer = decideReply({ forMessage: 'm2', latestInbound: 'm2', latestAlreadyAnswered: false });
    expect(older.reply).toBe(false);
    expect(newer.reply).toBe(true);
  });

  it('a message sent while Meera was composing still gets its own answer', () => {
    // Her reply recorded m1 as what it had seen, so m2 is not "already answered".
    expect(decideReply({ forMessage: 'm2', latestInbound: 'm2', latestAlreadyAnswered: false }).reply)
      .toBe(true);
  });

  it('never replies when there is nothing to reply to', () => {
    expect(decideReply({ forMessage: 'm1', latestInbound: null, latestAlreadyAnswered: false }).reply)
      .toBe(false);
  });

  it('always explains a refusal', () => {
    for (const d of [
      decideReply({ forMessage: 'a', latestInbound: 'b', latestAlreadyAnswered: false }),
      decideReply({ forMessage: 'a', latestInbound: 'a', latestAlreadyAnswered: true }),
      decideReply({ forMessage: 'a', latestInbound: null, latestAlreadyAnswered: false }),
    ]) {
      expect(!d.reply && d.because.length).toBeGreaterThan(10);
    }
  });
});
