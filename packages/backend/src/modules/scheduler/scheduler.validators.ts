import { z } from 'zod';

/**
 * Validate a time string in HH:MM format (24-hour).
 * Examples: "08:00", "22:15", "14:30"
 */
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const ScheduleConfigSchema = z.object({
  schedule_enabled: z.boolean(),
  schedule_times: z
    .array(z.string().regex(timeRegex, 'Time must be in HH:MM format (24-hour)'))
    .max(10, 'Maximum 10 scheduled times allowed')
    .default([]),
});

export type ScheduleConfigInput = z.infer<typeof ScheduleConfigSchema>;

/**
 * Convert 12-hour time format (from UI) to 24-hour format for storage.
 * Input: "10:15 PM" → Output: "22:15"
 */
export function to24Hour(time12h: string): string {
  const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    // Assume already 24-hour format
    if (timeRegex.test(time12h)) return time12h;
    throw new Error(`Invalid time format: ${time12h}`);
  }

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = match[3].toUpperCase();

  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours !== 12) hours += 12;

  return `${hours.toString().padStart(2, '0')}:${minutes}`;
}

/**
 * Convert 24-hour time format to 12-hour format for display.
 * Input: "22:15" → Output: "10:15 PM"
 */
export function to12Hour(time24h: string): string {
  const match = time24h.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`Invalid time format: ${time24h}`);

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = hours >= 12 ? 'PM' : 'AM';

  if (hours === 0) hours = 12;
  else if (hours > 12) hours -= 12;

  return `${hours}:${minutes} ${period}`;
}

/**
 * Convert a 24-hour time string to a cron expression.
 * Input: "22:15" → Output: "15 22 * * *"
 */
export function timeToCron(time24h: string): string {
  const match = time24h.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`Invalid time format: ${time24h}`);

  const [_, hours, minutes] = match;
  return `${parseInt(minutes)} ${parseInt(hours)} * * *`;
}

/**
 * Convert a cron expression to a 24-hour time string.
 * Input: "15 22 * * *" → Output: "22:15"
 */
export function patternToTime(pattern: string): string {
  const match = pattern.trim().match(/^(\d{1,2})\s+(\d{1,2})(?:\s|$)/);
  if (!match) throw new Error(`Invalid cron pattern: ${pattern}`);

  const minutes = parseInt(match[1], 10);
  const hours = parseInt(match[2], 10);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}
