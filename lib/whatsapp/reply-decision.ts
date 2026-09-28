/**
 * Should this message get a reply?
 *
 * Pure, so every case below is tested directly. Two rules, and together they
 * are what stop a buyer ever getting silence or getting answered twice:
 *
 *  1. Only the buyer's NEWEST message is answered. When he writes twice
 *     quickly, the newer message's own task replies, and Meera sees both in
 *     the history. The older task stands down.
 *  2. Never answer the same newest message twice. Replies record which buyer
 *     message Meera had seen when she wrote them; if one already covers the
 *     newest message, a retry stands down.
 *
 * The failure this was written for: a buyer's "hi" was cut off mid-reply,
 * stranded, and picked up ten minutes later — by which time the chat had moved
 * on — and it answered his latest question a second time.
 */

export type ReplyDecision =
  | { reply: true }
  | { reply: false; because: string };

export function decideReply(args: {
  /** Meta's id for the message this task is handling. */
  forMessage: string;
  /** Meta's id for the buyer's newest message, or null if there is none. */
  latestInbound: string | null;
  /** True when a reply already exists that had seen `latestInbound`. */
  latestAlreadyAnswered: boolean;
}): ReplyDecision {
  if (!args.latestInbound) {
    return { reply: false, because: 'there is no buyer message to answer' };
  }
  if (args.latestInbound !== args.forMessage) {
    return {
      reply: false,
      because: 'he has written again since — that message will be answered, with this one in view',
    };
  }
  if (args.latestAlreadyAnswered) {
    return { reply: false, because: 'his latest message has already been answered' };
  }
  return { reply: true };
}
