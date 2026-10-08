import 'server-only';
import { formatInTimeZone } from 'date-fns-tz';
import { TIMEZONE } from '@/lib/time-window';
import { getProjectData } from '@/lib/project-data';
import { runAI } from './run';
import { loadHistory } from './meera';
import { parseReaderOutput, type ReaderResult } from './reader-schema';

/**
 * The Reader — pulls facts out of the conversation.
 *
 * It reports; it does not judge. Whether the lead is hot is decided by
 * lib/scoring.ts, in code.
 */

const SYSTEM = `You read a WhatsApp conversation between a plot buyer and a sales assistant, and report what the buyer revealed.

Report only what the BUYER said. Never infer from what the assistant said, and never invent.

Return one JSON object with exactly these keys:

{
  "name": string or null,
  "budget": string or null,
  "timeline": "0-3 months" | "3-6 months" | "6+ months" | null,
  "purpose": "own_construction" | "investment" | null,
  "interested_plot": string or null,
  "language": "english" | "kannada" | "telugu" | "hindi" | "tamil",
  "asked_for_documents": boolean,
  "asked_about_loan": boolean,
  "asked_about_registration_or_possession": boolean,
  "asked_about_specific_plot": boolean,
  "asked_about_price_or_offer": boolean,
  "wants_a_call": boolean,
  "engaged": boolean,
  "visit_agreed": boolean,
  "visit_datetime_iso": string or null,
  "visit_label": string or null,
  "disqualified": boolean,
  "disqualify_reason": string or null,
  "summary": string
}

Rules:
- "language" is the language the BUYER writes in.
- "asked_for_documents" is true if he asked FOR or ABOUT the khata, E-Khata, DC conversion, RERA, the layout plan, the encumbrance certificate or any approval. "Is it E-Khata?" counts. "Send me the khata" counts.
- "wants_a_call" is true if he asked to be phoned, asked for someone's number, asked to speak to a person or the sales head, or agreed when we offered to have someone call him. "Shall I have Ravi call you?" ... "fine" counts.
- "asked_about_price_or_offer" is true if he asked the price or rate, asked for a discount, haggled, said the price is too high, or asked what offers are running.
- "engaged" is true if the buyer is genuinely talking to us about buying a plot here: he asks questions, answers ours, negotiates, or gives his requirements. It is FALSE only for someone who barely replies ("ok", "hmm", "later"), talks about something unrelated, or never engages with the project at all. A buyer who argues about the price IS engaged.
- "asked_about_specific_plot" is true if he named a plot SIZE or dimension (30x40, 40x60, 1200 sq ft), a plot number, a facing, or asked which plots are free. "What is the price of a 30x40?" counts.
- "interested_plot" is the size, dimension or plot number he asked about, in his own words.
- "asked_about_loan" is true if he asked about a plot loan, EMI, bank finance or which banks fund it.
- "asked_about_registration_or_possession" is true if he asked when registration happens, what it costs, or when he can take possession or start building.
- "visit_agreed" is true only when he accepted a SPECIFIC day. "I will come sometime" is false. "Sunday 11 AM" is true.

VISIT TIME — read the conversation to the END before answering these three keys.
- A conversation MOVES. If several times were discussed, report ONLY the one agreed LAST. An earlier suggestion that was replaced is wrong, even though it appears in the chat.
- Read it as a negotiation: he suggests, she offers, he settles. The settled time is the answer. "Can we do 6?" ... "5 would suit us better" ... "ok 5 then" means FIVE, not six.
- If he later asks to move or cancel it, the new time wins. If he cancelled and named nothing new, "visit_agreed" is false.
- If you cannot tell which of two times was the final one, set "visit_agreed" false and both time keys null. A missing booking is fixable; a wrong one sends him to a locked gate.
- "visit_datetime_iso" must be a full ISO timestamp with the +05:30 offset, in the future, and between 10:00 and 18:00 India time.
- "visit_label" is the FINAL agreed slot in the buyer's own words, such as "Sunday 11 AM" — not the first time he floated. It must name the same hour as "visit_datetime_iso".
- "disqualified" is true only for a broker, a wrong city, someone who has already bought, or someone who says clearly he is not buying.
- "summary" is one short line for the sales agent. Plain English, whatever language the chat was in.

Reply with the JSON object only.`;

/** Longest a scoring pass may spend waiting on the AI. */
const READER_BUDGET_MS = 30_000;

export type ReadResult = {
  facts: ReaderResult;
  usedFallback: boolean;
};

export async function readConversation(leadId: string): Promise<ReadResult | null> {
  const history = await loadHistory(leadId);
  if (history.length === 0) return null;

  const project = await getProjectData();
  const nowIst = formatInTimeZone(new Date(), TIMEZONE, "EEEE d MMMM yyyy, h:mm a 'IST'");

  const transcript = history
    .map((m) => `${m.role === 'user' ? 'BUYER' : 'ASSISTANT'}: ${m.content}`)
    .join('\n\n');

  const result = await runAI('reader', leadId, {
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Right now it is ${nowIst}. Site visit hours are ${project.site_timings}.\n\nConversation:\n\n${transcript}`,
      },
    ],
    json: true,
    maxTokens: 1500,
    temperature: 0,
    // Scoring runs in the background, but in the same 60-second function as
    // the reply. It must finish — or give up and retry later — well inside it.
    deadlineAt: Date.now() + READER_BUDGET_MS,
  });

  const facts = parseReaderOutput(result.text);
  if (!facts) {
    console.error('[reader] could not parse output:', result.text.slice(0, 300));
    return null;
  }

  return { facts, usedFallback: false };
}
