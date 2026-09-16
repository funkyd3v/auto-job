import type { PrismaClient, Job } from '@prisma/client';
import { NotFoundError } from '../../shared/errors/index.js';
import type { ISkillLoader, IMatchSettingsRepo } from './matching.repository.js';
import { MatchingEngine } from './matching.engine.js';
import type { MatchResult } from './matching.types.js';
import { MATCHING_VERSION } from './matching.types.js';

// ─── Dependencies — DIP ─────────────────────────────────────────────────────

export interface MatchingServiceDeps {
  prisma: PrismaClient;
  skillLoader: ISkillLoader;
  matchSettingsRepo: IMatchSettingsRepo;
  engine: MatchingEngine;
}

// ─── Service — Orchestrates matching + persistence ─────────────────────────

export class MatchingService {
  constructor(private readonly deps: MatchingServiceDeps) {}

  /**
   * Calculate match score for a job without persisting.
   * Pure orchestration: loads skills, delegates to engine.
   */
  async calculateForJob(userId: string, job: { title: string; description: string }): Promise<MatchResult> {
    const skills = await this.deps.skillLoader.loadNormalizedSkills(userId);
    return this.deps.engine.calculate(job, skills);
  }

  /**
   * Calculate and persist match score for existing job.
   * Atomic update of match_score + matching_version.
   */
  async rematchJob(userId: string, jobId: string): Promise<{ job: Job; result: MatchResult }> {
    const job = await this.deps.prisma.job.findFirst({ where: { id: jobId, userId } });
    if (!job) throw new NotFoundError('Job');

    const skills = await this.deps.skillLoader.loadNormalizedSkills(userId);
    const result = this.deps.engine.calculate({ title: job.title, description: job.description }, skills);

    const updated = await this.deps.prisma.job.update({
      where: { id: jobId },
      data: {
        matchScore: result.score,
        matchingVersion: result.matchingVersion,
      },
    });

    // Audit log — non-critical
    await this.deps.prisma.auditLog
      .create({
        data: {
          userId,
          action: 'job_rematch',
          resourceType: 'job',
          resourceId: jobId,
          details: { score: result.score, matching_version: result.matchingVersion, matchedCount: result.matchedSkills.length },
        },
      })
      .catch(() => {});

    return { job: updated, result };
  }

  /**
   * Calculate match for a NormalizedJob during ingestion (in-memory, no extra fetch per job batch).
   * Caller provides pre-loaded skills to avoid N+1.
   */
  calculateForNormalized(normalized: { title: string; description: string }, skills: import('./matching.types.js').NormalizedSkillForMatch[]): MatchResult {
    return this.deps.engine.calculate(normalized, skills);
  }

  async getSettings(userId: string) {
    let settings = await this.deps.matchSettingsRepo.get(userId);
    if (!settings) {
      // Lazy create default (70, true) per SCHEMA.md
      settings = await this.deps.matchSettingsRepo.upsert(userId, {});
    }
    return settings;
  }

  async updateSettings(userId: string, data: { minMatchPercentage?: number; notifyOnMatch?: boolean }) {
    const updated = await this.deps.matchSettingsRepo.upsert(userId, data);

    await this.deps.prisma.auditLog
      .create({
        data: {
          userId,
          action: 'match_settings_updated',
          resourceType: 'match_settings',
          resourceId: userId,
          details: data as never,
        },
      })
      .catch(() => {});

    return updated;
  }

  /**
   * Checks notification eligibility per DOMAIN.md: score >= threshold && notify_on_match
   * Notification dedup is enforced at DB level via UNIQUE(job_id, channel, notification_type).
   */
  async isEligibleForNotification(userId: string, score: number): Promise<boolean> {
    const settings = await this.getSettings(userId);
    if (!settings.notifyOnMatch) return false;
    return score >= settings.minMatchPercentage;
  }
}
