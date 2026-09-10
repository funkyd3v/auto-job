import type { Source, MatchedJob } from '../lib/types.js';
import type { ApiClient } from './api-client.js';
import { AdapterRegistry } from '../scrapers/registry.js';
import { MatchingEngine, SkillNormalizer } from '../matching/index.js';
import type { SkillFromApi, MatchSettings, NormalizedSkillForMatch } from '../matching/types.js';
import { getNativeBridge, NativeHostException } from './native-bridge.js';

/**
 * ScrapeOrchestrator — sequential per-source execution, failure isolation,
 * batch submission, concurrency guard.
 *
 * Flow (ARCHITECTURE.md):
 *   load config → fetch skills+settings →
 *   send scrape request to native host →
 *   native host performs stealth HTTP →
 *   receive structured JSON →
 *   normalize → match locally →
 *   batch submit qualifying jobs →
 *   report scrape_run
 *
 * Phase 7+: Matching moved to extension. Only jobs meeting threshold are submitted.
 * Backend stores pre-matched jobs without recalculation.
 *
 * v0.2.0: Scraping moved to native host. Extension no longer opens tabs or
 * injects content scripts. All HTTP activity originates from the Python native
 * host with TLS impersonation and stealth techniques.
 */

interface OrchestratorDeps {
  apiClient: ApiClient;
  registry: AdapterRegistry;
  getSources: () => Promise<Source[]>;
  extensionVersion: string;
}

export class ScrapeOrchestrator {
  private running = new Set<string>();

  constructor(private readonly deps: OrchestratorDeps) {}

  /** Run all enabled sources sequentially — used by scheduler tick */
  async runAll(): Promise<void> {
    const sources = (await this.deps.getSources()).filter((s) => s.is_enabled);
    for (const source of sources) {
      await this.runScrape(source.id).catch((err) => console.error(`[Orchestrator] source ${source.name} failed`, err));
    }
  }

  /** Run single source — idempotent, isolated */
  async runScrape(sourceId: string): Promise<void> {
    if (this.running.has(sourceId)) {
      console.warn(`[Orchestrator] skip — already running: ${sourceId}`);
      return;
    }
    this.running.add(sourceId);

    const sources = await this.deps.getSources();
    const source = sources.find((s) => s.id === sourceId);
    if (!source) {
      this.running.delete(sourceId);
      throw new Error(`Source not found: ${sourceId}`);
    }

    // ─── Distributed Lock ──────────────────────────────────────────────────
    const lock = await this.deps.apiClient.acquireScrapeLock(sourceId);
    if (!lock.acquired) {
      this.running.delete(sourceId);
      console.warn(`[Orchestrator] skip — distributed lock held: ${sourceId}`);
      return;
    }

    const startedAt = new Date().toISOString();
    let pagesAttempted = 0;
    let pagesSuccessful = 0;
    let jobsFound = 0;
    let jobsMatched = 0;
    let scrapeError: { code: string; message: string } | undefined;

    try {
      // Validate adapter config early — fail fast if misconfigured
      const adapter = this.deps.registry.resolve(source);
      adapter.validateConfig(source.scraper_config);

      // ─── Phase 7+: Fetch skills + match settings for local matching ──────
      const [skills, matchSettings] = await Promise.all([
        this.deps.apiClient.getSkills(),
        this.deps.apiClient.getMatchSettings(),
      ]);

      const normalizer = new SkillNormalizer();
      const normalizedSkills = normalizer.normalize(skills);
      const matchingEngine = new MatchingEngine();

      console.info(`[Orchestrator] ${source.name}: loaded ${skills.length} skills, threshold=${matchSettings.min_match_percentage}%`);

      // ─── Native Host: Scrape via stealth HTTP ────────────────────────────
      // No more opening tabs or injecting content scripts.
      // The adapter sends scrape requests to the Python native host,
      // which performs stealth HTTP and returns structured JSON.

      const rawJobs = await adapter.scrape({ source, tabId: 0 }); // tabId unused in native host mode
      jobsFound = rawJobs.length;
      pagesAttempted = 1;
      pagesSuccessful = 1;

      // ─── Phase 7+: Match jobs locally, filter by threshold ──────────────
      const matchedJobs: MatchedJob[] = [];

      for (const rawJob of rawJobs) {
        const matchResult = matchingEngine.calculate(
          { title: rawJob.title, description: rawJob.description },
          normalizedSkills,
        );

        // Only include jobs that meet the threshold and are not disqualified
        if (!matchResult.isDisqualified && matchResult.score >= matchSettings.min_match_percentage) {
          matchedJobs.push({
            ...rawJob,
            match_score: matchResult.score,
            matching_version: matchResult.matchingVersion,
            matched_skills: matchingEngine.toPayload(matchResult),
          });
        }
      }

      jobsMatched = matchedJobs.length;
      console.info(`[Orchestrator] ${source.name}: ${jobsFound} found, ${jobsMatched} matched (threshold: ${matchSettings.min_match_percentage}%)`);

      // Batch submit — only matched jobs with pre-calculated scores
      if (matchedJobs.length > 0) {
        const result = await this.deps.apiClient.submitJobs(source.id, matchedJobs);
        console.info(`[Orchestrator] ${source.name}: +${result.created} upd:${result.updated} dup:${result.duplicates}`);
      }

      // Flush any offline queue opportunistically
      this.deps.apiClient.flushQueue().catch(() => {});

      // Report success
      await this.deps.apiClient.createScrapeRun({
        source_id: source.id,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: 'SUCCESS',
        pages_attempted: pagesAttempted,
        pages_successful: pagesSuccessful,
        jobs_found: jobsFound,
        jobs_matched: jobsMatched,
        extension_version: this.deps.extensionVersion,
        scraper_version: source.scraper_version,
        config_version: source.config_version,
      });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const isBlocked = /blocked|403|429|captcha/i.test(message);
      const isNativeHost = err instanceof NativeHostException;

      scrapeError = {
        code: isBlocked ? 'SOURCE_BLOCKED' : isNativeHost ? 'NATIVE_HOST_ERROR' : 'SCRAPE_FAILED',
        message: message.slice(0, 500),
      };

      await this.deps.apiClient.createScrapeRun({
        source_id: source.id,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: 'FAILED',
        pages_attempted: pagesAttempted,
        pages_successful: pagesSuccessful,
        jobs_found: jobsFound,
        jobs_matched: jobsMatched,
        error_code: scrapeError.code,
        error_message: scrapeError.message,
        extension_version: this.deps.extensionVersion,
        scraper_version: source.scraper_version,
        config_version: source.config_version,
      });
      throw err;
    } finally {
      // Release distributed lock
      if (lock.lockId) {
        await this.deps.apiClient.releaseScrapeLock(sourceId, lock.lockId);
      }
      this.running.delete(sourceId);
    }
  }
}
