import type { Source, ScrapeContext, RawSourceJob, SourceHealth } from '../lib/types.js';
import type { JobSourceAdapter } from './base.js';
import { AdapterValidationError } from './base.js';
import { sanitizeHtml, sanitizeText } from '../utils/sanitize.js';
import { getNativeBridge, NativeHostException } from '../service-worker/native-bridge.js';

interface BdjobsScraperConfig {
  keywords?: string[];
  location?: string;
  maxPages?: number;
}

/**
 * BdjobsAdapter — thin wrapper that delegates to native host.
 *
 * The native host performs all HTTP scraping with stealth techniques.
 * This adapter only handles validation, normalization, and bridge communication.
 */
export class BdjobsAdapter implements JobSourceAdapter {
  readonly sourceType = 'bdjobs';

  canHandle(source: Source): boolean {
    return source.source_type === 'bdjobs';
  }

  validateConfig(config: unknown): void {
    const c = config as Partial<BdjobsScraperConfig>;
    if (!c) {
      throw new AdapterValidationError('Bdjobs config is required');
    }
  }

  async scrape(context: ScrapeContext): Promise<RawSourceJob[]> {
    const { source } = context;
    const config = source.scraper_config as unknown as BdjobsScraperConfig;

    const bridge = getNativeBridge();
    bridge.ensureConnected();

    try {
      // Build search URL
      const searchUrl = this.buildSearchUrl(config);

      // Delegate to native host
      const result = await bridge.scrapeSearch('bdjobs', searchUrl, {
        max_pages: config.maxPages ?? 3,
      });

      // Normalize and sanitize results
      const normalized = result.jobs.map((job) =>
        this.normalize({
          external_job_id: job.external_job_id,
          title: job.title,
          company: job.company,
          location: job.location,
          url: job.url,
          description: job.description,
          salary: job.salary,
        }),
      );

      console.info(
        `[Bdjobs] ${result.jobs.length} jobs scraped in ${result.metadata.duration}ms (profile: ${result.metadata.profile_used})`,
      );

      return this.deduplicate(normalized);
    } catch (err) {
      if (err instanceof NativeHostException) {
        console.error(`[Bdjobs] native host error: ${err.code} — ${err.message}`);
        if (err.code === 'BLOCKED') {
          throw err;
        }
      } else {
        console.error('[Bdjobs] scrape failed:', err);
      }
      return [];
    }
  }

  private buildSearchUrl(config: BdjobsScraperConfig): string {
    const params = new URLSearchParams();

    if (config.keywords && config.keywords.length > 0) {
      params.set('keywords', config.keywords.join(' '));
    }

    if (config.location) {
      params.set('location', config.location);
    }

    params.set('page', '1');

    return `https://www.bdjobs.com/jobs/search-jobs?${params.toString()}`;
  }

  normalize(job: RawSourceJob): RawSourceJob {
    return {
      external_job_id: job.external_job_id ? sanitizeText(job.external_job_id) : null,
      title: sanitizeText(job.title, 500),
      company: sanitizeText(job.company, 200),
      location: job.location ? sanitizeText(job.location, 200) : null,
      url: job.url.trim(),
      description: sanitizeHtml(job.description),
      salary: job.salary ? sanitizeText(job.salary, 200) : null,
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    try {
      const bridge = getNativeBridge();
      const ok = await bridge.ping();
      return {
        source_id: 'bdjobs',
        status: ok ? 'healthy' : 'degraded',
        checked_at: new Date().toISOString(),
      };
    } catch (e) {
      return {
        source_id: 'bdjobs',
        status: 'unavailable',
        message: (e as Error).message,
        checked_at: new Date().toISOString(),
      };
    }
  }

  private deduplicate(jobs: RawSourceJob[]): RawSourceJob[] {
    const seen = new Set<string>();
    return jobs.filter((j) => {
      const key = `${j.url}|${j.title}|${j.company}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
