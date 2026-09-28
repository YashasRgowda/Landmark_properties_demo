import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, messages, type Lead } from '@/lib/db/schema';
import { getProjectData, type ProjectInfo } from '@/lib/project-data';
import { runAI } from './run';
import type { AIMessage } from './provider';
import {
  detectLanguage,
  isWrongLanguage,
  LANGUAGE_NAMES,
  repairConfusableScript,
  scriptsIn,
  type Language,
} from './language';

/**
 * Meera — the conversation.
 *
 * She reads and writes. She decides nothing: no scheduling, no scoring, no
 * routing. The code does all of that (golden rule 1).
 */

/** How much of the conversation she sees. Enough for context, not the world. */
const HISTORY_LIMIT = 24;

export function buildSystemPrompt(
  project: ProjectInfo,
  lead: Pick<Lead, 'name'>,
  language: Language,
): string {
  const plots = project.plots
    .map((p) => `- ${p.size} (${p.sqft} sq ft) — ${p.price} — ${p.available} available${p.facing ? `, ${p.facing} facing` : ''}`)
    .join('\n');

  return `You are Meera, who answers enquiries for ${project.developer}, a plotted-development company in ${project.location}.

You are messaging on WhatsApp. Write the way a warm, competent person writes there:
- Short sentences. A blank line between separate thoughts.
- Two or three lines usually. Never a wall of text.
- No bullet points, no headings, no markdown, no emoji except at most one when it truly fits.
- Never start with "Dear" or sign off with your name.
- Write numbers as digits, exactly as they appear below: "₹42 lakh", "₹3,500 per sq ft", "30x40". Never spell a number out in words.
- Never translate a name. Place names, the project name, survey numbers, certificate numbers and people's names stay exactly as written below, whatever language you are replying in. Rajanukunte is always Rajanukunte.

LANGUAGE — THIS OVERRIDES EVERYTHING ELSE
His latest message is in ${LANGUAGE_NAMES[language]}. Reply ONLY in ${LANGUAGE_NAMES[language]}.

Write the WHOLE reply in ${LANGUAGE_NAMES[language]} script, every sentence, including the question at the end.
Earlier messages in this chat may be in other languages. Ignore them completely — they do not decide this reply.
Never put two Indian scripts in one message. Product words like "sq ft", "lakh" and "30x40" may stay in English letters.
${lead.name ? `His name is ${lead.name}.` : ''}

WHAT YOU MAY SAY
Everything below is true and approved. You may say nothing beyond it.

Project: ${project.name} by ${project.developer}
Where: ${project.location}. ${project.landmark}
Size: ${project.total_area}
Survey number: ${project.survey_number}

Plots:
${plots}

Rate: ${project.price_per_sqft}
Booking amount: ${project.booking_amount}
Possession: ${project.possession}
Registration: ${project.registration}

Approvals:
- DC conversion: ${project.approvals.dc_conversion}
- E-Khata: ${project.approvals.e_khata}
- RERA: ${project.approvals.rera}
- Loans available from: ${project.approvals.bank_approvals.join(', ')}

Amenities: ${project.amenities.join(', ')}

Site visits: ${project.site_timings}
Site address: ${project.site_address}
Map: ${project.maps_link}
Pickup: ${project.pickup}

Documents you can offer to send: ${project.documents_available.join(', ')}

SENDING A DOCUMENT
Naming one of those documents attaches the PDF to this very reply, automatically. So:
- Say it is attached or that you are sending it now. Never "I will send it later", never "by tomorrow", never "I will ask the office".
- Never ask for an email address or a different number. It goes out on this chat.
- Name the document exactly as it is written above, in English, even when the rest of your reply is in another language.
- Only ever name a document from that list. If he wants something else, say ${project.sales_head.name} will arrange it.

HARD RULES
${project.never.map((n) => `- ${n}`).join('\n')}
- If you are asked something not covered above, say plainly that you will have ${project.sales_head.name} confirm it, and give his number: ${project.sales_head.phone}. Never guess.
- If asked about EMI, interest rates or loan eligibility, do not calculate anything. Say the banks above give loans on this project and ${project.sales_head.name} will put him in touch with the right person.
- If he asks for a discount, you may mention ${project.approved_offers.description} Anything lower must go to ${project.sales_head.name}.
- If he asks whether you are a person or a bot, tell him honestly that you are an assistant, then carry on helping.

HOW YOU SELL
Buyers in this corridor are mainly afraid the land is not legally clean. So lead with the proof: DC conversion, E-Khata, survey number, RERA. Offer the documents early and without being asked.

Find out, naturally and one question at a time, never as a form:
- his budget
- when he wants to buy
- whether it is to build his own house or to invest

Ask one question per message at most, and only after you have answered his.

Your goal is a site visit on a specific day and time, within ${project.site_timings}. When he agrees, pin it down: "Sunday 11 AM — shall I confirm that?" Never leave it as "sometime this week".`;
}

/** The message sent when the AI cannot be reached. The buyer never sees an error. */
export function fallbackMessage(project: ProjectInfo): string {
  return `Thank you for your interest in ${project.name}, ${project.location}.

Our sales head ${project.sales_head.name} will call you shortly. If it is urgent, you can reach him on ${project.sales_head.phone}.`;
}

/**
 * The conversation so far, oldest first, as the AI expects it.
 *
 * Two rules the model enforces and we must respect:
 *  - it cannot start with the assistant
 *  - it cannot END with the assistant
 *
 * The second one bites in production: WhatsApp timestamps are second-precision,
 * so a reply that arrives at 12:00:05.000 sorts before our own message sent at
 * 12:00:05.800, and the history ends on our turn. Left unhandled, Meera falls
 * back to the canned message for no visible reason.
 */
export async function loadHistory(leadId: string): Promise<AIMessage[]> {
  const rows = await db
    .select({ direction: messages.direction, body: messages.body })
    .from(messages)
    .where(eq(messages.leadId, leadId))
    .orderBy(asc(messages.sentAt))
    .limit(200);

  const turns = rows.slice(-HISTORY_LIMIT).map((m) => ({
    role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
    content: m.body,
  }));

  // Drop our own messages from both ends.
  while (turns.length > 0 && turns[0].role === 'assistant') turns.shift();
  while (turns.length > 0 && turns[turns.length - 1].role === 'assistant') turns.pop();

  return turns;
}

export type MeeraReply = { text: string; usedFallback: boolean };

/**
 * The most time a reply may take to compose, AI and all. After this the buyer
 * gets the fallback — a plain, honest handover to the sales head — instead.
 *
 * This is the promise the whole system rests on: every message is answered.
 * Without a budget, a slow AI kept retrying past the hosting platform's
 * 60-second limit, the process was killed, and the buyer received nothing at
 * all — not even the fallback that exists for exactly that case.
 */
export const REPLY_BUDGET_MS = 25_000;

/** Not worth starting another attempt with less than this left. */
const MIN_ATTEMPT_MS = 4_000;

/**
 * Work out what to say next. Sending is the caller's job — that split is what
 * keeps the reply fast and the scoring out of the way (golden rule 3).
 */
export async function composeReply(lead: Lead): Promise<MeeraReply> {
  const deadlineAt = Date.now() + REPLY_BUDGET_MS;
  const timeLeft = () => deadlineAt - Date.now();

  const project = await getProjectData();

  const history = await loadHistory(lead.id);
  if (history.length === 0) {
    return { text: fallbackMessage(project), usedFallback: true };
  }

  // The language of what he just wrote wins. A stored preference from three
  // messages ago must never override it.
  const lastFromBuyer = [...history].reverse().find((m) => m.role === 'user');
  const language = detectLanguage(lastFromBuyer?.content ?? '');
  const system = buildSystemPrompt(project, lead, language);
  const name = LANGUAGE_NAMES[language];

  /**
   * A buyer who switches language mid-chat leaves a history full of the old
   * script, and the model drifts back to it however firmly it is told not to.
   * Two attempts to write it correctly, then — if it still comes back wrong —
   * translate, which is a far easier task and one models do reliably.
   */
  const attempts: { messages: AIMessage[]; temperature: number }[] = [
    { messages: history, temperature: 0.7 },
    { messages: withDirective(history, name), temperature: 0.3 },
    // Last resort before translating: show only the message being answered.
    // With no old-script history left, there is nothing to drift towards.
    { messages: withDirective(history.slice(-1), name), temperature: 0.2 },
  ];

  let best: string | null = null;

  for (const [index, attempt] of attempts.entries()) {
    if (timeLeft() < MIN_ATTEMPT_MS) {
      console.warn(`[meera] out of time after ${index} attempt(s); falling back`);
      break;
    }
    try {
      const result = await runAI('meera', lead.id, {
        system,
        messages: attempt.messages,
        maxTokens: 1200,
        temperature: attempt.temperature,
        deadlineAt,
      });

      const raw = tidy(result.text.trim());
      if (!raw) throw new Error('Meera returned nothing');

      // Telugu and Kannada letters get swapped mid-word. That is a character
      // problem, not a language problem, so fix it here instead of paying for
      // another call.
      const text = isWrongLanguage(raw, language)
        ? repairConfusableScript(raw, language)
        : raw;

      if (!isWrongLanguage(text, language)) return { text, usedFallback: false };

      console.warn(
        `[meera] attempt ${index + 1} expected ${language} but got [${scriptsIn(text).join(',') || 'latin only'}]`,
      );
      best = text; // keep the content; only the script is wrong
    } catch (error) {
      console.error('[meera] attempt failed:', error instanceof Error ? error.message : error);
    }
  }

  // The words were right, the script was not. Translating keeps the answer.
  if (best && timeLeft() >= MIN_ATTEMPT_MS) {
    const repaired = await translateTo(lead.id, best, language, deadlineAt);
    if (repaired) return { text: repaired, usedFallback: false };
  }

  // Better an honest handover than a reply the buyer cannot read.
  return { text: fallbackMessage(project), usedFallback: true };
}

/**
 * Rewrite a reply into the language it should have been in. Used only when
 * Meera produced the right answer in the wrong script.
 */
async function translateTo(
  leadId: string,
  text: string,
  language: Language,
  deadlineAt: number,
): Promise<string | null> {
  if (language === 'english') {
    // Nothing to translate into — strip is not safe, so give up.
    return null;
  }

  try {
    const result = await runAI('meera', leadId, {
      system: `You translate WhatsApp messages for a property company.

Rewrite the message below in ${LANGUAGE_NAMES[language]}, using ${LANGUAGE_NAMES[language]} script for every word.

Keep exactly as they are, never translated: numbers, prices like ₹42 lakh and ₹3,500, plot sizes like 30x40, the English terms sq ft, DC conversion, E-Khata, RERA, lakh, crore, and every name — Ashraya, Landmark Properties, Yelahanka, Rajanukunte, Bangalore, people's names, survey numbers and certificate numbers.
Keep the same line breaks. Do not add or remove anything. Reply with the translation only.`,
      messages: [{ role: 'user', content: text }],
      maxTokens: 1200,
      temperature: 0,
      deadlineAt,
    });

    const translated = repairConfusableScript(tidy(result.text.trim()), language);
    if (!translated || isWrongLanguage(translated, language)) {
      console.warn(`[meera] translation into ${language} also came back wrong`);
      return null;
    }
    return translated;
  } catch (error) {
    console.error('[meera] translation failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** Repeat the language instruction on the buyer's own turn, where it sticks. */
function withDirective(history: AIMessage[], languageName: string): AIMessage[] {
  if (history.length === 0) return history;
  const copy = history.map((m) => ({ ...m }));
  const last = copy[copy.length - 1];
  last.content = `${last.content}\n\n[Reply to this message entirely in ${languageName}. Use no other Indian script.]`;
  return copy;
}

/** Strip anything that looks like a chat transcript or markdown leaking through. */
/** Strip what models leak into a message: role labels, reasoning, markdown. */
export function tidy(text: string): string {
  return text
    .replace(/^\s*(meera|assistant)\s*:\s*/i, '')
    // Reasoning that escaped into the reply: "3. Drafting the response:".
    .replace(/^\s*\d+\.\s*(drafting|thinking|analys|consider|plan|step)[^\n]*\n?/gim, '')
    .replace(/^\s*(thought|reasoning|draft|analysis)\s*:\s*[^\n]*\n?/gim, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3500); // WhatsApp's limit is 4096; leave room.
}

/** Fetch a lead fresh — the caller may be holding a stale copy. */
export async function loadLead(leadId: string): Promise<Lead | null> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  return lead ?? null;
}
