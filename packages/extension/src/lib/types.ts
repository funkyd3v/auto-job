/**
 * Shared domain types — extension mirrors backend Source contract.
 * Backend is source of truth; extension never mutates schedule locally.
 */

export interface Source {
  id: string;
  name: string;
  source_type: string;
  base_url: string;
  scraper_config: Record<string, unknown>;
  config_version: number;
  scraper_version: string;
  is_enabled: boolean;
  schedule: string; // cron "0 */6 * * *"
}

export interface RawSourceJob {
  external_job_id?: string | null;
  title: string;
  company: string;
  location?: string | null;
  url: string;
  description: string;
  salary?: string | null;
  scraped_at?: string;
}

export interface NormalizedJob extends RawSourceJob {
  source_id: string;
}

export interface ScrapeContext {
  source: Source;
  tabId: number;
}

export interface SourceHealth {
  source_id: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  message?: string;
  checked_at: string;
}

export interface ScrapeRunReport {
  source_id: string;
  started_at: string;
  finished_at: string;
  status: 'SUCCESS' | 'FAILED';
  pages_attempted: number;
  pages_successful: number;
  jobs_found: number;
  jobs_new?: number;
  jobs_updated?: number;
  jobs_duplicate?: number;
  jobs_matched?: number;
  error_code?: string;
  error_message?: string;
  extension_version: string;
  scraper_version: string;
  config_version: number;
}

export interface BackendConfig {
  backendUrl: string; // e.g. https://api.autojob.example.com
  apiKey: string; // scoped: jobs:write, sources:read, scrape-runs:write
}

// ─── Skills & Matching (Phase 7+) ───────────────────────────────────────────

export interface SkillFromApi {
  id: string;
  skill_name: string;
  normalized_name: string;
  weight: number;
  skill_type: 'required' | 'preferred' | 'excluded';
  aliases: Array<{
    alias: string;
    normalized_alias: string;
  }>;
}

export interface MatchSettings {
  min_match_percentage: number;
  notify_on_match: boolean;
}

export interface MatchedSkillForPayload {
  skill_id: string;
  skill_name: string;
  type: 'required' | 'preferred' | 'excluded';
  weight: number;
  matched: boolean;
  matched_in_title: boolean;
  contribution: number;
}

export interface MatchedJob extends RawSourceJob {
  match_score: number;
  matching_version: string;
  matched_skills: MatchedSkillForPayload[];
}
