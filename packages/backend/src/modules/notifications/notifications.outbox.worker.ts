import type { PrismaClient } from '@prisma/client';
import type { INotificationRepository, IOutboxRepository } from './notifications.repository.js';
import { TelegramAdapter } from '../telegram/telegram.adapter.js';
import { decryptSecret } from '../telegram/telegram.crypto.js';

// ─── Outbox Worker Dependencies (DIP) ────────────────────────────────────────────────

export interface OutboxWorkerDependencies {
  prisma: PrismaClient;
  notificationRepo: INotificationRepository;
  outboxRepo: IOutboxRepository;
}

// ─── Outbox Worker (SRP) ─────────────────────────────────────────────────────────────

export class OutboxWorker {
  private interval: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(private readonly deps: OutboxWorkerDependencies) {}

  start(intervalMs = 5000): void {
    if (this.interval) return;
    
    this.interval = setInterval(async () => {
      if (this.isProcessing) return;
      
      this.isProcessing = true;
      try {
        await this.processPendingEvents();
      } catch (error) {
        console.error('Outbox worker error:', error);
      } finally {
        this.isProcessing = false;
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async processPendingEvents(): Promise<void> {
    const pendingEvents = await this.deps.outboxRepo.findPending(100);
    
    for (const event of pendingEvents) {
      try {
        if (event.eventType === 'notification_created') {
          await this.processNotificationCreated(event.payload as {
            notificationId: string;
            jobId: string;
            channel: string;
            notificationType: string;
          });
        }
        
        await this.deps.outboxRepo.markProcessed(event.id);
      } catch (error) {
        console.error(`Failed to process event ${event.id}:`, error);
        
        await this.deps.outboxRepo.markFailed(event.id);
      }
    }
  }

  private async processNotificationCreated(payload: {
    notificationId: string;
    jobId: string;
    channel: string;
    notificationType: string;
  }): Promise<void> {
    const { notificationId, jobId, channel, notificationType } = payload;
    
    const notification = await this.deps.notificationRepo.findById(notificationId);
    if (!notification) {
      console.warn(`Notification ${notificationId} not found`);
      return;
    }

    const job = await this.deps.prisma.job.findUnique({
      where: { id: jobId },
      include: { user: true },
    });
    
    if (!job) {
      console.warn(`Job ${jobId} not found`);
      await this.deps.notificationRepo.updateStatus(notificationId, 'FAILED', {
        lastError: 'Job not found',
      });
      return;
    }

    if (channel === 'telegram') {
      await this.sendTelegramNotification(notificationId, job);
    }
  }

  private async sendTelegramNotification(notificationId: string, job: any): Promise<void> {
    try {
      const settings = await this.deps.prisma.matchSettings.findUnique({
        where: { userId: job.userId },
      });
      
      if (!settings?.notifyOnMatch) {
        await this.deps.notificationRepo.updateStatus(notificationId, 'FAILED', {
          lastError: 'Notifications disabled',
        });
        return;
      }

      // Per-user credentials from the dashboard take precedence; fall back to env vars
      // so docker/legacy setups keep working without a GUI connection.
      let botToken: string | undefined;
      if (settings?.telegramBotTokenEncrypted) {
        try {
          botToken = decryptSecret(settings.telegramBotTokenEncrypted);
        } catch (error) {
          await this.deps.notificationRepo.updateStatus(notificationId, 'FAILED', {
            lastError: `Failed to decrypt stored bot token: ${String(error)}`,
          });
          return;
        }
      }
      const chatId = settings?.telegramChatId || process.env.TELEGRAM_CHAT_ID || '';

      botToken = botToken || process.env.TELEGRAM_BOT_TOKEN || '';

      if (!botToken || !chatId) {
        await this.deps.notificationRepo.updateStatus(notificationId, 'FAILED', {
          lastError: 'Telegram not configured — connect a bot from Settings',
        });
        return;
      }

      const adapter = new TelegramAdapter({
        botToken,
        chatId,
        notificationRepo: this.deps.notificationRepo,
        outboxRepo: this.deps.outboxRepo,
      });

      const result = await adapter.sendJobNotification(job, job.matchScore || 0);
      
      const notification = await this.deps.notificationRepo.findById(notificationId);
      await this.deps.notificationRepo.updateStatus(notificationId, 'SENT', {
        sentAt: new Date(),
        providerMessageId: result.messageId,
        attempts: (notification?.attempts || 0) + 1,
      });
    } catch (error) {
      const notification = await this.deps.notificationRepo.findById(notificationId);
      await this.deps.notificationRepo.updateStatus(notificationId, 'FAILED', {
        lastError: String(error),
        attempts: (notification?.attempts || 0) + 1,
      });
      
      throw error;
    }
  }
}
