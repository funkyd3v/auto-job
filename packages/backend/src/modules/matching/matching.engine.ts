import { stripHtml } from '../../shared/utils/sanitize.js';
import type { IMatchingEngine, MatchInput, MatchResult, NormalizedSkillForMatch, SkillMatchDetail } from './matching.types.js';
import { MATCHING_VERSION } from './matching.types.js';

/**
 * MatchingEngine — Pure, deterministic, testable.
 *
 * SOLID:
 *  - SRP: only scoring, no DB/IO
 *  - OCP: injectable title weighting, extensible via NormalizedSkillForMatch types
 *  - DIP: implements IMatchingEngine abstraction
 *
 * Formula per DOMAIN.md:
 *  match_score = (sum weights of matched skills / sum weights of all scoring skills) * 100
 *
 * Rules:
 *  - required: missing -> disqualified -> score 0
 *  - excluded: present -> disqualified -> score 0
 *  - preferred: contributes positively
 *  - Title weighting: title hit = full weight, description-only = weight * DESCRIPTION_FACTOR
 *  - Aliases: any normalized alias matches counts as hit
 */
export class MatchingEngine implements IMatchingEngine {
  // Title > Description — configurable, keep <1 for description-only partial credit
  static readonly DESCRIPTION_FACTOR = 0.7;
  static readonly VERSION = MATCHING_VERSION;

  private readonly descriptionFactor: number;

  constructor(options?: { descriptionFactor?: number }) {
    this.descriptionFactor = options?.descriptionFactor ?? MatchingEngine.DESCRIPTION_FACTOR;
  }

  calculate(job: MatchInput, skills: NormalizedSkillForMatch[]): MatchResult {
    const titleNorm = this.normalizeText(stripHtml(job.title ?? ''));
    const descNorm = this.normalizeText(stripHtml(job.description ?? ''));

    // Filter scoring vs excluded
    const scoringSkills = skills.filter((s) => s.type === 'required' || s.type === 'preferred');
    const excludedSkills = skills.filter((s) => s.type === 'excluded');

    const details: SkillMatchDetail[] = [];
    const requiredMissing: SkillMatchDetail[] = [];
    const excludedMatched: SkillMatchDetail[] = [];

    let totalWeight = 0;
    for (const s of scoringSkills) totalWeight += s.weight;

    // No scoring skills -> cannot score; if excluded present still disqualified, else 0
    if (totalWeight === 0) {
      for (const s of skills) {
        const hit = this.skillMatchesText(s, titleNorm, descNorm);
        const detail = this.buildDetail(s, hit);
        details.push(detail);
        if (s.type === 'excluded' && hit.matched) {
          excludedMatched.push(detail);
        }
      }
      const isDisqualified = excludedMatched.length > 0;
      return {
        score: 0,
        matchingVersion: MATCHING_VERSION,
        matchedSkills: details.filter((d) => d.matched && d.type !== 'excluded'),
        requiredMissing: [],
        excludedMatched,
        isDisqualified,
      };
    }

    let matchedWeight = 0;

    for (const s of skills) {
      const hit = this.skillMatchesText(s, titleNorm, descNorm);
      const detail = this.buildDetail(s, hit);
      details.push(detail);

      if (s.type === 'excluded') {
        if (hit.matched) excludedMatched.push(detail);
        continue;
      }

      if (s.type === 'required' && !hit.matched) {
        requiredMissing.push(detail);
      }

      if (hit.matched) {
        // Title weighting
        const contribution = hit.matchedInTitle ? s.weight : s.weight * this.descriptionFactor;
        detail.contribution = Math.round(contribution * 100) / 100; // keep decimals for precision, final score int
        matchedWeight += contribution;
      } else {
        detail.contribution = 0;
      }
    }

    // Disqualification checks — per DOMAIN.md
    const isDisqualified = requiredMissing.length > 0 || excludedMatched.length > 0;
    if (isDisqualified) {
      return {
        score: 0,
        matchingVersion: MATCHING_VERSION,
        matchedSkills: details.filter((d) => d.matched && d.type !== 'excluded'),
        requiredMissing,
        excludedMatched,
        isDisqualified: true,
      };
    }

    // Calculate 0-100, rounded to nearest int
    const raw = (matchedWeight / totalWeight) * 100;
    const score = Math.min(100, Math.max(0, Math.round(raw)));

    return {
      score,
      matchingVersion: MATCHING_VERSION,
      matchedSkills: details.filter((d) => d.matched && (d.type === 'required' || d.type === 'preferred')),
      requiredMissing,
      excludedMatched,
      isDisqualified: false,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildDetail(skill: NormalizedSkillForMatch, hit: { matched: boolean; matchedInTitle: boolean; matchedInDescription: boolean; matchedAlias?: string }): SkillMatchDetail {
    return {
      skillId: skill.id,
      skillName: skill.normalizedName,
      type: skill.type,
      weight: skill.weight,
      matched: hit.matched,
      matchedInTitle: hit.matchedInTitle,
      matchedInDescription: hit.matchedInDescription,
      contribution: 0,
      matchedAlias: hit.matchedAlias,
    };
  }

  private skillMatchesText(skill: NormalizedSkillForMatch, titleNorm: string, descNorm: string): { matched: boolean; matchedInTitle: boolean; matchedInDescription: boolean; matchedAlias?: string } {
    const candidates = [skill.normalizedName, ...skill.normalizedAliases].map((a) => a.toLowerCase().trim()).filter(Boolean);

    for (const cand of candidates) {
      const inTitle = this.containsSkill(titleNorm, cand);
      const inDesc = this.containsSkill(descNorm, cand);
      if (inTitle || inDesc) {
        return {
          matched: true,
          matchedInTitle: inTitle,
          matchedInDescription: inDesc,
          matchedAlias: cand === skill.normalizedName ? undefined : cand,
        };
      }
    }
    return { matched: false, matchedInTitle: false, matchedInDescription: false };
  }

  /**
   * Check if normalized text contains skill phrase.
   * Uses word-boundary aware matching to avoid "java" ⊂ "javascript" false positives.
   * Falls back to plain substring for symbols/non-word skills.
   */
  private containsSkill(text: string, skill: string): boolean {
    if (!text || !skill) return false;
    // Exact substring fast path (already lowercased)
    // For pure word phrase (letters/digits/spaces) use regex with boundaries
    const isWordPhrase = /^[a-z0-9\s\-_.]+$/i.test(skill);
    if (isWordPhrase) {
      // Escape for regex
      const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Use word boundaries: \b would not handle multi-word correctly at spaces, use lookarounds
      // e.g., skill "react" should not match "reactive"
      // We enforce: start or non-word before, end or non-word after
      // For phrase, split and ensure phrase not part of larger word
      try {
        const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
        return regex.test(text);
      } catch {
        return text.includes(skill);
      }
    }
    // For symbols like c++, c#, node.js -> plain substring (case-insensitive already)
    return text.includes(skill);
  }

  private normalizeText(input: string): string {
    return input.toLowerCase().replace(/\s+/g, ' ').trim();
  }
}
