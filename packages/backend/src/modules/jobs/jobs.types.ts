import type { JobStatus } from '@prisma/client';

export interface MatchedSkillFromExtension {
  skill_id: string;
  skill_name: string;
  type: 'required' | 'preferred' | 'excluded';
  weight: number;
  matched: boolean;
  matched_in_title: boolean;
  contribution: number;
}

export interface IngestJobInput {
  external_job_id?: string | null;
  title: string;
  company: string;
  location?: string | null;
  url: string;
  description: string;
  salary?: string | null;
  scraped_at?: string | null;
  match_score?: number | null;
  matching_version?: string | null;
  matched_skills?: MatchedSkillFromExtension[] | null;
}

export interface IngestRequest {
  source_id: string;
  jobs: IngestJobInput[];
}

export interface NormalizedJob {
  sourceId: string;
  sourceType: string;
  externalJobId: string | null;
  title: string;
  company: string;
  location: string | null;
  url: string;
  canonicalUrl: string;
  description: string;
  salary: string | null;
  scrapedAt: Date;
  jobFingerprint: string;
  // normalized components for audit
  normalizedTitle: string;
  normalizedCompany: string;
}

export interface IngestResult {
  total: number;
  created: number;
  updated: number;
  duplicates: number;
  jobs: Array<{
    id: string;
    fingerprint: string;
    action: 'created' | 'updated' | 'duplicate';
    match_score?: number | null;
    matching_version?: string | null;
  }>;
}

export interface ListJobsQuery {
  page?: number;
  limit?: number;
  status?: JobStatus;
  source_id?: string;
  search?: string;
  sort_by?: 'created_at' | 'match_score' | 'scraped_at';
  sort_order?: 'asc' | 'desc';
}

export interface JobDto {
  id: string;
  sourceId: string;
  externalJobId: string | null;
  jobFingerprint: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  description: string;
  salary: string | null;
  matchScore: number | null;
  matchingVersion: string | null;
  status: JobStatus;
  scrapedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateJobStatusInput {
  status: JobStatus;
  note?: string;
}
