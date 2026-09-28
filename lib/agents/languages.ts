/** Languages an agent can sell in — the same five Meera speaks. */
export const AGENT_LANGUAGES = ['english', 'kannada', 'hindi', 'telugu', 'tamil'] as const;
export type AgentLanguage = (typeof AGENT_LANGUAGES)[number];
