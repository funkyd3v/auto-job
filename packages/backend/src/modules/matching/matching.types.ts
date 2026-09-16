// ─── Matching Types ─────────────────────────────────────────────────────────

export const MATCHING_VERSION = 'v1' as const;

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
  skillId: string;
  skillName: string;
  type: 'required' | 'preferred' | 'excluded';
  weight: number;
  matched: boolean;
  matchedInTitle: boolean;
  matchedInDescription: boolean;
  contribution: number;
  matchedAlias?: string;
}

export interface MatchResult {
  score: number; // 0-100 integer
  matchingVersion: typeof MATCHING_VERSION;
  matchedSkills: SkillMatchDetail[];
  requiredMissing: SkillMatchDetail[];
  excludedMatched: SkillMatchDetail[];
  meetsThreshold?: boolean;
  isDisqualified: boolean; // true if required missing or excluded hit
}

export interface MatchSettings {
  userId: string;
  minMatchPercentage: number;
  notifyOnMatch: boolean;
  updatedAt: Date;
}

export interface IMatchingEngine {
  calculate(job: MatchInput, skills: NormalizedSkillForMatch[]): MatchResult;
}
