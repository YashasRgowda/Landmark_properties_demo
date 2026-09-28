/**
 * "No leads for two hours of office time" — the alert that says a portal feed
 * has broken. Pure.
 *
 * Only office minutes count. Leads that stop at 7 PM and resume the next
 * morning are normal; alerting at 9:31 AM because the last lead was 14 hours
 * ago would be a false alarm every single day, and a daily false alarm is an
 * alarm people learn to ignore.
 */
import { currentWindow, officeBounds } from './time-window';
import { fromIst, istParts } from './visit-time';

export const DROUGHT_AFTER_OFFICE_MINUTES = 120;

/** Minutes of office hours (IST) between two instants. */
export function officeMinutesBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  const { officeOpen, officeClose } = officeBounds();
  let total = 0;

  const start = istParts(from);
  // Walk day by day; a two-hour gap never spans more than a few days, but cap
  // the walk so a years-old timestamp cannot loop for ever.
  for (let d = 0; d < 400; d++) {
    const open = fromIst(start.year, start.month, start.day + d, Math.floor(officeOpen / 60), officeOpen % 60);
    const close = fromIst(start.year, start.month, start.day + d, Math.floor(officeClose / 60), officeClose % 60);
    if (open.getTime() >= to.getTime()) break;
    const a = Math.max(open.getTime(), from.getTime());
    const b = Math.min(close.getTime(), to.getTime());
    if (b > a) total += (b - a) / 60_000;
  }
  return Math.floor(total);
}

export type Drought = { quietOfficeMinutes: number; message: string } | null;

/**
 * The alert, or null. Only raised during office hours — at night there is
 * nobody to act on it, and it would be true every night anyway.
 */
export function leadDrought(lastLeadAt: Date | null, now: Date): Drought {
  if (!lastLeadAt) return null; // a system that has never had a lead has not "stopped"
  if (currentWindow(now) !== 'OFFICE') return null;
  const minutes = officeMinutesBetween(lastLeadAt, now);
  if (minutes < DROUGHT_AFTER_OFFICE_MINUTES) return null;
  const hours = Math.floor(minutes / 60);
  return {
    quietOfficeMinutes: minutes,
    message: `No new enquiries in the last ${hours} office hour${hours === 1 ? '' : 's'}. If portals should be sending leads, check their feeds.`,
  };
}
