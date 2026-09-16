import type { PrismaClient, Job, MatchSettings, Notification } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../../shared/errors/index.js';
import type { JobIngestionDependencies } from '../jobs/jobs.service.js';
import type { NormalizedJob } from '../jobs/jobs.types.js';
import type { INotificationRepository, NotificationPolicy } from './notifications.repository.js';
import type { IOutboxRepository } from './notifications.repository.js';

// ─── Notification Service Dependencies (DIP) ─────────────────────────────────────────

export interface NotificationDependencies {
  prisma: PrismaClient;
  notificationRepo: INotificationRepository;
  outboxRepo: IOutboxRepository;
  policy: NotificationPolicy;
}

// ─── Notification Service (SRP, Orchestrator) ───────────────────────────────────────

export class NotificationService {
  constructor(private readonly deps: NotificationDependencies) {}

  /**
   * Create notification for a job if it qualifies.
   * Atomic: Job update + Notification record + Outbox event (ARCHITECTURE.md transactional pattern).
   * Uses DB-level UNIQUE(job_id, channel, notification_type) for deduplication.
   */
  async createForJob(
    userId: string,
    jobId: string,
    score: number,
    channel: string = 'telegram',
    notificationType: string = 'new_match'
  ): Promise<Notification | null> {
    // Load job with user isolation
    const job = await this.deps.prisma.job.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) throw new NotFoundError('Job');

    // Load matching settings
    const settings = await this.deps.prisma.matchSettings.findUnique({ where: { userId } });
    if (!settings) throw new NotFoundError('MatchSettings');

    // Policy check
    const eligible = await this.deps.policy.canCreateNotification(userId, score, settings);
    if (!eligible) return null;

    // Duplicate check via policy
    const alreadyNotified = await this.deps.policy.canCreateNotificationForJob(job, score);
    if (!alreadyNotified) return null;

    // Atomic transaction: create notification + outbox event
    const result = await this.deps.prisma.$transaction(async (tx) => {
      // Create notification record
      const notification = await tx.notification.create({
        data: {
          jobId,
          channel,
          notificationType,
          status: 'PENDING',
        },
      });

      // Create outbox event (transactional guarantee)
      await tx.outboxEvent.create({
        data: {
          eventType: 'notification_created',
          payload: {
            notificationId: notification.id,
            jobId,
            channel,
            notificationType,
          },
        },
      });

      return notification;
    });

    await this.pruneRetention(userId);

    return result;
  }

  /**
   * Create notifications for multiple jobs in a single transaction.
   * Used during batch ingestion to batch insert notifications + outbox events.
   */
  async createBatch(
    userId: string,
    jobs: { jobId: string; score: number }[],
    channel: string = 'telegram',
    notificationType: string = 'new_match'
  ): Promise<Notification[]> {
    const created: Notification[] = [];

    await this.deps.prisma.$transaction(async (tx) => {
      for (const { jobId, score } of jobs) {
        // Verify job ownership
        const job = await tx.job.findFirst({ where: { id: jobId, userId } });
        if (!job) {
          // Skip invalid jobs but don't abort entire batch
          continue;
        }

        // Load settings once per batch (for optimization)
        if (created.length === 0) {
          const settings = await tx.matchSettings.findUnique({ where: { userId } });
          if (!settings) {
            throw new NotFoundError('MatchSettings');
          }

          // Policy check for batch (only first job)
          const eligible = await this.deps.policy.canCreateNotification(userId, score, settings);
          if (!eligible) {
            return created;
          }
        }

        // Duplicate check
        const exists = await tx.notification.findFirst({
          where: {
            jobId,
            channel,
            notificationType,
          },
        });
        if (exists) continue; // Already notified

        // Create notification and outbox event
        const notification = await tx.notification.create({
          data: {
            jobId,
            channel,
            notificationType,
            status: 'PENDING',
          },
        });

        await tx.outboxEvent.create({
          data: {
            eventType: 'notification_created',
            payload: {
              notificationId: notification.id,
              jobId,
              channel,
              notificationType,
            },
          },
        });

        created.push(notification);
      }
    });

    await this.pruneRetention(userId);

    return created;
  }

  /**
   * Batch process jobs for notification creation.
   * Ingestion pipeline calls this after deduplication to find new matches.
   */
  async processJobsForNotifications(
    userId: string,
    jobs: { jobId: string; score: number }[],
    channel: string = 'telegram',
    notificationType: string = 'new_match'
  ): Promise<number> {
    const notifications = await this.createBatch(userId, jobs, channel, notificationType);
    return notifications.length;
  }

  /**
   * Retention: keep only the 10 most recent notifications per user.
   * Runs after every notification insert so the table never exceeds 10 rows.
   */
  private async pruneRetention(userId: string): Promise<void> {
    const keep = await this.deps.prisma.notification.findMany({
      where: { job: { userId } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true },
    });
    await this.deps.prisma.notification.deleteMany({
      where: { job: { userId }, id: { notIn: keep.map((n) => n.id) } },
    });
  }
}
