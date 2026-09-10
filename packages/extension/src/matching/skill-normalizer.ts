import type { SkillFromApi, NormalizedSkillForMatch } from './types.js';

/**
 * SkillNormalizer — converts API skill data to matching engine format.
 * Handles normalization and alias extraction.
 */
export class SkillNormalizer {
  normalize(skills: SkillFromApi[]): NormalizedSkillForMatch[] {
    return skills.map((s) => ({
      id: s.id,
      normalizedName: s.normalized_name.toLowerCase().trim(),
      weight: s.weight,
      type: s.skill_type,
      normalizedAliases: s.aliases.map((a) => a.normalized_alias.toLowerCase().trim()).filter(Boolean),
    }));
  }
}
