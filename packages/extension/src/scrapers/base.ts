import type { Source, ScrapeContext, RawSourceJob, SourceHealth } from '../lib/types.js';

/**
 * SourceAdapter — Strategy pattern. Each board implements this contract.
 * OCP: new sources added via registry, no orchestrator modification.
 * Mirrors ARCHITECTURE.md Source Adapter Architecture.
 */
export interface JobSourceAdapter {
  /** Identifier matching Source.source_type */
  readonly sourceType: string;

  canHandle(source: Source): boolean;

  validateConfig(config: unknown): void;

  /**
   * Scrape jobs using already-opened tab. Adapter may inject content script
   * and collect structured data. Must respect site terms — no CAPTCHA bypass.
   */
  scrape(context: ScrapeContext): Promise<RawSourceJob[]>;

  /** Local normalization — backend still authoritative for fingerprint/dedup */
  normalize(job: RawSourceJob): RawSourceJob;

  healthCheck(): Promise<SourceHealth>;
}

export class AdapterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterValidationError';
  }
}
