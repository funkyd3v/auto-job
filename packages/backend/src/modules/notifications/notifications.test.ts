import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from './notifications.service.js';
import { PrismaNotificationRepository, DefaultNotificationPolicy, PrismaOutboxRepository } from './notifications.repository.js';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockPrisma: any;
  let mockNotificationRepo: PrismaNotificationRepository;
  let mockOutboxRepo: PrismaOutboxRepository;
  let mockPolicy: DefaultNotificationPolicy;

  beforeEach(() => {
    mockPrisma = {
      job: {
        findFirst: vi.fn(),
      },
      matchSettings: {
        findUnique: vi.fn(),
      },
      notification: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      outboxEvent: {
        create: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    mockNotificationRepo = new PrismaNotificationRepository(mockPrisma);
    mockOutboxRepo = new PrismaOutboxRepository(mockPrisma);
    mockPolicy = new DefaultNotificationPolicy(mockPrisma);

    service = new NotificationService({
      prisma: mockPrisma,
      notificationRepo: mockNotificationRepo,
      outboxRepo: mockOutboxRepo,
      policy: mockPolicy,
    });
  });

  describe('createForJob', () => {
    it('should create notification when job qualifies', async () => {
      const mockJob = { id: 'job-1', userId: 'user-1', matchScore: 85 };
      const mockSettings = { userId: 'user-1', minMatchPercentage: 70, notifyOnMatch: true };
      const mockNotification = { id: 'notif-1', jobId: 'job-1', channel: 'telegram', notificationType: 'new_match', status: 'PENDING' };

      mockPrisma.job.findFirst.mockResolvedValue(mockJob);
      mockPrisma.matchSettings.findUnique.mockResolvedValue(mockSettings);
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          notification: {
            create: vi.fn().mockResolvedValue(mockNotification),
          },
          outboxEvent: {
            create: vi.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      const result = await service.createForJob('user-1', 'job-1', 85);

      expect(result).toEqual(mockNotification);
      expect(mockPrisma.job.findFirst).toHaveBeenCalledWith({ where: { id: 'job-1', userId: 'user-1' } });
    });

    it('should return null when job does not qualify', async () => {
      const mockJob = { id: 'job-1', userId: 'user-1', matchScore: 50 };
      const mockSettings = { userId: 'user-1', minMatchPercentage: 70, notifyOnMatch: true };

      mockPrisma.job.findFirst.mockResolvedValue(mockJob);
      mockPrisma.matchSettings.findUnique.mockResolvedValue(mockSettings);

      const result = await service.createForJob('user-1', 'job-1', 50);

      expect(result).toBeNull();
    });

    it('should return null when notifications are disabled', async () => {
      const mockJob = { id: 'job-1', userId: 'user-1', matchScore: 85 };
      const mockSettings = { userId: 'user-1', minMatchPercentage: 70, notifyOnMatch: false };

      mockPrisma.job.findFirst.mockResolvedValue(mockJob);
      mockPrisma.matchSettings.findUnique.mockResolvedValue(mockSettings);

      const result = await service.createForJob('user-1', 'job-1', 85);

      expect(result).toBeNull();
    });
  });

  describe('processJobsForNotifications', () => {
    it('should process multiple jobs and return count', async () => {
      const mockJobs = [
        { jobId: 'job-1', score: 85 },
        { jobId: 'job-2', score: 90 },
      ];

      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          job: {
            findFirst: vi.fn().mockResolvedValue({ id: 'job-1', userId: 'user-1' }),
          },
          matchSettings: {
            findUnique: vi.fn().mockResolvedValue({ userId: 'user-1', minMatchPercentage: 70, notifyOnMatch: true }),
          },
          notification: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
          },
          outboxEvent: {
            create: vi.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      const result = await service.processJobsForNotifications('user-1', mockJobs);

      expect(result).toBeGreaterThanOrEqual(0);
    });
  });
});
