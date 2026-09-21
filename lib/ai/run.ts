import 'server-only';
import { db } from '@/lib/db';
import { aiCalls } from '@/lib/db/schema';
import { GeminiProvider } from './gemini';
import { ClaudeProvider } from './claude';
import type { AIProvider, CompleteOptions, CompleteResult } from './provider';

export type AIJob = 'meera' | 'reader' | 'writer';

/** One place to change the model for the whole system. */
export function provider(): AIProvider {
  return (process.env.AI_PROVIDER ?? 'gemini').toLowerCase() === 'claude'
    ? new ClaudeProvider()
    : new GeminiProvider();
}

/**
 * Run an AI job and record it in `ai_calls` — success or failure — so cost and
 * problems are visible. Logging never breaks the call it is logging.
 */
export async function runAI(
  job: AIJob,
  leadId: string | null,
  opts: CompleteOptions,
): Promise<CompleteResult> {
  const p = provider();
  const startedAt = Date.now();

  try {
    const result = await p.complete(opts);
    void log({
      job, leadId, provider: p.name, model: result.model,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      latencyMs: Date.now() - startedAt, success: true, error: null,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void log({
      job, leadId, provider: p.name, model: process.env.GEMINI_MODELS?.split(',')[0] ?? 'unknown',
      inputTokens: null, outputTokens: null,
      latencyMs: Date.now() - startedAt, success: false, error: message.slice(0, 1000),
    });
    throw error;
  }
}

type LogRow = {
  job: AIJob;
  leadId: string | null;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  success: boolean;
  error: string | null;
};

async function log(row: LogRow): Promise<void> {
  try {
    await db.insert(aiCalls).values(row);
  } catch (error) {
    console.error('[ai] could not record the call', error);
  }
}
