/**
 * The visit reminder's words. Built in code, not by the AI: a reminder is
 * nothing but facts — the day, the time, where to go — and a model paraphrasing
 * a map link or a time is a buyer standing at the wrong gate.
 */
import type { ProjectInfo } from './project-data-values';

export function visitReminderText(args: {
  name: string | null;
  when: string;
  project: ProjectInfo;
}): string {
  const first = args.name?.trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first},` : 'Hello,';
  const { project } = args;
  return `${hi} a reminder of your site visit to ${project.name} on ${args.when}.

Location: ${project.maps_link}
${project.pickup} — just reply here if you would like it, or if you need to change the time.`;
}
