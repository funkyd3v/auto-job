import { z } from 'zod';

const MatchedSkillSchema = z.object({
  skill_id: z.string().uuid(),
  skill_name: z.string().min(1).max(100),
  type: z.enum(['required', 'preferred', 'excluded']),
  weight: z.number().int().min(1).max(100),
  matched: z.boolean(),
  matched_in_title: z.boolean(),
  contribution: z.number().min(0),
});

export const IngestJobSchema = z.object({
  external_job_id: z
    .string()
    .min(1, 'external_job_id cannot be empty')
    .max(255)
    .optional()
    .nullable()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  title: z.string().min(1, 'title is required').max(500),
  company: z.string().min(1, 'company is required').max(200),
  location: z.string().max(200).optional().nullable(),
  url: z.string().url('url must be a valid URL').max(2048),
  description: z.string().min(1, 'description is required').max(50000),
  salary: z.string().max(200).optional().nullable(),
  scraped_at: z.string().datetime({ offset: true }).optional().nullable(),
  // Pre-matched data from extension (Phase 7+)
  match_score: z.number().int().min(0).max(100).optional().nullable(),
  matching_version: z.string().max(20).optional().nullable(),
  matched_skills: z.array(MatchedSkillSchema).optional().nullable(),
});

export const IngestJobsSchema = z.object({
  source_id: z.string().uuid('source_id must be a valid UUID'),
  jobs: z.array(IngestJobSchema).min(1, 'At least one job is required').max(100, 'Maximum 100 jobs per batch'),
});

export const IdempotencyKeyHeaderSchema = z.string().uuid('Idempotency-Key must be a valid UUID').optional();

export const ListJobsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['NEW', 'SAVED', 'APPLIED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'ARCHIVED']).optional(),
  source_id: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  sort_by: z.enum(['created_at', 'match_score', 'scraped_at']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

export const JobIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const UpdateJobStatusSchema = z.object({
  status: z.enum(['NEW', 'SAVED', 'APPLIED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'ARCHIVED']),
  note: z.string().max(500).optional(),
});

export type IngestJobsInput = z.infer<typeof IngestJobsSchema>;
export type IngestJobInput = z.infer<typeof IngestJobSchema>;
export type ListJobsQueryInput = z.infer<typeof ListJobsQuerySchema>;
export type UpdateJobStatusInput = z.infer<typeof UpdateJobStatusSchema>;
