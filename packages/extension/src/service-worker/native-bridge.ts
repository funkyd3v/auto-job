/**
 * NativeBridge — Type-safe API over Chrome Native Messaging.
 *
 * Provides high-level methods for scraping operations:
 * - scrapeSearch: Search job listings
 * - scrapeDetail: Get full job details
 * - ping: Health check
 * - shutdown: Graceful shutdown
 *
 * All methods return typed results and handle errors consistently.
 */

import { NativeHost } from './native-host.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RawJob {
  external_job_id?: string | null;
  title: string;
  company: string;
  location?: string | null;
  url: string;
  description: string;
  salary?: string | null;
  scraped_at?: string;
}

export interface ScrapeMetadata {
  duration: number;
  profile_used: string;
  pages_scraped: number;
  proxy_used?: string;
}

export interface SearchResult {
  jobs: RawJob[];
  metadata: ScrapeMetadata;
}

export interface DetailResult {
  job: RawJob | null;
  metadata: ScrapeMetadata;
}

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ScrapeConfig {
  max_pages?: number;
  proxy?: ProxyConfig;
  cookie_session?: string;
  timeout?: number;
  keywords?: string[];
  location?: string;
  max_age?: string;
}

export interface NativeBridgeError {
  code: 'BLOCKED' | 'RATE_LIMITED' | 'PARSE_ERROR' | 'NETWORK_ERROR' | 'CONFIG_ERROR' | 'HOST_ERROR';
  message: string;
  retryable: boolean;
  retry_after?: number;
}

// ─── Bridge ──────────────────────────────────────────────────────────────────

export class NativeBridge {
  private host: NativeHost;
  private connected = false;

  constructor() {
    this.host = new NativeHost({
      onDisconnect: () => {
        this.connected = false;
      },
      onReconnect: (attempt) => {
        console.info(`[NativeBridge] reconnect attempt ${attempt}`);
      },
    });
  }

  /**
   * Ensure connection to native host is active.
   */
  ensureConnected(): void {
    if (!this.host.isConnected) {
      this.host.connect();
    }
    this.connected = true;
  }

  /**
   * Disconnect from native host.
   */
  disconnect(): void {
    this.host.disconnect();
    this.connected = false;
  }

  /**
   * Check if connected to native host.
   */
  get isConnected(): boolean {
    return this.host.isConnected;
  }

  /**
   * Health check — ping the native host.
   */
  async ping(): Promise<boolean> {
    try {
      this.ensureConnected();
      const response = await this.host.send<{ type: string }>({ type: 'PING' }, 5000);
      return response.type === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Scrape job search results.
   *
   * @param source - Source type (e.g., 'linkedin', 'indeed')
   * @param url - Search URL (if null, built from config)
   * @param config - Scrape configuration
   * @returns Search results with jobs and metadata
   */
  async scrapeSearch(
    source: string,
    url: string | null,
    config: ScrapeConfig = {},
  ): Promise<SearchResult> {
    this.ensureConnected();

    const message = {
      type: 'SCRAPE_SEARCH',
      payload: {
        source,
        url: url ?? '',
        config,
      },
    };

    const response = await this.host.send<{
      type: string;
      payload: {
        jobs: RawJob[];
        metadata: ScrapeMetadata;
      };
    }>(message, 120_000); // 2 minute timeout for search operations

    if (response.type === 'ERROR') {
      const errorPayload = response.payload as unknown as NativeBridgeError;
      throw new NativeHostException(errorPayload);
    }

    return {
      jobs: response.payload.jobs,
      metadata: response.payload.metadata,
    };
  }

  /**
   * Scrape a job detail page.
   *
   * @param source - Source type (e.g., 'linkedin', 'indeed')
   * @param url - Detail page URL
   * @param config - Scrape configuration
   * @returns Job details with metadata
   */
  async scrapeDetail(
    source: string,
    url: string,
    config: ScrapeConfig = {},
  ): Promise<DetailResult> {
    this.ensureConnected();

    const message = {
      type: 'SCRAPE_DETAIL',
      payload: {
        source,
        url,
        config,
      },
    };

    const response = await this.host.send<{
      type: string;
      payload: {
        job: RawJob | null;
        metadata: ScrapeMetadata;
      };
    }>(message, 60_000);

    if (response.type === 'ERROR') {
      const errorPayload = response.payload as unknown as NativeBridgeError;
      throw new NativeHostException(errorPayload);
    }

    return {
      job: response.payload.job,
      metadata: response.payload.metadata,
    };
  }

  /**
   * Gracefully shut down the native host.
   */
  async shutdown(): Promise<void> {
    if (!this.host.isConnected) return;

    try {
      await this.host.send({ type: 'SHUTDOWN' }, 5000);
    } catch {
      // Shutdown is best-effort
    } finally {
      this.host.disconnect();
    }
  }
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class NativeHostException extends Error {
  code: string;
  retryable: boolean;
  retryAfter?: number;

  constructor(error: NativeBridgeError) {
    super(error.message);
    this.name = 'NativeHostException';
    this.code = error.code;
    this.retryable = error.retryable;
    this.retryAfter = error.retry_after;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let instance: NativeBridge | null = null;

/**
 * Get the singleton NativeBridge instance.
 */
export function getNativeBridge(): NativeBridge {
  if (!instance) {
    instance = new NativeBridge();
  }
  return instance;
}
