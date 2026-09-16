import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ScheduleConfigSchema } from './scheduler.validators.js';

/**
 * Scheduler routes — automatic scrape scheduling.
 * Authentication: JWT (dashboard only).
 *
 * Endpoints:
 *   GET  /api/scheduler/config   — get current schedule config
 *   PUT  /api/scheduler/config   — update schedule config
 *   POST /api/scheduler/trigger  — trigger immediate scrape
 *   GET  /api/scheduler/jobs     — list scheduled jobs
 */
export async function schedulerRoutes(fastify: FastifyInstance) {
  // All scheduler routes require JWT authentication (dashboard only)
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── Get Schedule Config ──────────────────────────────────────────────────
  // GET /api/scheduler/config
  fastify.get('/scheduler/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const schedulerService = fastify.schedulerService;
    const config = await schedulerService.getConfig(userId);
    return reply.send({ data: config });
  });

  // ─── Update Schedule Config ──────────────────────────────────────────────
  // PUT /api/scheduler/config
  fastify.put('/scheduler/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const input = ScheduleConfigSchema.parse(request.body);

    const schedulerService = fastify.schedulerService;
    const result = await schedulerService.updateConfig(
      userId,
      input.schedule_enabled,
      input.schedule_times,
    );

    return reply.send({ data: result });
  });

  // ─── Trigger Manual Scrape ──────────────────────────────────────────────
  // POST /api/scheduler/trigger
  fastify.post('/scheduler/trigger', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const schedulerService = fastify.schedulerService;
    const result = await schedulerService.triggerNow(userId);
    return reply.send({ data: result });
  });

  // ─── List Scheduled Jobs ────────────────────────────────────────────────
  // GET /api/scheduler/jobs
  fastify.get('/scheduler/jobs', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const schedulerService = fastify.schedulerService;
    const jobs = await schedulerService.getJobs(userId);
    return reply.send({ data: jobs });
  });
}
