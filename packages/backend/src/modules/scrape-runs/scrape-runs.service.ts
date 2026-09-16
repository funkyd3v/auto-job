import type { PrismaClient, ScrapeRun } from '@prisma/client';
import { NotFoundError } from '../../shared/errors/index.js';
import type { CreateScrapeRunInput } from './scrape-runs.validators.js';

export class ScrapeRunsService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, input: CreateScrapeRunInput): Promise<ScrapeRun> {
    // Verify source belongs to user — enforces isolation
    const source = await this.prisma.source.findFirst({ where: { id: input.source_id, userId } });
    if (!source) throw new NotFoundError('Source');

    const run = await this.prisma.scrapeRun.create({
      data: {
        sourceId: input.source_id,
        startedAt: new Date(input.started_at),
        finishedAt: input.finished_at ? new Date(input.finished_at) : null,
        status: input.status as never,
        pagesAttempted: input.pages_attempted ?? 0,
        pagesSuccessful: input.pages_successful ?? 0,
        jobsFound: input.jobs_found ?? 0,
        jobsNew: input.jobs_new ?? 0,
        jobsUpdated: input.jobs_updated ?? 0,
        jobsDuplicate: input.jobs_duplicate ?? 0,
        jobsMatched: input.jobs_matched ?? 0,
        notificationsCreated: input.notifications_created ?? 0,
        extensionVersion: input.extension_version ?? null,
        scraperVersion: input.scraper_version ?? null,
        configVersion: input.config_version ?? null,
        errorCode: input.error_code ?? null,
        errorMessage: input.error_message ?? null,
      },
    });

    // Retention: keep only the 10 most recent scrape runs per user
    const keep = await this.prisma.scrapeRun.findMany({
      where: { source: { userId } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true },
    });
    await this.prisma.scrapeRun.deleteMany({
      where: { source: { userId }, id: { notIn: keep.map((r) => r.id) } },
    });

    return run;
  }

  async list(userId: string, sourceId?: string) {
    // Constrain to user's sources
    const where: Record<string, unknown> = {};
    if (sourceId) {
      const src = await this.prisma.source.findFirst({ where: { id: sourceId, userId } });
      if (!src) throw new NotFoundError('Source');
      (where as { sourceId: string }).sourceId = sourceId;
    } else {
      const userSources = await this.prisma.source.findMany({ where: { userId }, select: { id: true } });
      (where as { sourceId: { in: string[] } }).sourceId = { in: userSources.map((s) => s.id) };
    }
    return this.prisma.scrapeRun.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { source: { select: { id: true, name: true, sourceType: true } } },
    });
  }

  async getById(userId: string, id: string): Promise<ScrapeRun> {
    const run = await this.prisma.scrapeRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundError('ScrapeRun');
    const src = await this.prisma.source.findFirst({ where: { id: run.sourceId, userId } });
    if (!src) throw new NotFoundError('ScrapeRun');
    return run;
  }
}
