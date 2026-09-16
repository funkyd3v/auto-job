import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { getConfig } from './config/env.js';
import { handleError } from './shared/errors/handler.js';
import prismaPlugin from './shared/middleware/prisma.js';
import securityPlugin from './shared/middleware/security.js';
import authPlugin from './shared/middleware/auth.js';
import redisPlugin from './shared/middleware/redis.js';
import { authRoutes, apiKeyRoutes } from './modules/auth/auth.controller.js';
import { jobsRoutes } from './modules/jobs/jobs.controller.js';
import { jobsNotificationRoutes } from './modules/jobs/jobs.notification.controller.js';
import { sourcesRoutes } from './modules/sources/sources.controller.js';
import { scrapeRunsRoutes } from './modules/scrape-runs/scrape-runs.controller.js';
import { skillsRoutes } from './modules/skills/skills.controller.js';
import { matchingRoutes } from './modules/matching/matching.controller.js';
import { notificationsRoutes } from './modules/notifications/notifications.controller.js';
import { telegramRoutes } from './modules/telegram/telegram.controller.js';
import { scheduleRoutes } from './modules/schedule/schedule.controller.js';
import { schedulerRoutes } from './modules/scheduler/scheduler.controller.js';
import { createScraperWorker } from './modules/scraper/scraper.worker.js';
import { OutboxWorker } from './modules/notifications/notifications.outbox.worker.js';
import { PrismaNotificationRepository, PrismaOutboxRepository } from './modules/notifications/notifications.repository.js';
import { SchedulerService } from './modules/scheduler/scheduler.service.js';

export async function buildApp() {
  const config = getConfig();

  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        config.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024, // 10MB
  });

  // ─── Plugins ──────────────────────────────────────────────────────────────
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(securityPlugin);
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
  });
  await app.register(authPlugin);

  // ─── Global error handler ─────────────────────────────────────────────────
  app.setErrorHandler(handleError);

  // ─── Scheduler Service (singleton)
  app.decorate("schedulerService", new SchedulerService(app.prisma, app.redis));

  // ─── Health check ─────────────────────────────────────────────────────────
  app.get('/health', async () => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'error', timestamp: new Date().toISOString() };
    }
  });

  // ─── API Routes ──────────────────────────────────────────────────────────
  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(apiKeyRoutes);
      await api.register(jobsRoutes);
      await api.register(jobsNotificationRoutes);
      await api.register(sourcesRoutes);
      await api.register(scrapeRunsRoutes);
      await api.register(skillsRoutes);
      await api.register(matchingRoutes);
      await api.register(notificationsRoutes);
      await api.register(telegramRoutes);
      await api.register(scheduleRoutes);
      await api.register(schedulerRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}

async function main() {
  const app = await buildApp();
  const config = getConfig();

  // Parse Redis URL for BullMQ
  const redisUrl = new URL(config.REDIS_URL);
  const redisConnection = {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port || '6379', 10),
    password: redisUrl.password || undefined,
  };

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Server running on port ${config.PORT}`);

    // Start outbox worker for Telegram notifications
    const notificationRepo = new PrismaNotificationRepository(app.prisma);
    const outboxRepo = new PrismaOutboxRepository(app.prisma);
    const outboxWorker = new OutboxWorker({ prisma: app.prisma, notificationRepo, outboxRepo });
    outboxWorker.start(5000);
    app.log.info('Outbox worker started (5s interval)');

    // Start scraper worker
    const scraperWorker = createScraperWorker({
      prisma: app.prisma,
      redisConnection,
    });
    app.log.info('Scraper worker started');

    // Graceful shutdown
    const shutdown = async () => {
      app.log.info('Shutting down...');
      await scraperWorker.close();
      await app.schedulerService.close();
      await app.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
