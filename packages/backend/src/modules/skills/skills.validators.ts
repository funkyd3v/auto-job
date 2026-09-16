import { z } from 'zod';

const SkillNameSchema = z
  .string()
  .min(1, 'skill_name is required')
  .max(100, 'skill_name max 100')
  .transform((v) => v.trim());

const RawAliasInput = z.union([
  z.string(),
  z.object({ alias: z.string() }),
]);

const AliasSchema = RawAliasInput.transform((v) => (typeof v === 'string' ? v : v.alias))
  .pipe(
    z
      .string()
      .min(1, 'alias cannot be empty')
      .max(100, 'alias max 100')
      .transform((v) => v.trim())
      .refine((v) => v.length > 0, { message: 'alias cannot be empty' }),
  );

export const CreateSkillSchema = z.object({
  skill_name: SkillNameSchema,
  weight: z.number().int().min(1).max(100).default(1).optional(),
  skill_type: z.enum(['required', 'preferred', 'excluded']),
  aliases: z.array(AliasSchema).max(20).optional().default([]),
});

export const UpdateSkillSchema = z.object({
  skill_name: SkillNameSchema.optional(),
  weight: z.number().int().min(1).max(100).optional(),
  skill_type: z.enum(['required', 'preferred', 'excluded']).optional(),
  aliases: z.array(AliasSchema).max(20).optional(),
});

export const SkillIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateSkillInput = z.infer<typeof CreateSkillSchema>;
export type UpdateSkillInput = z.infer<typeof UpdateSkillSchema>;

// For live preview endpoint — validate ad-hoc skill list
export const PreviewSkillsSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(50000),
});

export const ListSkillsQuerySchema = z.object({
  skill_type: z.enum(['required', 'preferred', 'excluded']).optional(),
  search: z.string().max(100).optional(),
});
