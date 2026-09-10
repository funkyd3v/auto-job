// ─── Matching Types (Extension) ──────────────────────────────────────────────
// Mirrors backend matching.types.ts. Version must stay in sync.

export const MATCHING_VERSION = 'ext-v1' as const;

export interface NormalizedSkillForMatch {
  id: string;
  normalizedName: string;
  weight: number;
  type: 'required' | 'preferred' | 'excluded';
  normalizedAliases: string[];
}

export interface MatchInput {
  title: string;
  description: string;
}

export interface SkillMatchDetail {
  skill_id: string;
  skill_name: string;
  type: 'required' | 'preferred' | 'excluded';
  weight: number;
  matched: boolean;
  matched_in_title: boolean;
  matched_in_description: boolean;
  contribution: number;
  matched_alias?: string;
}

export interface MatchResult {
  score: number; // 0-100 integer
  matchingVersion: typeof MATCHING_VERSION;
  matchedSkills: SkillMatchDetail[];
  requiredMissing: SkillMatchDetail[];
  excludedMatched: SkillMatchDetail[];
  isDisqualified: boolean;
}

export interface MatchSettings {
  min_match_percentage: number;
  notify_on_match: boolean;
}

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

export interface MatchedSkillForPayload {
  skill_id: string;
  skill_name: string;
  type: 'required' | 'preferred' | 'excluded';
  weight: number;
  matched: boolean;
  matched_in_title: boolean;
  contribution: number;
}
