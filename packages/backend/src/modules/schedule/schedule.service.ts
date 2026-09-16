import type { PrismaClient } from '@prisma/client';
import { isValidCronExpression, type SchedulePreviewInput } from './schedule.validators.js';

/**
 * Source data returned by sync endpoint — subset of full Source model.
 * Extension only needs these fields for alarm management.
 */
export interface SyncSource {
  id: string;
  name: string;
  sourceType: string;
  baseUrl: string;
  scraperConfig: Record<string, unknown>;
  configVersion: number;
  scraperVersion: string;
  isEnabled: boolean;
  schedule: string;
}

/**
 * ScheduleService — manages schedule configuration and provides sync/preview.
 * Backend is the canonical owner of schedule configuration.
 * SOLID: Single responsibility — schedule operations.
 */
export class ScheduleService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get enabled sources for extension sync.
   * Returns only the fields extension needs for alarm management.
   */
  async getSyncData(userId: string): Promise<SyncSource[]> {
    return this.prisma.source.findMany({
      where: { userId, isEnabled: true },
      select: {
        id: true,
        name: true,
        sourceType: true,
        baseUrl: true,
        scraperConfig: true,
        configVersion: true,
        scraperVersion: true,
        isEnabled: true,
        schedule: true,
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<SyncSource[]>;
  }

  /**
   * Preview next N execution times for a cron expression.
   * Uses simple cron parsing — no external dependency.
   */
  previewSchedule(input: SchedulePreviewInput): { schedule: string; nextExecutions: string[] } {
    const { schedule, count } = input;
    const nextExecutions = this.calculateNextExecutions(schedule, count);

    return { schedule, nextExecutions };
  }

  /**
   * Validate a cron expression.
   */
  validateSchedule(schedule: string): { valid: boolean; error?: string } {
    if (!isValidCronExpression(schedule)) {
      return { valid: false, error: 'Invalid cron expression format. Expected 5 fields: minute hour day-of-month month day-of-week' };
    }
    return { valid: true };
  }

  /**
   * Calculate next N execution times for a cron expression.
   * Simplified parser - handles common patterns:
   * - star-slash-n (every n minutes/hours)
   * - Specific hour:minute
   * - Daily at specific time
   * - Hourly
   */
  private calculateNextExecutions(cron: string, count: number): string[] {
    const results: string[] = [];
    const now = new Date();
    const fields = cron.trim().split(/\s+/);

    if (fields.length !== 5) return results;

    const minuteField = fields[0];
    const hourField = fields[1];

    // Calculate interval in minutes from cron pattern
    const intervalMs = this.cronToIntervalMs(minuteField, hourField);
    if (intervalMs === 0) return results;

    let next = new Date(now.getTime() + intervalMs);

    for (let i = 0; i < count; i++) {
      results.push(next.toISOString());
      next = new Date(next.getTime() + intervalMs);
    }

    return results;
  }

  /**
   * Convert simple cron patterns to interval in milliseconds.
   */
  private cronToIntervalMs(minuteField: string, hourField: string): number {
    // */n in minute field → every n minutes
    if (minuteField.startsWith('*/')) {
      const n = parseInt(minuteField.slice(2), 10);
      if (!isNaN(n) && n > 0) return n * 60 * 1000;
    }

    // hour = */n with minute 0 → every n hours
    if (hourField.startsWith('*/') && minuteField === '0') {
      const n = parseInt(hourField.slice(2), 10);
      if (!isNaN(n) && n > 0) return n * 60 * 60 * 1000;
    }

    // Specific hour daily (e.g., "0 9 * * *") → 24 hours
    if (minuteField === '0' && hourField !== '*' && !hourField.includes('/') && !hourField.includes(',')) {
      return 24 * 60 * 60 * 1000;
    }

    // Multiple hours (e.g., "0 9,18 * * *") → calculate from first to second
    if (minuteField === '0' && hourField.includes(',')) {
      const hours = hourField.split(',').map((h) => parseInt(h, 10)).filter((h) => !isNaN(h));
      if (hours.length >= 2) {
        const sorted = hours.sort((a, b) => a - b);
        const diffHours = sorted[1] - sorted[0];
        return diffHours * 60 * 60 * 1000;
      }
    }

    // Default: every hour
    return 60 * 60 * 1000;
  }
}
