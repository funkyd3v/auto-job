import type { PrismaClient } from '@prisma/client';
import type { SourceType, ScrapeJobInput, ScrapedJob } from './scraper.types.js';
import { ScraperExecutor, ScraperExecutionError } from './scraper.executor.js';
import { JobIngestionService } from '../jobs/jobs.service.js';
import type { IngestResult } from '../jobs/jobs.types.js';
import { MatchingEngine } from '../matching/matching.engine.js';
import { MATCHING_VERSION } from '../matching/matching.types.js';
import type { NormalizedSkillForMatch } from '../matching/matching.types.js';
import { NotFoundError, BadRequestError } from '../../shared/errors/index.js';
import { sanitizeHtml, sanitizeText } from '../../shared/utils/sanitize.js';

export interface ScraperServiceDeps {
  prisma: PrismaClient;
  executor: ScraperExecutor;
  jobIngestionService: JobIngestionService;
}

export class ScraperService {
  private readonly executor: ScraperExecutor;
  private readonly prisma: PrismaClient;
  private readonly jobIngestionService: JobIngestionService;

  constructor(deps: ScraperServiceDeps) {
    this.executor = deps.executor;
    this.prisma = deps.prisma;
    this.jobIngestionService = deps.jobIngestionService;
  }

  /**
   * Run a scrape for a specific source.
   *
   * 1. Load source config from DB
   * 2. Execute Python scraper via subprocess
   * 3. Normalize scraped jobs
   * 4. Match against user skills
   * 5. Submit qualifying jobs to ingestion pipeline
   * 6. Record scrape run metrics
   */
  async scrapeSource(userId: string, sourceId: string): Promise<{
    jobs_found: number;
    jobs_matched: number;
    duration_ms: number;
  }> {
    // 1. Load source
    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, userId, isEnabled: true },
    });
    if (!source) {
      throw new NotFoundError('Source');
    }

    const sourceType = source.sourceType as SourceType;
    const config = source.scraperConfig as Record<string, unknown>;
    const maxPages = (config.maxPages as number) ?? 3;

    // 2. Record RUNNING scrape run so the Logs page always shows activity —
    //    even when the Python scraper fails (status flips to FAILED below).
    const scrapeRun = await this.prisma.scrapeRun.create({
      data: {
        sourceId,
        startedAt: new Date(),
        status: 'RUNNING',
        pagesAttempted: maxPages,
        scraperVersion: source.scraperVersion,
        configVersion: source.configVersion,
      },
    });

    // Build scrape input
    const scrapeInput: ScrapeJobInput = {
      source_type: sourceType,
      keywords: (config.keywords as string[]) ?? [],
      location: config.location as string | undefined,
      max_pages: maxPages,
    };

    const startTime = Date.now();

    try {
      // 3. Execute scraper
      let result;
      try {
        result = await this.executor.execute(scrapeInput);
      } catch (err) {
        if (err instanceof ScraperExecutionError) {
          console.error(`[ScraperService] Scraper failed for ${sourceType}:`, err.stderr);
          throw new BadRequestError(`Scraper failed: ${err.message}`);
        }
        throw err;
      }
      const durationMs = Date.now() - startTime;

      // 4. Load skills for matching
      const skills = await this.loadNormalizedSkills(userId);
      const matchSettings = await this.prisma.matchSettings.findUnique({
        where: { userId },
      });
      const minMatchPercentage = matchSettings?.minMatchPercentage ?? 70;

      // 5. Match and filter jobs
      const matchingEngine = new MatchingEngine();
      const matchedJobs: ScrapedJob[] = [];

      for (const job of result.jobs) {
        const matchResult = matchingEngine.calculate(
          { title: job.title, description: job.description },
          skills,
        );

        if (matchResult.score >= minMatchPercentage) {
          matchedJobs.push({
            ...job,
            scraped_at: new Date().toISOString(),
          });
        }
      }

      // 6. Submit to ingestion pipeline
      let ingestResult: IngestResult | undefined;
      if (matchedJobs.length > 0) {
        ingestResult = await this.jobIngestionService.ingest(userId, {
          source_id: sourceId,
          jobs: matchedJobs.map((j) => ({
            external_job_id: j.external_job_id,
            title: j.title,
            company: j.company,
            location: j.location,
            url: j.url,
            description: j.description,
            salary: j.salary,
            scraped_at: j.scraped_at,
          })),
        });
      }

      // 7. Record SUCCESS scrape run (metrics consumed by the Logs page)
      await this.prisma.scrapeRun.update({
        where: { id: scrapeRun.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          pagesSuccessful: result.metadata.pages_scraped ?? 0,
          jobsFound: result.jobs.length,
          jobsNew: ingestResult?.created ?? 0,
          jobsUpdated: ingestResult?.updated ?? 0,
          jobsDuplicate: ingestResult?.duplicates ?? 0,
          jobsMatched: matchedJobs.length,
        },
      });

      return {
        jobs_found: result.jobs.length,
        jobs_matched: matchedJobs.length,
        duration_ms: durationMs,
      };
    } catch (err) {
      // Record FAILED scrape run so failures are visible instead of silent
      // Prefer stderr (full Python traceback) over generic err.message
      const errorDetail =
        err instanceof ScraperExecutionError && err.stderr.trim()
          ? err.stderr.trim()
          : err instanceof Error
            ? err.message
            : 'Unknown error';

      await this.prisma.scrapeRun
        .update({
          where: { id: scrapeRun.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            errorCode:
              err instanceof ScraperExecutionError ? 'SCRAPER_EXECUTION' : 'UNKNOWN_ERROR',
            errorMessage: errorDetail.slice(0, 2000),
          },
        })
        .catch((updateErr) => {
          console.error(
            `[ScraperService] Failed to mark scrape run ${scrapeRun.id} as FAILED:`,
            updateErr,
          );
        });

      throw err;
    }
  }

  /**
   * Trigger a manual scrape for a source.
   */
  async triggerScrape(userId: string, sourceId: string): Promise<{
    source_id: string;
    jobs_found: number;
    jobs_matched: number;
    duration_ms: number;
  }> {
    const result = await this.scrapeSource(userId, sourceId);
    return {
      source_id: sourceId,
      ...result,
    };
  }

  /**
   * Check scraper health by running a test scrape.
   */
  async healthCheck(sourceType: SourceType): Promise<{
    status: 'healthy' | 'degraded' | 'unavailable';
    error?: string;
  }> {
    try {
      const testInput: ScrapeJobInput = {
        source_type: sourceType,
        keywords: ['test'],
        max_pages: 1,
      };
      await this.executor.execute(testInput, 30_000);
      return { status: 'healthy' };
    } catch (err) {
      return {
        status: 'unavailable',
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  private async loadNormalizedSkills(userId: string): Promise<NormalizedSkillForMatch[]> {
    const skills = await this.prisma.skill.findMany({
      where: { userId },
      include: { aliases: true },
      orderBy: { createdAt: 'asc' },
    });
    return skills.map((s) => ({
      id: s.id,
      normalizedName: s.normalizedName,
      weight: s.weight,
      type: s.skillType as NormalizedSkillForMatch['type'],
      normalizedAliases: s.aliases.map((a) => a.normalizedAlias),
    }));
  }
}
