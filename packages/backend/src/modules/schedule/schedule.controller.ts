import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ScheduleService } from './schedule.service.js';
import { DistributedLock } from '../../shared/middleware/distributed-lock.js';
import { SchedulePreviewSchema, ScrapeLockSchema } from './schedule.validators.js';
import { ConflictError } from '../../shared/errors/index.js';

/**
 * Schedule routes — sync, preview, and scrape lock.
 * Authentication: API key (extension) or JWT (dashboard).
 *
 * Endpoints:
 *   GET  /api/schedule/sync       — enabled sources for extension alarm sync
 *   POST /api/schedule/preview    — preview next execution times
 *   POST /api/schedule/validate   — validate cron expression
 *   POST /api/scrape-lock/acquire — acquire distributed lock
 *   POST /api/scrape-lock/release — release distributed lock
 */
export async function scheduleRoutes(fastify: FastifyInstance) {
  const scheduleService = new ScheduleService(fastify.prisma);
  const distributedLock = new DistributedLock(fastify.redis);

  // All schedule routes require authentication
  fastify.addHook('preHandler', fastify.authenticateAny);

  // ─── Schedule Sync ────────────────────────────────────────────────────────
  // GET /api/schedule/sync — extension syncs enabled sources + schedules
  fastify.get('/schedule/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    const sources = await scheduleService.getSyncData(request.userId!);
    return reply.send({ data: sources });
  });

  // ─── Schedule Preview ─────────────────────────────────────────────────────
  // POST /api/schedule/preview — preview next N execution times
  fastify.post('/schedule/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const input = SchedulePreviewSchema.parse(request.body);
    const preview = scheduleService.previewSchedule(input);
    return reply.send({ data: preview });
  });

  // ─── Schedule Validation ──────────────────────────────────────────────────
  // POST /api/schedule/validate — validate cron expression
  fastify.post('/schedule/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { schedule } = request.body as { schedule: string };
    const result = scheduleService.validateSchedule(schedule);
    return reply.send({ data: result });
  });

  // ─── Scrape Lock ──────────────────────────────────────────────────────────
  // POST /api/scrape-lock/acquire — acquire lock before scraping
  fastify.post('/scrape-lock/acquire', async (request: FastifyRequest, reply: FastifyReply) => {
    const { source_id } = ScrapeLockSchema.parse(request.body);

    // Verify source belongs to user
    const source = await fastify.prisma.source.findFirst({
      where: { id: source_id, userId: request.userId! },
    });
    if (!source) {
      throw new ConflictError('Source not found or access denied');
    }

    const lock = await distributedLock.acquire(source_id);

    if (!lock.acquired) {
      return reply.status(409).send({
        data: { acquired: false, message: 'Source is being scraped by another run' },
      });
    }

    return reply.send({ data: { acquired: true, lockId: lock.lockId } });
  });

  // POST /api/scrape-lock/release — release lock after scraping
  fastify.post('/scrape-lock/release', async (request: FastifyRequest, reply: FastifyReply) => {
    const { source_id, lock_id } = request.body as { source_id: string; lock_id: string };

    const released = await distributedLock.release(source_id, lock_id);

    return reply.send({ data: { released } });
  });

  // GET /api/scrape-lock/status/:sourceId — check lock status
  fastify.get('/scrape-lock/status/:sourceId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sourceId } = request.params as { sourceId: string };

    const locked = await distributedLock.isLocked(sourceId);
    const ttl = locked ? await distributedLock.getTtl(sourceId) : -1;

    return reply.send({ data: { locked, ttl } });
  });
}
