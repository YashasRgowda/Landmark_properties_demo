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
- "visit_agreed" is true only when he accepted a SPECIFIC day. "I will come sometime" is false. "Sunday 11 AM" is true.
- "visit_datetime_iso" must be a full ISO timestamp with the +05:30 offset, in the future, and between 10:00 and 18:00 India time. Null if you cannot be certain.
- "visit_label" is the buyer's own words, such as "Sunday 11 AM".
- "disqualified" is true only for a broker, a wrong city, someone who has already bought, or someone who says clearly he is not buying.
- "summary" is one short line for the sales agent. Plain English, whatever language the chat was in.

Reply with the JSON object only.`;

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
  });

  const facts = parseReaderOutput(result.text);
  if (!facts) {
    console.error('[reader] could not parse output:', result.text.slice(0, 300));
    return null;
  }

  return { facts, usedFallback: false };
}
