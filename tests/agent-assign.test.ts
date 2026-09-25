import { describe, expect, it } from 'vitest';
import { pickAgent, type AssignableAgent } from '../lib/agents/assign';

const agent = (id: string, languages: string[], openLeads = 0): AssignableAgent =>
  ({ id, name: `Agent ${id}`, languages, openLeads });

describe('picking an agent for a hot lead', () => {
  it('prefers someone who speaks his language', () => {
    const pick = pickAgent([
      agent('a', ['english'], 0),
      agent('b', ['kannada', 'english'], 5),
    ], 'kannada');
    expect(pick?.agent.id).toBe('b');
    expect(pick?.languageMatched).toBe(true);
  });

  it('round-robins by load among those who can speak to him', () => {
    const pick = pickAgent([
      agent('a', ['kannada'], 7),
      agent('b', ['kannada'], 2),
      agent('c', ['kannada'], 4),
    ], 'kannada');
    expect(pick?.agent.id).toBe('b');
  });

  it('spreads work evenly as loads change', () => {
    const agents = [agent('a', ['kannada'], 0), agent('b', ['kannada'], 0)];
    const first = pickAgent(agents, 'kannada')!;
    first.agent.openLeads += 1;
    const second = pickAgent(agents, 'kannada')!;
    expect(second.agent.id).not.toBe(first.agent.id);
  });

  it('breaks a tie the same way every time', () => {
    const agents = [agent('z', ['tamil'], 3), agent('a', ['tamil'], 3)];
    expect(pickAgent(agents, 'tamil')?.agent.id).toBe('a');
    expect(pickAgent(agents, 'tamil')?.agent.id).toBe('a');
  });

  it('still assigns somebody when nobody speaks his language', () => {
    const pick = pickAgent([agent('a', ['tamil'], 4), agent('b', ['hindi'], 1)], 'kannada');
    expect(pick?.agent.id).toBe('b');
    expect(pick?.languageMatched).toBe(false);
    expect(pick?.because).toContain('nobody speaks kannada');
  });

  it('treats English as something every agent can handle', () => {
    const pick = pickAgent([agent('a', ['kannada'], 9), agent('b', ['tamil'], 1)], 'english');
    expect(pick?.agent.id).toBe('b');
    expect(pick?.languageMatched).toBe(true);
  });

  it('copes with an unknown language, and with none at all', () => {
    for (const language of [null, undefined, '', '  ', 'klingon']) {
      const pick = pickAgent([agent('a', ['kannada'], 5), agent('b', ['tamil'], 0)], language);
      expect(pick?.agent.id, String(language)).toBe('b');
    }
  });

  it('is case- and space-insensitive about languages', () => {
    const pick = pickAgent([agent('a', ['English'], 3), agent('b', [' Kannada '], 8)], 'KANNADA');
    expect(pick?.agent.id).toBe('b');
  });

  it('returns nothing when there is nobody to assign', () => {
    expect(pickAgent([], 'kannada')).toBeNull();
  });
});
