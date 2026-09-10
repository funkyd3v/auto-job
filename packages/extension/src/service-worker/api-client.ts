import type { Source, ScrapeRunReport, RawSourceJob, SkillFromApi, MatchSettings, MatchedJob } from '../lib/types.js';

export interface LockResult {
  acquired: boolean;
  lockId?: string;
  message?: string;
}

/**
 * ApiClient — Single responsibility: backend communication.
 * Uses scoped API key (X-Api-Key), never user password.
 * Handles Idempotency-Key, offline queue, batching, retries.
 * No remote code exec — JSON only.
 */

export interface ApiClientConfig {
  backendUrl: string; // e.g. http://localhost:3000
  apiKey: string;
  extensionVersion: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const OFFLINE_QUEUE_KEY = 'autojob_offline_queue';
const MAX_BATCH_SIZE = 50;

interface QueuedSubmission {
  source_id: string;
  jobs: MatchedJob[];
  idempotencyKey: string;
  attempts: number;
  createdAt: string;
}

export class ApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.config.apiKey,
    };
  }

  private url(path: string): string {
    return `${this.config.backendUrl.replace(/\/$/, '')}${path}`;
  }

  async getSources(): Promise<Source[]> {
    const res = await fetch(this.url('/api/sources'), { headers: this.headers });
    if (!res.ok) throw new ApiError(res.status, `getSources failed: ${res.statusText}`);
    const body = (await res.json()) as { data: Source[] } | Source[];
    return Array.isArray(body) ? body : body.data;
  }

  /**
   * Fetch all skills with aliases for local matching (Phase 7+).
   * Extension uses this to match jobs against user's configured skills.
   */
  async getSkills(): Promise<SkillFromApi[]> {
    const res = await fetch(this.url('/api/skills'), { headers: this.headers });
    if (!res.ok) throw new ApiError(res.status, `getSkills failed: ${res.statusText}`);
    const body = (await res.json()) as { data: SkillFromApi[] } | SkillFromApi[];
    return Array.isArray(body) ? body : body.data;
  }

  /**
   * Fetch match settings (min_match_percentage, notify_on_match) for local matching (Phase 7+).
   * Extension uses this to filter jobs that meet the threshold.
   */
  async getMatchSettings(): Promise<MatchSettings> {
    const res = await fetch(this.url('/api/settings/match'), { headers: this.headers });
    if (!res.ok) throw new ApiError(res.status, `getMatchSettings failed: ${res.statusText}`);
    const body = (await res.json()) as { data: MatchSettings };
    return body.data;
  }

  /**
   * Submit matched jobs in batches (backend max 100, we use 50). Each batch gets its own Idempotency-Key.
   * Phase 7+: Jobs include pre-calculated match_score, matching_version, and matched_skills from extension.
   * Returns aggregated result.
   */
  async submitJobs(sourceId: string, jobs: MatchedJob[]): Promise<{ created: number; updated: number; duplicates: number }> {
    if (jobs.length === 0) return { created: 0, updated: 0, duplicates: 0 };

    const batches = chunk(jobs, MAX_BATCH_SIZE);
    let agg = { created: 0, updated: 0, duplicates: 0 };

    for (const batch of batches) {
      const idempotencyKey = crypto.randomUUID();
      try {
        const res = await fetch(this.url('/api/jobs/ingest'), {
          method: 'POST',
          headers: { ...this.headers, 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ source_id: sourceId, jobs: batch.map(mapToIngestPayload) }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new ApiError(res.status, text);
        }
        const body = (await res.json()) as { data: { created: number; updated: number; duplicates: number } };
        agg.created += body.data.created;
        agg.updated += body.data.updated;
        agg.duplicates += body.data.duplicates;
      } catch (err) {
        // Queue for offline retry — never lose data on transient failure
        await this.enqueue({ source_id: sourceId, jobs: batch, idempotencyKey, attempts: 0, createdAt: new Date().toISOString() });
        throw err;
      }
    }
    return agg;
  }

  async createScrapeRun(report: ScrapeRunReport): Promise<void> {
    const res = await fetch(this.url('/api/scrape-runs'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(report),
    });
    if (!res.ok) {
      // Non-fatal — log but don't throw for telemetry
      console.warn('[ApiClient] createScrapeRun failed', res.status);
    }
  }

  // ─── Distributed Lock ──────────────────────────────────────────────────────
  /** Acquire distributed lock before scraping a source. */
  async acquireScrapeLock(sourceId: string): Promise<LockResult> {
    try {
      const res = await fetch(this.url('/api/scrape-lock/acquire'), {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ source_id: sourceId }),
      });
      if (res.status === 409) {
        return { acquired: false, message: 'Source is being scraped by another run' };
      }
      if (!res.ok) {
        // Fail open — allow scrape if lock endpoint unavailable
        console.warn('[ApiClient] acquireScrapeLock failed', res.status);
        return { acquired: true, lockId: 'fallback' };
      }
      const body = (await res.json()) as { data: LockResult };
      return body.data;
    } catch {
      // Fail open — allow scrape if backend unreachable
      console.warn('[ApiClient] acquireScrapeLock unreachable — allowing scrape');
      return { acquired: true, lockId: 'fallback' };
    }
  }

  /** Release distributed lock after scraping completes. */
  async releaseScrapeLock(sourceId: string, lockId: string): Promise<void> {
    try {
      await fetch(this.url('/api/scrape-lock/release'), {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ source_id: sourceId, lock_id: lockId }),
      });
    } catch {
      console.warn('[ApiClient] releaseScrapeLock failed — lock will auto-expire');
    }
  }

  // ─── Offline Queue (chrome.storage.local) ───────────────────────────────
  private async enqueue(item: QueuedSubmission): Promise<void> {
    const { [OFFLINE_QUEUE_KEY]: queue = [] } = (await chrome.storage.local.get(OFFLINE_QUEUE_KEY)) as Record<string, QueuedSubmission[]>;
    queue.push(item);
    // Cap queue to prevent storage blowup
    const trimmed = queue.slice(-200);
    await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: trimmed });
  }

  /** Attempt to flush queued submissions — called on scheduler tick / online event */
  async flushQueue(): Promise<number> {
    const { [OFFLINE_QUEUE_KEY]: queue = [] } = (await chrome.storage.local.get(OFFLINE_QUEUE_KEY)) as Record<string, QueuedSubmission[]>;
    if (queue.length === 0) return 0;

    const remaining: QueuedSubmission[] = [];
    let flushed = 0;

    for (const item of queue) {
      if (item.attempts >= 5) continue; // drop after 5 retries
      try {
        const res = await fetch(this.url('/api/jobs/ingest'), {
          method: 'POST',
          headers: { ...this.headers, 'Idempotency-Key': item.idempotencyKey },
          body: JSON.stringify({ source_id: item.source_id, jobs: item.jobs.map(mapToIngestPayload) }),
        });
        if (!res.ok) throw new ApiError(res.status, await res.text());
        flushed++;
      } catch {
        remaining.push({ ...item, attempts: item.attempts + 1 });
      }
    }

    await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: remaining });
    return flushed;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function mapToIngestPayload(j: MatchedJob) {
  return {
    external_job_id: j.external_job_id ?? null,
    title: j.title,
    company: j.company,
    location: j.location ?? null,
    url: j.url,
    description: j.description,
    salary: j.salary ?? null,
    scraped_at: j.scraped_at ?? new Date().toISOString(),
    // Phase 7+: pre-matched data from extension
    match_score: j.match_score,
    matching_version: j.matching_version,
    matched_skills: j.matched_skills,
  };
}
