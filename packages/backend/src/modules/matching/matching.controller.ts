import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MatchingEngine } from './matching.engine.js';
import { MatchingService } from './matching.service.js';
import { PrismaSkillLoader, MatchSettingsRepo } from './matching.repository.js';
import { UpdateMatchSettingsSchema, JobIdParamSchema, PreviewMatchSchema } from './matching.validators.js';

/** Prisma returns camelCase; extension expects snake_case. */
function serializeSettings(s: Record<string, unknown>) {
  return {
    min_match_percentage: s.minMatchPercentage,
    notify_on_match: s.notifyOnMatch,
  };
}

export async function matchingRoutes(fastify: FastifyInstance) {
  const engine = new MatchingEngine();
  const skillLoader = new PrismaSkillLoader(fastify.prisma);
  const settingsRepo = new MatchSettingsRepo(fastify.prisma);
  const service = new MatchingService({ prisma: fastify.prisma, skillLoader, matchSettingsRepo: settingsRepo, engine });

  fastify.addHook('preHandler', fastify.authenticateAny);

  // PATCH /api/settings/match
  fastify.patch('/settings/match', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = UpdateMatchSettingsSchema.parse(request.body);
    const updated = await service.updateSettings(request.userId!, {
      minMatchPercentage: body.min_match_percentage,
      notifyOnMatch: body.notify_on_match,
    });
    return reply.send({ data: serializeSettings(updated as unknown as Record<string, unknown>) });
  });

  // GET /api/settings/match
  fastify.get('/settings/match', async (request: FastifyRequest, reply: FastifyReply) => {
    const settings = await service.getSettings(request.userId!);
    return reply.send({ data: serializeSettings(settings as unknown as Record<string, unknown>) });
  });

  // POST /api/jobs/:id/rematch
  fastify.post('/jobs/:id/rematch', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = JobIdParamSchema.parse(request.params);
    const { job, result } = await service.rematchJob(request.userId!, id);
    return reply.send({ data: { job, match: result } });
  });

  // POST /api/matching/preview — live preview for Skills page (ARCHITECTURE.md Dashboard)
  fastify.post('/matching/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = PreviewMatchSchema.parse(request.body);
    const result = await service.calculateForJob(request.userId!, body);
    const settings = await service.getSettings(request.userId!);
    const eligible = result.score >= settings.minMatchPercentage && settings.notifyOnMatch && !result.isDisqualified;
    return reply.send({ data: { result, eligible, threshold: settings.minMatchPercentage } });
  });
}
