import type { Source, ScrapeContext, RawSourceJob, SourceHealth } from '../lib/types.js';
import type { JobSourceAdapter } from './base.js';
import { AdapterValidationError } from './base.js';
import { sanitizeHtml, sanitizeText } from '../utils/sanitize.js';
import { getNativeBridge, NativeHostException } from '../service-worker/native-bridge.js';

interface LinkedInScraperConfig {
  keywords: string[];
  maxJobsPerKeyword?: number;
  location?: string;
  maxAge?: string;
}

/**
 * LinkedInAdapter — thin wrapper that delegates to native host.
 *
 * The native host performs all HTTP scraping with stealth techniques:
 * - TLS fingerprint impersonation
 * - Browser profile rotation
 * - Human-like timing
 * - Cookie persistence
 * - Proxy support
 *
 * This adapter only handles validation, normalization, and bridge communication.
 */
export class LinkedInAdapter implements JobSourceAdapter {
  readonly sourceType = 'linkedin';

  canHandle(source: Source): boolean {
    return source.source_type === 'linkedin';
  }

  validateConfig(config: unknown): void {
    const c = config as Partial<LinkedInScraperConfig>;
    if (!c || !Array.isArray(c.keywords) || c.keywords.length === 0) {
      throw new AdapterValidationError('LinkedIn config requires keywords (non-empty array)');
    }
    for (const kw of c.keywords) {
      if (typeof kw !== 'string' || kw.trim().length === 0) {
        throw new AdapterValidationError('LinkedIn keywords must be non-empty strings');
      }
    }
    if (c.maxJobsPerKeyword !== undefined) {
      if (typeof c.maxJobsPerKeyword !== 'number' || c.maxJobsPerKeyword < 1 || c.maxJobsPerKeyword > 100) {
        throw new AdapterValidationError('LinkedIn maxJobsPerKeyword must be 1-100');
      }
    }
  }

  /**
   * Scrape LinkedIn jobs via native host.
   *
   * Flow:
   * 1. Build search URL from config keywords
   * 2. Send SCRAPE_SEARCH to native host
   * 3. Native host performs stealth HTTP request
   * 4. Native host parses HTML → returns structured JSON
   * 5. We normalize and return
   */
  async scrape(context: ScrapeContext): Promise<RawSourceJob[]> {
    const { source } = context;
    const config = source.scraper_config as unknown as LinkedInScraperConfig;

    const bridge = getNativeBridge();
    bridge.ensureConnected();

    const allJobs: RawSourceJob[] = [];

    for (const keyword of config.keywords) {
      try {
        // Build search URL for this keyword
        const searchUrl = this.buildSearchUrl(keyword, config);

        // Delegate to native host
        const result = await bridge.scrapeSearch('linkedin', searchUrl, {
          max_pages: 3,
          keywords: [keyword],
          location: config.location,
          max_age: config.maxAge ?? 'r86400',
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

        allJobs.push(...normalized);

        console.info(
          `[LinkedIn] keyword "${keyword}": ${result.jobs.length} jobs scraped in ${result.metadata.duration}ms (profile: ${result.metadata.profile_used})`,
        );
      } catch (err) {
        if (err instanceof NativeHostException) {
          console.error(`[LinkedIn] keyword "${keyword}" native host error: ${err.code} — ${err.message}`);
          if (err.code === 'BLOCKED') {
            throw err; // Don't continue if blocked
          }
        } else {
          console.error(`[LinkedIn] keyword "${keyword}" failed:`, err);
        }
      }
    }

    return this.deduplicate(allJobs);
  }

  /**
   * Build LinkedIn search URL from keyword and config.
   */
  private buildSearchUrl(keyword: string, config: LinkedInScraperConfig): string {
    const params = new URLSearchParams({
      keywords: keyword,
      origin: 'JOB_SEARCH_PAGE_JOB_FILTER',
      f_TPR: config.maxAge ?? 'r86400',
    });

    if (config.location) {
      params.set('location', config.location);
    }

    return `https://www.linkedin.com/jobs/search-results/?${params.toString()}`;
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
        source_id: 'linkedin',
        status: ok ? 'healthy' : 'degraded',
        checked_at: new Date().toISOString(),
      };
    } catch (e) {
      return {
        source_id: 'linkedin',
        status: 'unavailable',
        message: (e as Error).message,
        checked_at: new Date().toISOString(),
      };
    }
  }

  private deduplicate(jobs: RawSourceJob[]): RawSourceJob[] {
    const seen = new Set<string>();
    return jobs.filter((j) => {
      const key = `${j.external_job_id ?? j.url}|${j.title}|${j.company}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
