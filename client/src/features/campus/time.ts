/**
 * Wall-clock times in the INSTITUTE's zone (never the browser's), for the
 * schedule and exam windows. A class "at 10:00" means 10:00 at the institute,
 * wherever the person setting it happens to be.
 */

import { dateInZone, zonedDayStart } from '@ims/shared';
import { getFormatConfig } from '@/utils/format';

const zone = () => getFormatConfig().timeZone;

/** "2026-10-14" + "10:30" (institute time) -> ISO instant. */
export function toInstant(day: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(zonedDayStart(day, zone()).getTime() + (h * 60 + m) * 60_000).toISOString();
}

/** ISO instant -> { date, time } as the institute's wall clock. */
export function splitInstant(iso: string): { date: string; time: string } {
  const at = new Date(iso);
  const day = dateInZone(at, zone());
  const minutes = Math.round((at.getTime() - zonedDayStart(day, zone()).getTime()) / 60_000);
  return { date: day, time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` };
}

/** "10:30" for an instant, in the institute zone. */
export function timeOf(iso: string): string {
  return new Intl.DateTimeFormat(getFormatConfig().locale, { timeZone: zone(), hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** "Mon 14 Oct" for a date-only string. */
export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat(getFormatConfig().locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
