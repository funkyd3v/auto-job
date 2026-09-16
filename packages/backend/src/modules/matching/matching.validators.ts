import { z } from 'zod';

export const UpdateMatchSettingsSchema = z.object({
  min_match_percentage: z.number().int().min(0).max(100).optional(),
  notify_on_match: z.boolean().optional(),
}).refine((data) => data.min_match_percentage !== undefined || data.notify_on_match !== undefined, {
  message: 'At least one of min_match_percentage or notify_on_match must be provided',
});

export const JobIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const PreviewMatchSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(50000),
});

export type UpdateMatchSettingsInput = z.infer<typeof UpdateMatchSettingsSchema>;
