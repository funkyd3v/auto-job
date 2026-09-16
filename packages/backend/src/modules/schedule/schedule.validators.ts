import { z } from 'zod';

/**
 * Cron expression validator — 5-field format.
 * Fields: minute hour day-of-month month day-of-week
 */

const CRON_FIELD_REGEX = /^(\*|\d{1,2}|\d{1,2}-\d{1,2}|\*\/\d{1,2}|\d{1,2}(,\d{1,2})*)$/;

function isValidCronField(value: string, min: number, max: number): boolean {
  if (!CRON_FIELD_REGEX.test(value)) return false;
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

export function isValidCronExpression(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const minute = fields[0];
  const hour = fields[1];
  const dayOfMonth = fields[2];
  const month = fields[3];
  const dayOfWeek = fields[4];

  return (
    isValidCronField(minute, 0, 59) &&
    isValidCronField(hour, 0, 23) &&
    isValidCronField(dayOfMonth, 1, 31) &&
    isValidCronField(month, 1, 12) &&
    isValidCronField(dayOfWeek, 0, 7)
  );
}

export const SchedulePreviewSchema = z.object({
  schedule: z.string().min(1).max(50).refine(isValidCronExpression, {
    message: 'Invalid cron expression. Format: "minute hour day-of-month month day-of-week"',
  }),
  count: z.number().int().min(1).max(50).default(5),
});

export const ScrapeLockSchema = z.object({
  source_id: z.string().uuid(),
});

export type SchedulePreviewInput = z.infer<typeof SchedulePreviewSchema>;
export type ScrapeLockInput = z.infer<typeof ScrapeLockSchema>;
