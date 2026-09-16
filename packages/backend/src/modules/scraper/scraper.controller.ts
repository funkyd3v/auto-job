import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { ScraperService } from './scraper.service.js';
import { ScraperExecutor } from './scraper.executor.js';
import { JobIngestionService, JobNormalizer, JobDeduplicationService } from '../jobs/jobs.service.js';
import { JobRepository } from '../jobs/jobs.repository.js';
import type { SourceType } from './scraper.types.js';

export interface ScraperControllerDeps {
  prisma: PrismaClient;
}

export async function scraperRoutes(
  fastify: FastifyInstance,
  deps: ScraperControllerDeps,
): Promise<void> {
  const executor = new ScraperExecutor();
  const jobRepository = new JobRepository(deps.prisma);
  const jobIngestionService = new JobIngestionService({
    prisma: deps.prisma,
    jobRepository,
    normalizer: new JobNormalizer(),
    deduplicator: new JobDeduplicationService(jobRepository),
  });
  const scraperService = new ScraperService({
    prisma: deps.prisma,
    executor,
    jobIngestionService,
  });

  // POST /api/scrape-runs/trigger - Manual scrape trigger
  fastify.post('/api/scrape-runs/trigger', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as FastifyRequest & { userId: string }).userId;
    const { source_id } = request.body as { source_id: string };

    if (!source_id) {
      return reply.status(400).send({ error: 'source_id is required' });
    }

    try {
      const result = await scraperService.triggerScrape(userId, source_id);
      return reply.status(200).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/scraper/status - Browser health status
  fastify.get('/api/scraper/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const sources: SourceType[] = ['bdjobs', 'nextjobzbd'];
    const statuses = await Promise.all(
      sources.map(async (sourceType) => ({
        source_type: sourceType,
        ...(await scraperService.healthCheck(sourceType)),
        last_checked: new Date().toISOString(),
      })),
    );

    return reply.status(200).send({ scrapers: statuses });
  });
}
