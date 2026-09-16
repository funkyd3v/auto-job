import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import type { ScrapeJobData } from '../scraper/scraper.worker.js';
import { timeToCron, to12Hour, patternToTime } from './scheduler.validators.js';

const QUEUE_NAME = 'scrape';
const TIMEZONE = 'Asia/Dhaka'; // GMT+6

/**
 * SchedulerService — manages automatic scrape scheduling using BullMQ repeatable jobs.
 *
 * Converts user-set times (e.g., ["22:15", "08:00"]) into BullMQ repeatable jobs
 * with cron expressions and the Asia/Dhaka timezone.
 */
export class SchedulerService {
  private queue: Queue | null = null;
  private readonly prisma: PrismaClient;
  private readonly redis: any;

  constructor(prisma: PrismaClient, redis: any) {
    this.prisma = prisma;
    this.redis = redis;
  }

  private getQueue(): Queue {
    if (!this.queue) {
      try {
        this.queue = new Queue(QUEUE_NAME, {
          connection: this.redis,
          defaultJobOptions: {
            removeOnComplete: 50,
            removeOnFail: 20,
          },
        });
      } catch (err) {
        console.warn('[SchedulerService] Failed to create Queue:', err);
      }
    }
    return this.queue!;
  }

  /**
   * Get the current schedule configuration for a user.
   */
  async getConfig(userId: string): Promise<{
    enabled: boolean;
    times: string[];
    nextRuns: string[];
  }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { scheduleTimes: true, scheduleEnabled: true },
    });

    const times = (user.scheduleTimes as string[]) ?? [];
    const enabled = user.scheduleEnabled;

    // Calculate next runs based on current time
    const nextRuns = this.calculateNextRuns(times);

    return { enabled, times, nextRuns };
  }

  /**
   * Update the schedule configuration for a user.
   * Removes all existing repeatable jobs and creates new ones.
   */
  async updateConfig(
    userId: string,
    enabled: boolean,
    times: string[]
  ): Promise<{
    enabled: boolean;
    times: string[];
    nextRuns: string[];
    jobsCreated: number;
  }> {
    // Update database
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        scheduleEnabled: enabled,
        scheduleTimes: times,
      },
    });

    // Remove all existing repeatable jobs for this user (only if queue is available)
    try {
      await this.removeJobsForUser(userId);
    } catch (err) {
      console.warn('[SchedulerService] Failed to remove existing jobs (Redis may be unavailable):', err);
    }

    let jobsCreated = 0;

    // Create new repeatable jobs if enabled
    if (enabled && times.length > 0) {
      const sources = await this.prisma.source.findMany({
        where: { userId, isEnabled: true },
        select: { id: true },
      });

      try {
        const queue = this.getQueue();
        for (const time of times) {
          const cronExpr = timeToCron(time);

          for (const source of sources) {
            await queue.add(
              `scheduled-scrape-${source.id}`,
              { source_id: source.id, user_id: userId },
              {
                repeat: {
                  pattern: cronExpr,
                  tz: TIMEZONE,
                },
                jobId: `schedule:${userId}:${source.id}:${time}`,
              }
            );
            jobsCreated++;
          }
        }
      } catch (err) {
        console.warn('[SchedulerService] Failed to create BullMQ jobs (Redis may be unavailable):', err);
      }
    }

    const nextRuns = this.calculateNextRuns(times);

    console.info(
      `[SchedulerService] Updated schedule for user ${userId}: ` +
      `enabled=${enabled}, times=${times.join(',')}, jobs=${jobsCreated}`
    );

    return { enabled, times, nextRuns, jobsCreated };
  }

  /**
   * Trigger an immediate scrape for all enabled sources.
   */
  async triggerNow(userId: string): Promise<{
    jobsQueued: number;
  }> {
    const sources = await this.prisma.source.findMany({
      where: { userId, isEnabled: true },
      select: { id: true },
    });

    let jobsQueued = 0;

    try {
      const queue = this.getQueue();
      for (const source of sources) {
        await queue.add(
          `manual-scrape-${source.id}`,
          { source_id: source.id, user_id: userId },
          {
            jobId: `manual:${userId}:${source.id}:${Date.now()}`,
          }
        );
        jobsQueued++;
      }
    } catch (err) {
      console.warn('[SchedulerService] Failed to queue manual jobs:', err);
    }

    console.info(
      `[SchedulerService] Triggered manual scrape for user ${userId}: ${jobsQueued} jobs queued`
    );

    return { jobsQueued };
  }

  /**
   * Get all repeatable jobs for a user (for debugging/display).
   */
  async getJobs(userId: string): Promise<Array<{
    id: string;
    time: string;
    sourceId: string;
    nextRun: string;
  }>> {
    try {
      const queue = this.getQueue();
      const schedulers = await queue.getJobSchedulers();
      const userJobs = schedulers.filter((j) => j.template?.data?.user_id === userId);

      return userJobs.map((job) => {
        const sourceId = job.name.replace(/^scheduled-scrape-/, '');
        const time = patternToTime(job.pattern ?? '');

        return {
          id: `schedule:${userId}:${sourceId}:${time}`,
          time,
          sourceId,
          nextRun: job.next ? new Date(job.next).toISOString() : 'N/A',
        };
      });
    } catch (err) {
      console.warn('[SchedulerService] Failed to get repeatable jobs:', err);
      return [];
    }
  }

  /**
   * Remove all repeatable jobs for a user.
   */
  private async removeJobsForUser(userId: string): Promise<void> {
    const queue = this.getQueue();
    const schedulers = await queue.getJobSchedulers();
    const userJobs = schedulers.filter((j) => j.template?.data?.user_id === userId);

    for (const job of userJobs) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  /**
   * Calculate the next N run times based on the configured times.
   * Returns times in Asia/Dhaka timezone.
   */
  private calculateNextRuns(times: string[]): string[] {
    if (times.length === 0) return [];

    const now = new Date();
    const OFFSET_MS = 6 * 60 * 60 * 1000; // Asia/Dhaka = UTC+6, no DST

    // Get current Dhaka time components via Intl
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false, hourCycle: 'h23',
    }).formatToParts(now);
    const v = (type: string) => parseInt(parts.find(p => p.type === type)!.value);
    const [dy, dm, dd] = [v('year'), v('month'), v('day')];

    const nextRuns: Array<{ time: string; date: Date }> = [];

    for (const time of times) {
      const [hours, minutes] = time.split(':').map(Number);

      // Build target as actual UTC: Dhaka time − 6h offset
      let targetUTC = Date.UTC(dy, dm - 1, dd, hours, minutes, 0) - OFFSET_MS;

      // If that UTC moment is already past, shift to tomorrow
      if (targetUTC <= now.getTime()) {
        targetUTC += 86_400_000;
      }

      nextRuns.push({ time, date: new Date(targetUTC) });
    }

    return nextRuns
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((r) => `${to12Hour(r.time)} → ${r.date.toLocaleString('en-US', {
        timeZone: TIMEZONE,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })}`);
  }

  /**
   * Close the queue connection.
   */
  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    schedulerService: SchedulerService;
  }
}
