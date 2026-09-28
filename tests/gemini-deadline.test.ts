import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../lib/ai/gemini';
import { RetryableAIError } from '../lib/ai/provider';

/**
 * The guarantee the whole reply path rests on: whatever Google does, the
 * provider gives up before the caller's deadline, so the caller always has
 * time to send the fallback. Google is replaced here by a fake whose every
 * behaviour — overloaded, out of quota, hanging forever — is scripted.
 */

type Behaviour = 'ok' | '503' | '429' | 'hang' | '404';
let script: Record<string, Behaviour> = {};
const calls: string[] = [];

function reply(text: string) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
  }), { status: 200 });
}

beforeEach(() => {
  script = {};
  calls.length = 0;
  process.env.GEMINI_MODELS = 'smart,backup,lite';
  process.env.GEMINI_API_KEYS = 'k1,k2,k3';
  delete process.env.GEMINI_API_BASE;
  (GeminiProvider as unknown as { benched: Map<string, number> }).benched.clear();
  GeminiProvider.modelsWithoutThinking.clear();

  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const model = /models\/([^:]+):/.exec(url)![1];
    const key = (init.headers as Record<string, string>)['x-goog-api-key'];
    calls.push(`${model}/${key}`);
    const behaviour = script[`${model}/${key}`] ?? script[model] ?? 'ok';

    if (behaviour === 'hang') {
      return new Promise<Response>((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }
    if (behaviour === '503') return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 });
    if (behaviour === '429') return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 });
    if (behaviour === '404') return new Response('{}', { status: 404 });
    return reply(`answered by ${model}`);
  }));
});

afterEach(() => vi.unstubAllGlobals());

const ask = (deadlineMs?: number) => new GeminiProvider().complete({
  system: 's', messages: [{ role: 'user', content: 'hi' }],
  ...(deadlineMs === undefined ? {} : { deadlineAt: Date.now() + deadlineMs }),
});

describe('a healthy model', () => {
  it('answers on the first call', async () => {
    const r = await ask(25_000);
    expect(r.text).toBe('answered by smart');
    expect(calls).toEqual(['smart/k1']);
  });
});

describe('an overloaded model is overloaded for every key', () => {
  it('THE DEMO BUG: a 503 moves straight to the next MODEL, not the next key', async () => {
    script.smart = '503';
    const r = await ask(25_000);
    expect(r.text).toBe('answered by backup');
    // Before: smart/k1, smart/k2, smart/k3 — three waits for the same answer.
    expect(calls).toEqual(['smart/k1', 'backup/k1']);
  });

  it('remembers, so the next buyer does not wait on it at all', async () => {
    script.smart = '503';
    await ask(25_000);
    calls.length = 0;
    const r = await ask(25_000);
    expect(r.text).toBe('answered by backup');
    expect(calls[0]).toBe('backup/k1');
  });

  it('still tries a resting model when nothing else works', async () => {
    script.smart = '503';
    await ask(25_000);                 // rests "smart"
    script.smart = 'ok';               // it recovers
    script.backup = '503';
    script.lite = '503';
    calls.length = 0;
    const r = await ask(25_000);
    expect(r.text).toBe('answered by smart');
  });
});

describe('a key out of quota', () => {
  it('tries the next key on the SAME model — the model is fine', async () => {
    script['smart/k1'] = '429';
    const r = await ask(25_000);
    expect(r.text).toBe('answered by smart');
    expect(calls).toEqual(['smart/k1', 'smart/k2']);
  });

  it('moves to the next model once every key is spent', async () => {
    script.smart = '429';
    const r = await ask(25_000);
    expect(r.text).toBe('answered by backup');
    expect(calls).toEqual(['smart/k1', 'smart/k2', 'smart/k3', 'backup/k1']);
  });
});

describe('THE GUARANTEE: never past the deadline', () => {
  it('gives up in time when Google hangs forever', async () => {
    script.smart = 'hang';
    script.backup = 'hang';
    script.lite = 'hang';
    const started = Date.now();
    await expect(ask(4_000)).rejects.toBeInstanceOf(RetryableAIError);
    const took = Date.now() - started;
    // Must leave the caller time to send the fallback.
    expect(took).toBeLessThan(4_500);
  }, 10_000);

  it('a hanging model is abandoned after 8 seconds, and the next one answers', async () => {
    script.smart = 'hang';
    const started = Date.now();
    const r = await ask(25_000);   // Meera's real budget
    expect(r.text).toBe('answered by backup');
    expect(Date.now() - started).toBeLessThan(9_000);
    // One wait on the slow model, not one per key.
    expect(calls.filter((c) => c.startsWith('smart'))).toHaveLength(1);
  }, 15_000);

  it('does not even start a request it has no time for', async () => {
    await expect(ask(1_000)).rejects.toBeInstanceOf(RetryableAIError);
    expect(calls).toHaveLength(0);
  });

  it('with no deadline given, it still answers normally', async () => {
    expect((await ask()).text).toBe('answered by smart');
  });
});

describe('other failures', () => {
  it('skips a model that does not exist', async () => {
    script.smart = '404';
    expect((await ask(25_000)).text).toBe('answered by backup');
  });

  it('fails cleanly when every model is overloaded', async () => {
    script.smart = '503';
    script.backup = '503';
    script.lite = '503';
    await expect(ask(25_000)).rejects.toBeInstanceOf(RetryableAIError);
    expect(calls).toEqual(['smart/k1', 'backup/k1', 'lite/k1']);
  });
});
