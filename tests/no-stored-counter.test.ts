import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The spec: how many times a lead was contacted is computed from `touches`,
 * never stored. The old column still exists; this makes sure nothing uses it.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name.startsWith('.') ? [] : files(path);
    return /\.(ts|tsx|mts)$/.test(name) ? [path] : [];
  });
}

describe('the contact count is computed, never stored', () => {
  it('no code reads or writes attemptCount / attempt_count', () => {
    const offenders = [...files('lib'), ...files('app'), ...files('scripts')]
      .filter((f) => f !== join('lib', 'db', 'schema.ts'))
      .filter((f) => /attemptCount|attempt_count/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
