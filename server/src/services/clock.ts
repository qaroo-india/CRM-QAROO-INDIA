import { todayInZone } from '@ims/shared';
import { getSettings } from './settings';

/** Today's calendar day at the institute, in its configured time zone. */
export function instituteToday(now: Date = new Date()): string {
  return todayInZone(getSettings().timezone, now);
}
