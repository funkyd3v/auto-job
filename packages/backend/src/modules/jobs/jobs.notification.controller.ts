import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { IngestJobsSchema } from './jobs.validators.js';
import { JobRepository } from './jobs.repository.js';
import { JobNormalizer, JobDeduplicationService } from './jobs.service.js';
import { JobIngestionWithNotificationService } from './jobs.notification.service.js';
import { MatchingEngine } from '../matching/matching.engine.js';
import { PrismaNotificationRepository, DefaultNotificationPolicy, PrismaOutboxRepository } from '../notifications/notifications.repository.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { ForbiddenError } from '../../shared/errors/index.js';

const REQUIRED_SCOPES_JOBS_WRITE = ['jobs:write'];

function assertScopes(request: FastifyRequest, required: string[]) {
  const scopes = request.apiKeyScopes;
  if (scopes) {
    const hasScope = required.some((s) => scopes.includes(s));
    if (!hasScope) {
      throw new ForbiddenError(`Missing required scope: ${required.join(', ')}`);
    }
  }
}

export async function jobsNotificationRoutes(fastify: FastifyInstance) {
  const jobRepo = new JobRepository(fastify.prisma);
  const normalizer = new JobNormalizer();
  const deduplicator = new JobDeduplicationService(jobRepo);
  const matchingEngine = new MatchingEngine();

  const notificationRepo = new PrismaNotificationRepository(fastify.prisma);
  const outboxRepo = new PrismaOutboxRepository(fastify.prisma);
  const policy = new DefaultNotificationPolicy(fastify.prisma);
  const notificationService = new NotificationService({ prisma: fastify.prisma, notificationRepo, outboxRepo, policy });

  const ingestionService = new JobIngestionWithNotificationService({
    prisma: fastify.prisma,
    jobRepository: jobRepo,
    normalizer,
    deduplicator,
    notificationService,
    matchingEngine,
  });

  fastify.addHook('preHandler', fastify.authenticateAny);

  fastify.post(
    '/jobs/ingest-with-notification',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      assertScopes(request, REQUIRED_SCOPES_JOBS_WRITE);

      const userId = request.userId!;
      const body = IngestJobsSchema.parse(request.body);

      const result = await ingestionService.ingestWithNotification(userId, body);

      return reply.status(201).send({
        success: true,
        data: result,
        meta: {
          source_id: body.source_id,
        },
      });
    },
  );
}
