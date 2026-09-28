import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages, type Lead } from '@/lib/db/schema';
import { getProjectData } from '@/lib/project-data';
import type { ChasePurpose } from '@/lib/chase';
import { runAI } from './run';
import { buildSystemPrompt, tidy } from './meera';
import {
  detectLanguage,
  isWrongLanguage,
  repairConfusableScript,
  type Language,
} from './language';
import { fallbackFollowUp, inventedFigures, purposeInstruction } from './writer-rules';

/**
 * The Writer — the AI's third job. It writes the follow-ups for buyers who
 * have gone quiet.
 *
 * It is given Meera's own system prompt, so it knows exactly the same approved
 * facts and obeys exactly the same rules; there is no second copy of the
 * project to drift out of date. What it writes is then checked in code — right
 * language, no price the project does not have — and if either check fails, a
 * plain pre-written message goes instead. A follow-up is never urgent enough to
 * risk a wrong price.
 */

export type FollowUp = { text: string; usedFallback: boolean; why?: string };

/** The Writer runs in the background, but in the same 60s function as other work. */
const WRITER_BUDGET_MS = 25_000;
const MIN_ATTEMPT_MS = 4_000;
const LANGUAGES: Language[] = ['english', 'kannada', 'telugu', 'hindi', 'tamil'];

export async function composeFollowUp(args: {
  lead: Lead;
  purpose: ChasePurpose;
  /** For a new-date offer: the slots, already formatted for a person. */
  slots?: string[];
}): Promise<FollowUp> {
  const { lead, purpose, slots = [] } = args;
  const project = await getProjectData();
  const fallback = (why: string): FollowUp => ({
    text: fallbackFollowUp(purpose, project, lead.name, slots),
    usedFallback: true,
    why,
  });

  const deadlineAt = Date.now() + WRITER_BUDGET_MS;

  // His language: what he last wrote in, else what The Reader recorded.
  const [lastInbound] = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.leadId, lead.id), eq(messages.direction, 'inbound')))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  const language: Language = lastInbound
    ? detectLanguage(lastInbound.body)
    : LANGUAGES.includes(lead.language as Language) ? (lead.language as Language) : 'english';

  const recent = await db
    .select({ direction: messages.direction, body: messages.body })
    .from(messages)
    .where(eq(messages.leadId, lead.id))
    .orderBy(asc(messages.sentAt))
    .limit(200);
  const transcript = recent
    .slice(-10)
    .map((m) => `${m.direction === 'inbound' ? 'BUYER' : 'YOU'}: ${m.body}`)
    .join('\n');

  const system = `${buildSystemPrompt(project, lead, language)}

THIS MESSAGE IS A FOLLOW-UP YOU ARE STARTING — NOT A REPLY
${purposeInstruction(purpose, project, slots)}
- Two to four short lines.
- Do not say you are sending or attaching any document in this message.
- Never claim you spoke to him, or that he said anything he did not say.
- Write only the message itself.`;

  const context = [
    lead.summary ? `What we know about him: ${lead.summary}` : null,
    transcript ? `The conversation so far:\n${transcript}` : 'You have not heard from him yet.',
    'Write the follow-up now.',
  ].filter(Boolean).join('\n\n');

  let lastProblem = 'the Writer was not tried';

  for (const temperature of [0.6, 0.3]) {
    if (deadlineAt - Date.now() < MIN_ATTEMPT_MS) {
      lastProblem = 'ran out of time';
      break;
    }
    try {
      const result = await runAI('writer', lead.id, {
        system,
        messages: [{ role: 'user', content: context }],
        maxTokens: 800,
        temperature,
        deadlineAt,
      });

      let text = tidy(result.text);
      if (!text) { lastProblem = 'wrote nothing'; continue; }
      if (isWrongLanguage(text, language)) text = repairConfusableScript(text, language);
      if (isWrongLanguage(text, language)) { lastProblem = `wrote in the wrong language (wanted ${language})`; continue; }

      const invented = inventedFigures(text, project);
      if (invented.length) { lastProblem = `quoted a price we do not have: ₹${invented.join(', ₹')}`; continue; }

      // Offered slots must survive: the time is written in digits in every language.
      if (purpose === 'new_date' && !/11/.test(text)) { lastProblem = 'left out the offered times'; continue; }

      return { text, usedFallback: false };
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }
  }

  console.warn(`[writer] using the safe message for ${purpose}: ${lastProblem}`);
  return fallback(lastProblem);
}
