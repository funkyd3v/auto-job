import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { IngestJobsSchema, ListJobsQuerySchema, JobIdParamSchema, UpdateJobStatusSchema } from './jobs.validators.js';
import { JobRepository, IdempotencyRepository } from './jobs.repository.js';
import { JobIngestionService, JobNormalizer, JobDeduplicationService } from './jobs.service.js';
import { MatchingEngine } from '../matching/matching.engine.js';
import { ForbiddenError, BadRequestError } from '../../shared/errors/index.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { PrismaNotificationRepository, PrismaOutboxRepository, DefaultNotificationPolicy } from '../notifications/notifications.repository.js';

// Scopes per SCHEMA.md: jobs:write, sources:read, scrape-runs:write
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

export async function jobsRoutes(fastify: FastifyInstance) {
  const jobRepo = new JobRepository(fastify.prisma);
  const idempotencyRepo = new IdempotencyRepository(fastify.prisma);
  const normalizer = new JobNormalizer();
  const deduplicator = new JobDeduplicationService(jobRepo);
  const matchingEngine = new MatchingEngine();

  const notificationRepo = new PrismaNotificationRepository(fastify.prisma);
  const outboxRepo = new PrismaOutboxRepository(fastify.prisma);
  const policy = new DefaultNotificationPolicy(fastify.prisma);
  const notificationService = new NotificationService({ prisma: fastify.prisma, notificationRepo, outboxRepo, policy });

  const ingestionService = new JobIngestionService({
    prisma: fastify.prisma,
    jobRepository: jobRepo,
    normalizer,
    deduplicator,
    matchingEngine,
    notificationService,
  });

  // All jobs routes require authentication (JWT or API key)
  fastify.addHook('preHandler', fastify.authenticateAny);

  // ─── POST /api/jobs/ingest (batch) ─────────────────────────────────────
  fastify.post(
    '/jobs/ingest',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Scope check for API key callers
      assertScopes(request, REQUIRED_SCOPES_JOBS_WRITE);

      const userId = request.userId!;

      // Idempotency key from header (case-insensitive)
      const idempotencyKey =
        (request.headers['idempotency-key'] as string | undefined) ||
        (request.headers['Idempotency-Key'] as string | undefined);

      if (idempotencyKey) {
        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(idempotencyKey)) {
          throw new BadRequestError('Idempotency-Key must be a valid UUID');
        }

        // Check cache
        const cached = await idempotencyRepo.findByKey(idempotencyKey, userId, 'jobs:ingest');
        if (cached && cached.response !== null) {
          reply.header('X-Idempotent-Replayed', 'true');
          const status = cached.statusCode ?? 200;
          return reply.status(status).send(cached.response);
        }

        // Create placeholder if not exists (first time)
        if (!cached) {
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
          await idempotencyRepo.createPlaceholder(idempotencyKey, userId, 'jobs:ingest', expiresAt);
        } else if (cached.response === null) {
          // In-progress dedup — tell client to retry later
          return reply.status(409).send({
            error: 'Conflict',
            message: 'Request with same Idempotency-Key is already processing',
            code: 'IDEMPOTENCY_CONFLICT',
          });
        }
      }

      const body = IngestJobsSchema.parse(request.body);

      let result: Awaited<ReturnType<typeof ingestionService.ingest>>;
      try {
        result = await ingestionService.ingest(userId, body);
      } catch (err) {
        // On error, we should not cache error as idempotent success — allow retry
        // Clean up placeholder to allow retry (or leave but without response)
        if (idempotencyKey) {
          // Delete placeholder so retry can proceed (optional)
          await fastify.prisma.idempotencyKey.delete({ where: { key: idempotencyKey } }).catch(() => {});
        }
        throw err;
      }

      const responsePayload = {
        success: true,
        data: result,
        meta: {
          source_id: body.source_id,
        },
      };

      if (idempotencyKey) {
        await idempotencyRepo.saveResponse(idempotencyKey, userId, 'jobs:ingest', responsePayload, 201).catch(() => {});
      }

      return reply.status(201).send(responsePayload);
    },
  );

  // ─── GET /api/jobs ──────────────────────────────────────────────────────
  fastify.get('/jobs', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const query = ListJobsQuerySchema.parse(request.query);

    const { jobs, total, page, limit } = await ingestionService.list(userId, {
      page: query.page,
      limit: query.limit,
      status: query.status as unknown as import('@prisma/client').JobStatus | undefined,
      sourceId: query.source_id,
      search: query.search,
      sortBy: query.sort_by,
      sortOrder: query.sort_order,
    });

    return reply.send({
      data: jobs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  });

  // ─── GET /api/jobs/:id ──────────────────────────────────────────────────
  fastify.get('/jobs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const { id } = JobIdParamSchema.parse(request.params);
    const job = await ingestionService.getById(userId, id);
    return reply.send({ data: job });
  });

  // ─── DELETE /api/jobs/:id ─────────────────────────────────────────────────
  fastify.delete('/jobs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    // Destructive — restrict API-key callers to jobs:write scope
    assertScopes(request, REQUIRED_SCOPES_JOBS_WRITE);

    const { id } = JobIdParamSchema.parse(request.params);
    await ingestionService.deleteById(request.userId!, id);

    return reply.send({ success: true, message: 'Job deleted' });
  });

  // ─── PATCH /api/jobs/:id/status ─────────────────────────────────────────
  fastify.patch('/jobs/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const { id } = JobIdParamSchema.parse(request.params);
    const body = UpdateJobStatusSchema.parse(request.body);

    const updated = await ingestionService.updateStatus(userId, id, {
      status: body.status as unknown as import('@prisma/client').JobStatus,
      note: body.note,
    });

    return reply.send({ data: updated });
  });
}
