/**
 * Who gets the hot lead.
 *
 * Language first: a buyer who wrote in Kannada should not be rung by someone who
 * cannot hold the conversation. Among the agents who CAN speak to him, the one
 * carrying the fewest leads — that is the round-robin, done by load rather than
 * by a stored counter that drifts the moment someone goes on leave.
 *
 * Pure, so the fairness can be proved instead of assumed.
 */

export type AssignableAgent = {
  id: string;
  name: string;
  languages: string[];
  /** How many leads this agent already owns. */
  openLeads: number;
};

export type Assignment = {
  agent: AssignableAgent;
  /** True when the pick actually speaks his language. */
  languageMatched: boolean;
  because: string;
};

/**
 * `language` is the buyer's language as The Reader recorded it. English is
 * treated as a match for everyone: every agent here can sell in English.
 */
export function pickAgent(
  agents: AssignableAgent[],
  language: string | null | undefined,
): Assignment | null {
  if (agents.length === 0) return null;

  const wanted = (language ?? '').trim().toLowerCase();
  const speaks = (agent: AssignableAgent) =>
    agent.languages.some((l) => l.trim().toLowerCase() === wanted);

  // Fewest leads wins; id breaks ties so the choice is stable and testable.
  const byLoad = (a: AssignableAgent, b: AssignableAgent) =>
    a.openLeads - b.openLeads || a.id.localeCompare(b.id);

  if (wanted && wanted !== 'english') {
    const matching = agents.filter(speaks).sort(byLoad);
    if (matching.length > 0) {
      return {
        agent: matching[0],
        languageMatched: true,
        because: `speaks ${wanted} and is carrying the fewest leads (${matching[0].openLeads})`,
      };
    }
  }

  const anyone = [...agents].sort(byLoad);
  return {
    agent: anyone[0],
    languageMatched: !wanted || wanted === 'english' || speaks(anyone[0]),
    because: wanted && wanted !== 'english'
      ? `nobody speaks ${wanted}; gave him the agent carrying the fewest leads (${anyone[0].openLeads})`
      : `carrying the fewest leads (${anyone[0].openLeads})`,
  };
}
