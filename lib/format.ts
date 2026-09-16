import { formatInTimeZone } from 'date-fns-tz';
import { TIMEZONE } from './time-window';

/** Screens always show IST. The database always stores UTC. */
export function formatIST(at: Date | string | null | undefined, pattern = 'd MMM, h:mm a'): string {
  if (!at) return '—';
  return formatInTimeZone(new Date(at), TIMEZONE, pattern);
}
