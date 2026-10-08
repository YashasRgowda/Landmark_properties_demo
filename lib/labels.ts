/**
 * Every term the system uses internally, said the way a sales team says it.
 *
 * Screens never show a raw status like READ_NO_REPLY or a word like "chase".
 * If it is shown to a person, it comes from here — so the language is the same
 * on every screen, and changing a word changes it everywhere.
 */

export type Tone = 'hot' | 'warm' | 'cold' | 'good' | 'neutral' | 'bad' | 'gold' | 'info';

type Label = { label: string; tone: Tone; hint?: string };

export const LEAD_STATUS: Record<string, Label> = {
  NEW: { label: 'Just arrived', tone: 'info', hint: 'Our first WhatsApp is on its way' },
  MESSAGE_SENT: { label: 'Messaged', tone: 'neutral', hint: 'Waiting to see if it is read' },
  NOT_ON_WHATSAPP: { label: 'No WhatsApp', tone: 'bad', hint: 'Only reachable by phone' },
  DELIVERED_UNREAD: { label: 'Not opened yet', tone: 'neutral', hint: 'Got our WhatsApp, has not opened it' },
  READ_NO_REPLY: { label: 'Read, no reply', tone: 'warm', hint: 'Opened our WhatsApp but did not answer' },
  CHATTING: { label: 'Chatting', tone: 'good', hint: 'Talking with Meera on WhatsApp' },
  QUALIFIED: { label: 'Interested', tone: 'good', hint: 'Has shared what they are looking for' },
  WITH_AGENT: { label: 'With sales team', tone: 'gold', hint: 'An agent is handling this buyer' },
  VISIT_BOOKED: { label: 'Visit booked', tone: 'gold', hint: 'Coming to see the site' },
  VISITED: { label: 'Visited site', tone: 'gold', hint: 'Has seen the plots in person' },
  WON: { label: 'Bought', tone: 'good', hint: 'Booked a plot' },
  LOST: { label: 'Not interested', tone: 'neutral', hint: 'Will not be followed up' },
  REJECTED: { label: 'Not a buyer', tone: 'neutral', hint: 'A broker, or not genuinely buying' },
};

export const CATEGORY: Record<string, Label> = {
  HOT: { label: 'Hot', tone: 'hot', hint: 'Ready to buy soon' },
  WARM: { label: 'Warm', tone: 'warm', hint: 'Talking to us — still deciding' },
  COLD: { label: 'Cold', tone: 'cold', hint: 'Barely replying — keep nudging' },
  REJECT: { label: 'Not a buyer', tone: 'neutral', hint: 'Broker or not genuine' },
};
export const NOT_SCORED: Label = { label: 'New', tone: 'neutral', hint: 'Not enough chat yet to judge' };

/** Why a call is on someone's list — a full sentence, so nobody has to decode it. */
export const CALL_REASON: Record<string, Label> = {
  HOT_LEAD: { label: 'Hot buyer — ready to talk', tone: 'hot' },
  LATE_STAGE: { label: 'Was about to buy, then went quiet', tone: 'hot' },
  PHONE_ONLY: { label: 'Not on WhatsApp — phone is the only way', tone: 'bad' },
  DELIVERED_UNREAD: { label: 'Has not opened our WhatsApp', tone: 'neutral' },
  READ_NO_REPLY: { label: 'Read our WhatsApp but did not reply', tone: 'warm' },
  CHASE: { label: 'Has gone quiet — follow-up call', tone: 'warm' },
  NO_SHOW: { label: 'Missed the site visit — rebook', tone: 'warm' },
  VISIT_CHECK: { label: 'Visit time has passed — did they come?', tone: 'info' },
  CALLBACK: { label: 'Asked us to call back', tone: 'gold' },
};

export const CALL_OUTCOME: Record<string, string> = {
  ANSWERED: 'Spoke to them',
  NO_ANSWER: 'No answer',
  BUSY: 'Busy',
  CALLBACK_REQUESTED: 'Call back later',
  WRONG_NUMBER: 'Wrong number',
  NOT_INTERESTED: 'Not interested',
};

export const SOURCE: Record<string, string> = {
  '99acres': '99acres', magicbricks: 'MagicBricks', housing: 'Housing.com', 'housing.com': 'Housing.com',
  nobroker: 'NoBroker', whatsapp: 'WhatsApp', website: 'Website', facebook: 'Facebook',
  instagram: 'Instagram', google: 'Google', 'walk-in': 'Walk-in', referral: 'Referral',
};

export const TIMELINE: Record<string, string> = {
  '0-3 months': 'Within 3 months',
  '3-6 months': 'In 3 to 6 months',
  '6+ months': 'After 6 months',
};

export const PURPOSE: Record<string, string> = {
  own_construction: 'To build their own house',
  investment: 'As an investment',
};

export const LANGUAGE: Record<string, string> = {
  english: 'English', kannada: 'Kannada', telugu: 'Telugu', hindi: 'Hindi', tamil: 'Tamil',
};

export const VISIT_STATUS: Record<string, Label> = {
  BOOKED: { label: 'Booked', tone: 'gold' },
  ATTENDED: { label: 'Came', tone: 'good' },
  NO_SHOW: { label: 'Did not come', tone: 'bad' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const leadStatus = (s: string): Label => LEAD_STATUS[s] ?? { label: titleCase(s), tone: 'neutral' };
export const category = (c: string | null): Label => (c ? CATEGORY[c] ?? { label: titleCase(c), tone: 'neutral' } : NOT_SCORED);
export const callReason = (r: string): Label => CALL_REASON[r] ?? { label: titleCase(r), tone: 'neutral' };
export const sourceName = (s: string): string => SOURCE[s.toLowerCase()] ?? titleCase(s);

/** "2 hours ago", "in 10 minutes", "yesterday" — how people say time. */
export function relativeTime(at: Date | string | null | undefined, now = new Date()): string {
  if (!at) return '—';
  const diff = new Date(at).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const future = diff > 0;
  const m = Math.round(abs / 60_000);
  const h = Math.round(abs / 3_600_000);
  const d = Math.round(abs / 86_400_000);
  const say = (n: number, unit: string) => {
    const s = `${n} ${unit}${n === 1 ? '' : 's'}`;
    return future ? `in ${s}` : `${s} ago`;
  };
  if (m < 1) return future ? 'now' : 'just now';
  if (m < 60) return say(m, 'minute');
  if (h < 24) return say(h, 'hour');
  if (d === 1) return future ? 'tomorrow' : 'yesterday';
  if (d < 30) return say(d, 'day');
  return say(Math.round(d / 30), 'month');
}

/** A greeting for the time of day in India. */
export function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(now));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Initials for an avatar: "Priya Sharma" → "PS". */
export function initials(name: string | null | undefined): string {
  // The first LETTER of each word: "(broker)" gives B, not "(".
  const letters = (name ?? '').trim().split(/\s+/)
    .map((p) => /[a-zA-Zऀ-෿]/.exec(p)?.[0])
    .filter((l): l is string => Boolean(l));
  if (letters.length === 0) return '?';
  return (letters[0] + (letters.length > 1 ? letters[letters.length - 1] : '')).toUpperCase();
}
