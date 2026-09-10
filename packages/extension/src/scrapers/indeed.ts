import type { Source, ScrapeContext, RawSourceJob, SourceHealth } from '../lib/types.js';
import type { JobSourceAdapter } from './base.js';
import { AdapterValidationError } from './base.js';
import { sanitizeHtml, sanitizeText } from '../utils/sanitize.js';
import { getNativeBridge, NativeHostException } from '../service-worker/native-bridge.js';

interface IndeedScraperConfig {
  searchUrl: string;
  keywords?: string[];
  location?: string;
  maxPages?: number;
}

/**
 * IndeedAdapter — thin wrapper that delegates to native host.
 *
 * The native host performs all HTTP scraping with stealth techniques.
 * This adapter only handles validation, normalization, and bridge communication.
 */
export class IndeedAdapter implements JobSourceAdapter {
  readonly sourceType = 'indeed';

  canHandle(source: Source): boolean {
    return source.source_type === 'indeed';
  }

  validateConfig(config: unknown): void {
    const c = config as Partial<IndeedScraperConfig>;
    if (!c) {
      throw new AdapterValidationError('Indeed config is required');
    }
    // Must have either searchUrl or keywords
    if (!c.searchUrl && (!c.keywords || c.keywords.length === 0)) {
      throw new AdapterValidationError('Indeed config requires searchUrl or keywords');
    }
    if (c.searchUrl && typeof c.searchUrl === 'string' && !c.searchUrl.startsWith('https://')) {
      throw new AdapterValidationError('Indeed searchUrl must be https');
    }
  }

  /**
   * Scrape Indeed jobs via native host.
   *
   * Flow:
   * 1. Build search URL from config
   * 2. Send SCRAPE_SEARCH to native host
   * 3. Native host performs stealth HTTP request
   * 4. Native host parses HTML → returns structured JSON
   * 5. We normalize and return
   */
  async scrape(context: ScrapeContext): Promise<RawSourceJob[]> {
    const { source } = context;
    const config = source.scraper_config as unknown as IndeedScraperConfig;

    const bridge = getNativeBridge();
    bridge.ensureConnected();

    try {
      // Build search URL
      const searchUrl = config.searchUrl || this.buildSearchUrl(config);

      // Delegate to native host
      const result = await bridge.scrapeSearch('indeed', searchUrl, {
        max_pages: config.maxPages ?? 3,
        keywords: config.keywords,
        location: config.location,
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
        `[Indeed] ${result.jobs.length} jobs scraped in ${result.metadata.duration}ms (profile: ${result.metadata.profile_used})`,
      );

      return this.deduplicate(normalized);
    } catch (err) {
      if (err instanceof NativeHostException) {
        console.error(`[Indeed] native host error: ${err.code} — ${err.message}`);
        if (err.code === 'BLOCKED') {
          throw err;
        }
      } else {
        console.error('[Indeed] scrape failed:', err);
      }
      return [];
    }
  }

  /**
   * Build Indeed search URL from config.
   */
  private buildSearchUrl(config: IndeedScraperConfig): string {
    const params = new URLSearchParams();

    if (config.keywords && config.keywords.length > 0) {
      params.set('q', config.keywords.join(' '));
    }

    if (config.location) {
      params.set('l', config.location);
    }

    return `https://www.indeed.com/jobs?${params.toString()}`;
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
        source_id: 'indeed',
        status: ok ? 'healthy' : 'degraded',
        checked_at: new Date().toISOString(),
      };
    } catch (e) {
      return {
        source_id: 'indeed',
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
