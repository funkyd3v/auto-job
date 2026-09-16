import { z } from 'zod';

export const CreateSourceSchema = z.object({
  name: z.string().min(1).max(100),
  source_type: z.string().min(1).max(50),
  base_url: z.string().url().max(2048),
  scraper_config: z.record(z.unknown()).default({}),
  scraper_version: z.string().min(1).max(20),
  config_version: z.number().int().min(1).optional(),
  is_enabled: z.boolean().optional().default(true),
  schedule: z.string().min(1).max(50), // cron, validated loosely; backend is canonical
});

export const UpdateSourceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  base_url: z.string().url().max(2048).optional(),
  scraper_config: z.record(z.unknown()).optional(),
  scraper_version: z.string().min(1).max(20).optional(),
  config_version: z.number().int().min(1).optional(),
  is_enabled: z.boolean().optional(),
  schedule: z.string().min(1).max(50).optional(),
});

export const SourceIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateSourceInput = z.infer<typeof CreateSourceSchema>;
export type UpdateSourceInput = z.infer<typeof UpdateSourceSchema>;
