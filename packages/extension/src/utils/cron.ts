/**
 * Minimal cron to minutes conversion for chrome.alarms periodInMinutes.
 * Supports standard 5-field cron with star-slash-n and star for minute/hour.
 * Full cron parsing is backend-owned; extension falls back to polling default if parse fails.
 */

const CRON_FIELD_PARTS = /^(\*|\d{1,2}|\d{1,2}-\d{1,2}|\*\/\d{1,2}|\d{1,2}(,\d{1,2})*)$/;

function isValidCronField(value: string, min: number, max: number): boolean {
  if (!CRON_FIELD_PARTS.test(value)) return false;
  const parts = value.split(/[,-]/);
  for (const part of parts) {
    if (part === '*') continue;
    if (part.startsWith('*/')) {
      const n = parseInt(part.slice(2), 10);
      if (isNaN(n) || n < 1) return false;
      continue;
    }
    const num = parseInt(part, 10);
    if (isNaN(num) || num < min || num > max) return false;
  }
  return true;
}

/** Validate a 5-field cron expression. */
export function isValidCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return (
    isValidCronField(minute, 0, 59) &&
    isValidCronField(hour, 0, 23) &&
    isValidCronField(dayOfMonth, 1, 31) &&
    isValidCronField(month, 1, 12) &&
    isValidCronField(dayOfWeek, 0, 7)
  );
}

export function cronToPeriodMinutes(cron: string, fallback = 360): number {
  // e.g. "0 */6 * * *" => every 6h = 360m
  // e.g. "0 9 * * *" => daily 1440m (we approximate)
  // e.g. "*/30 * * * *" => 30m
  // e.g. "0 9,18 * * *" => 9h = 540m (difference between hours)
  try {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return fallback;

    const [minute, hour] = parts;

    // */n in minute field
    if (minute.startsWith('*/')) {
      const n = parseInt(minute.slice(2), 10);
      if (!isNaN(n) && n > 0) return n;
    }

    // hour = */n with minute 0
    if (hour.startsWith('*/') && minute === '0') {
      const n = parseInt(hour.slice(2), 10);
      if (!isNaN(n) && n > 0) return n * 60;
    }

    // Multiple hours (e.g., "0 9,18 * * *") → difference between first two
    if (minute === '0' && hour.includes(',')) {
      const hours = hour.split(',').map((h) => parseInt(h, 10)).filter((h) => !isNaN(h));
      if (hours.length >= 2) {
        const sorted = hours.sort((a, b) => a - b);
        const diffHours = sorted[1] - sorted[0];
        if (diffHours > 0) return diffHours * 60;
      }
    }

    // Specific hour daily
    if (minute === '0' && hour !== '*' && !hour.includes('/')) return 1440;

    return fallback;
  } catch {
    return fallback;
  }
}

export function getAlarmName(sourceId: string): string {
  return `scrape-${sourceId}`;
}

/** Extract sourceId from alarm name. Returns null if not a scrape alarm. */
export function getSourceIdFromAlarm(alarmName: string): string | null {
  if (!alarmName.startsWith('scrape-')) return null;
  return alarmName.replace('scrape-', '');
}
