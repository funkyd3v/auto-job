import type { PrismaClient, Job, MatchSettings, Notification } from '@prisma/client';

// ─── Notification Repository (DIP) ────────────────────────────────────────────────────

export interface INotificationRepository {
  findById(id: string): Promise<Notification | null>;
  findByJobAndChannelAndType(jobId: string, channel: string, type: string): Promise<Notification | null>;
  create(data: {
    jobId: string;
    channel: string;
    notificationType: string;
    status?: 'PENDING' | 'SENT' | 'FAILED';
  }): Promise<Notification>;
  updateStatus(id: string, status: 'SENT' | 'FAILED', updates?: {
    sentAt?: Date;
    providerMessageId?: string;
    lastError?: string;
    attempts?: number;
  }): Promise<Notification>;
}

export class PrismaNotificationRepository implements INotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({
      where: { id },
    });
  }

  async findByJobAndChannelAndType(jobId: string, channel: string, type: string): Promise<Notification | null> {
    return this.prisma.notification.findFirst({
      where: {
        jobId,
        channel,
        notificationType: type,
      },
    });
  }

  async create(data: { jobId: string; channel: string; notificationType: string; status?: 'PENDING' | 'SENT' | 'FAILED' }): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        jobId: data.jobId,
        channel: data.channel,
        notificationType: data.notificationType,
        status: data.status ?? 'PENDING',
      },
    });
  }

  async updateStatus(
    id: string,
    status: 'SENT' | 'FAILED',
    updates?: { sentAt?: Date; providerMessageId?: string; lastError?: string; attempts?: number }
  ): Promise<Notification> {
    return this.prisma.notification.update({
      where: { id },
      data: {
        status,
        ...updates,
      },
    });
  }
}

// ─── Notification Policy Service (SRP) ───────────────────────────────────────────────────

export interface NotificationPolicy {
  canCreateNotification(userId: string, score: number, settings: MatchSettings): Promise<boolean>;
  canCreateNotificationForJob(job: Job, score: number): Promise<boolean>;
}

export class DefaultNotificationPolicy implements NotificationPolicy {
  constructor(private readonly prisma: PrismaClient) {}

  async canCreateNotification(userId: string, score: number, settings: MatchSettings): Promise<boolean> {
    if (!settings.notifyOnMatch) return false;
    return score >= settings.minMatchPercentage;
  }

  async canCreateNotificationForJob(job: Job, score: number): Promise<boolean> {
    const exists = await this.prisma.notification.findFirst({
      where: {
        jobId: job.id,
        channel: 'telegram',
        notificationType: 'new_match',
      },
    });
    return !exists;
  }
}

// ─── Outbox Event Repository (DIP) ────────────────────────────────────────────────────

export interface IOutboxRepository {
  createEvent(eventType: string, payload: unknown, status?: 'PENDING' | 'PROCESSED' | 'FAILED'): Promise<{ id: string }>;
  findPending(limit?: number): Promise<{ id: string; eventType: string; payload: unknown }[]>;
  markProcessed(id: string): Promise<void>;
  markFailed(id: string): Promise<void>;
}

export class PrismaOutboxRepository implements IOutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createEvent(eventType: string, payload: unknown, status: 'PENDING' | 'PROCESSED' | 'FAILED' = 'PENDING'): Promise<{ id: string }> {
    const event = await this.prisma.outboxEvent.create({
      data: {
        eventType,
        payload: payload as any,
        status,
      },
    });
    return { id: event.id };
  }

  async findPending(limit = 100): Promise<{ id: string; eventType: string; payload: unknown }[]> {
    const events = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      take: limit,
    });
    return events.map((e) => ({ id: e.id, eventType: e.eventType, payload: e.payload }));
  }

  async markProcessed(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
  }

  async markFailed(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'FAILED', processedAt: new Date() },
    });
  }
}
