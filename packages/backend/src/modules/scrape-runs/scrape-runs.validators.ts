import { z } from 'zod';

export const CreateScrapeRunSchema = z.object({
  source_id: z.string().uuid(),
  started_at: z.string().datetime({ offset: true }),
  finished_at: z.string().datetime({ offset: true }).optional().nullable(),
  status: z.enum(['RUNNING', 'SUCCESS', 'FAILED']),
  pages_attempted: z.number().int().min(0).default(0),
  pages_successful: z.number().int().min(0).default(0),
  jobs_found: z.number().int().min(0).default(0),
  jobs_new: z.number().int().min(0).optional(),
  jobs_updated: z.number().int().min(0).optional(),
  jobs_duplicate: z.number().int().min(0).optional(),
  jobs_matched: z.number().int().min(0).optional(),
  notifications_created: z.number().int().min(0).optional(),
  extension_version: z.string().max(20).optional().nullable(),
  scraper_version: z.string().max(20).optional().nullable(),
  config_version: z.number().int().optional().nullable(),
  error_code: z.string().max(50).optional().nullable(),
  error_message: z.string().max(2000).optional().nullable(),
});

export const ScrapeRunIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateScrapeRunInput = z.infer<typeof CreateScrapeRunSchema>;
