export type SourceType = 'bdjobs' | 'nextjobzbd';

export interface ScrapeJobInput {
  source_type: SourceType;
  keywords: string[];
  location?: string;
  max_pages: number;
}

export interface ScrapedJob {
  external_job_id: string | null;
  title: string;
  company: string;
  location: string | null;
  url: string;
  description: string;
  salary: string | null;
  scraped_at: string | null;
}

export interface ScrapeMetadata {
  duration: number;
  pages_scraped: number;
  profile_used: string;
}

export interface ScrapeResult {
  jobs: ScrapedJob[];
  metadata: ScrapeMetadata;
}

export interface ScraperHealthStatus {
  source_type: SourceType;
  status: 'healthy' | 'degraded' | 'unavailable';
  last_checked: string;
  error?: string;
}
