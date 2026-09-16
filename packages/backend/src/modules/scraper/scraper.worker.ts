import type { PrismaClient } from '@prisma/client';
import { Worker, type Job } from 'bullmq';
import { ScraperService } from './scraper.service.js';
import { ScraperExecutor } from './scraper.executor.js';
import { JobIngestionService, JobNormalizer, JobDeduplicationService } from '../jobs/jobs.service.js';
import { JobRepository } from '../jobs/jobs.repository.js';

export interface ScraperWorkerDeps {
  prisma: PrismaClient;
  redisConnection: { host: string; port: number; password?: string };
}

export interface ScrapeJobData {
  source_id: string;
  user_id: string;
}

const QUEUE_NAME = 'scrape';
const CONCURRENCY = 1; // Single-user: one scrape at a time

export function createScraperWorker(deps: ScraperWorkerDeps): Worker {
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

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<ScrapeJobData>) => {
      const { source_id, user_id } = job.data;

      console.info(`[ScraperWorker] Processing scrape job for source ${source_id}`);

      try {
        const result = await scraperService.scrapeSource(user_id, source_id);

        console.info(
          `[ScraperWorker] Completed scrape for source ${source_id}: ` +
          `${result.jobs_found} found, ${result.jobs_matched} matched, ` +
          `${result.duration_ms}ms`
        );

        return result;
      } catch (err) {
        console.error(`[ScraperWorker] Scrape failed for source ${source_id}:`, err);
        throw err;
      }
    },
    {
      connection: deps.redisConnection,
      concurrency: CONCURRENCY,
      limiter: {
        max: 1,
        duration: 60_000, // Max 1 job per minute
      },
    }
  );

  worker.on('completed', (job) => {
    console.info(`[ScraperWorker] Job ${job.id} completed for source ${job.data.source_id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[ScraperWorker] Job ${job?.id} failed for source ${job?.data.source_id}:`,
      err.message
    );
  });

  return worker;
}
