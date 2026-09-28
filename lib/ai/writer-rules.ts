/**
 * The Writer's rules that are code, not prompt.
 *
 * Pure, so they are tested directly. The Writer writes each follow-up; these
 * decide what it is asked for, what it may not say, and what goes out instead
 * when its message cannot be trusted.
 */
import type { ChasePurpose } from '../chase';
import type { ProjectInfo } from '../project-data-values';

/** What each follow-up is for, told to the Writer in plain words. */
export function purposeInstruction(
  purpose: ChasePurpose,
  project: ProjectInfo,
  slots: string[] = [],
): string {
  switch (purpose) {
    case 'reintroduce':
      return `He enquired but has not replied to anything yet. Give him one concrete reason to take a look: the legal papers are all in place (DC conversion, E-Khata, RERA) and plots start at ${project.entry_price}. End with one easy question — would he like the price list, or a site visit this weekend. Never mention that he has not replied.`;
    case 'check_in':
      return 'He was chatting with you and stopped two days ago. Pick up exactly where the conversation left off — refer to what he was interested in — and ask one simple question that moves things forward. No guilt, no pressure.';
    case 'in_writing':
      return `Our team tried to call him and could not reach him. Say so in one short line, then put the essentials in writing: the price for the plot size he was interested in (or the entry price, ${project.entry_price}), that the approvals are done, and the free site visit with pickup. Offer to send the price list.`;
    case 'missed_visit':
      return 'He had a site visit booked today and did not come. Kindly check that he is all right. No pressure and no blame — say another time can be arranged whenever suits him.';
    case 'new_date':
      return `He missed his site visit. Offer exactly these two times, written as given: ${slots.join(' or ')}, with ${project.pickup.toLowerCase()}. Ask which suits him.`;
    case 'feedback':
      return 'He visited the site. Thank him for coming and ask what he thought of the plots.';
    case 'objections':
      return `He visited but has gone quiet. People at this stage usually hesitate over the price, the loan or the paperwork. Answer those briefly using only the facts above — the offer (${project.approved_offers.description}), the banks that give loans, and the approvals — then ask what is holding him back.`;
    case 'drip':
      return 'He has not replied for a long time. A short, friendly update with no pressure: how many plots of the most popular size are still available, and that he is welcome to visit any day. No question needed.';
  }
}

/**
 * Every rupee figure the project data contains, reduced to its digits.
 * "₹3,500 per sq ft" → "3500", "₹1.4 crore" → "1.4".
 */
export function approvedFigures(project: ProjectInfo): Set<string> {
  const all = JSON.stringify(project);
  return new Set([...all.matchAll(/₹\s?([\d][\d,.]*)/g)].map((m) => normaliseFigure(m[1])));
}

function normaliseFigure(raw: string): string {
  return raw.replace(/,/g, '').replace(/\.$/, '').replace(/\.0+$/, '');
}

/**
 * Rupee figures in a message that the project data does not contain. The
 * Writer is told never to invent a price; this is how that is checked rather
 * than hoped for.
 */
export function inventedFigures(text: string, project: ProjectInfo): string[] {
  const approved = approvedFigures(project);
  return [...text.matchAll(/₹\s?([\d][\d,.]*)/g)]
    .map((m) => normaliseFigure(m[1]))
    .filter((figure) => figure && !approved.has(figure));
}

/**
 * What goes out when the Writer cannot be used or cannot be trusted. Plain,
 * true, and in English — a correct message in English beats a wrong one in
 * the right language.
 */
export function fallbackFollowUp(
  purpose: ChasePurpose,
  project: ProjectInfo,
  name: string | null,
  slots: string[] = [],
): string {
  const hi = name?.trim() ? `Hi ${name.trim().split(/\s+/)[0]},` : 'Hello,';
  const popular = [...project.plots].sort((a, b) => b.available - a.available)[0];

  switch (purpose) {
    case 'reintroduce':
      return `${hi} this is ${project.developer} about ${project.name}, ${project.location}.\n\nDC conversion, E-Khata and RERA are all done, and plots start at ${project.entry_price}. Would you like the price list, or a site visit this weekend?`;
    case 'check_in':
      return `${hi} just picking up our conversation about ${project.name}. Is there anything I can help you with — the price list, or a site visit this weekend?`;
    case 'in_writing':
      return `${hi} we tried calling you about ${project.name}. In short: plots start at ${project.entry_price}, DC conversion, E-Khata and RERA are done, and site visits come with ${project.pickup.toLowerCase()}.\n\nShall I send you the price list?`;
    case 'missed_visit':
      return `${hi} we missed you at ${project.name} today — hope everything is all right. We can arrange another visit whenever it suits you.`;
    case 'new_date':
      return `${hi} would ${slots.join(' or ')} suit you for a visit to ${project.name}? ${project.pickup}.`;
    case 'feedback':
      return `${hi} thank you for visiting ${project.name}. What did you think of the plots?`;
    case 'objections':
      return `${hi} if the price, the loan or the paperwork is on your mind: ${project.approved_offers.description} Loans are available from ${project.approvals.bank_approvals.join(', ')}, and every approval is in place.\n\nIs there anything holding you back?`;
    case 'drip':
      return `${hi} a quick update from ${project.name}: ${popular ? `${popular.available} plots of ${popular.size} are still available.` : 'plots are still available.'} You are welcome to visit any day, ${project.site_timings}.`;
  }
}
