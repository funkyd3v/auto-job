// ─── Skills Types (Domain) ──────────────────────────────────────────────────

import type { SkillType } from '@prisma/client';

export interface SkillDto {
  id: string;
  userId: string;
  skillName: string;
  normalizedName: string;
  weight: number;
  skillType: SkillType;
  createdAt: Date;
  updatedAt: Date;
  aliases: SkillAliasDto[];
}

export interface SkillAliasDto {
  id: string;
  skillId: string;
  alias: string;
  normalizedAlias: string;
  createdAt: Date;
}

export interface CreateSkillInput {
  skill_name: string;
  weight?: number;
  skill_type: SkillType;
  aliases?: string[];
}

export interface UpdateSkillInput {
  skill_name?: string;
  weight?: number;
  skill_type?: SkillType;
  aliases?: string[];
}

export interface SkillWithAliases {
  id: string;
  userId: string;
  skillName: string;
  normalizedName: string;
  weight: number;
  skillType: SkillType;
  aliases: Array<{ alias: string; normalizedAlias: string }>;
}

/**
 * Normalized skill used by MatchingEngine.
 * SRP: decouples engine from Prisma model.
 */
export interface NormalizedSkill {
  id: string;
  name: string;
  normalizedName: string;
  weight: number;
  type: SkillType;
  normalizedAliases: string[];
}
