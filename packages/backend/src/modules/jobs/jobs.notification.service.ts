import type { PrismaClient, Job, JobStatus } from '@prisma/client';
import type { IJobRepository, JobListParams } from './jobs.repository.js';
import type { IngestRequest, NormalizedJob, IngestResult, IngestJobInput } from './jobs.types.js';
import { canonicalizeUrl } from '../../shared/utils/url.js';
import { sanitizeHtml, sanitizeText } from '../../shared/utils/sanitize.js';
import { generateJobFingerprint, normalizeForFingerprint } from '../../shared/utils/fingerprint.js';
import { NotFoundError, BadRequestError } from '../../shared/errors/index.js';
import { MatchingEngine } from '../matching/matching.engine.js';
import { MATCHING_VERSION } from '../matching/matching.types.js';
import type { NormalizedSkillForMatch } from '../matching/matching.types.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { JobNormalizer, JobDeduplicationService } from './jobs.service.js';

export interface JobIngestionWithNotificationDependencies {
  prisma: PrismaClient;
  jobRepository: IJobRepository;
  normalizer: JobNormalizer;
  deduplicator: JobDeduplicationService;
  notificationService: NotificationService;
  matchingEngine?: MatchingEngine;
}

export class JobIngestionWithNotificationService {
  constructor(private readonly deps: JobIngestionWithNotificationDependencies) {}

  async ingestWithNotification(userId: string, request: IngestRequest): Promise<IngestResult & { notificationsCreated: number }> {
    const { source_id: sourceId, jobs: rawJobs } = request;

    const source = await this.deps.prisma.source.findFirst({
      where: { id: sourceId, userId },
    });
    if (!source) {
      throw new NotFoundError('Source');
    }

    const result: IngestResult = {
      total: rawJobs.length,
      created: 0,
      updated: 0,
      duplicates: 0,
      jobs: [],
    };

    const matchingEngine = this.deps.matchingEngine ?? new MatchingEngine();
    const normalizedSkills = await this.loadNormalizedSkills(userId);

    const jobsForNotification: { jobId: string; score: number }[] = [];

    for (const raw of rawJobs) {
      const normalized = this.deps.normalizer.normalize(raw, source.id, source.sourceType);
      const matchResult = matchingEngine.calculate({ title: normalized.title, description: normalized.description }, normalizedSkills);

      let existing: Job | null = null;
      try {
        existing = await this.deps.deduplicator.findExisting(normalized);
      } catch {
        existing = null;
      }

      if (existing) {
        if (existing.userId !== userId) {
          result.duplicates += 1;
          result.jobs.push({ id: existing.id, fingerprint: existing.jobFingerprint, action: 'duplicate', match_score: existing.matchScore, matching_version: existing.matchingVersion });
          continue;
        }

        const needsUpdate = this.hasChanges(existing, normalized, matchResult.score);

        if (!needsUpdate) {
          result.duplicates += 1;
          result.jobs.push({ id: existing.id, fingerprint: existing.jobFingerprint, action: 'duplicate', match_score: existing.matchScore, matching_version: existing.matchingVersion });
          continue;
        }

        try {
          const updated = await this.deps.prisma.$transaction(async (tx) => {
            const j = await tx.job.update({
              where: { id: existing!.id },
              data: {
                title: normalized.title,
                company: normalized.company,
                location: normalized.location,
                url: normalized.canonicalUrl,
                description: normalized.description,
                salary: normalized.salary,
                scrapedAt: normalized.scrapedAt,
                jobFingerprint: normalized.jobFingerprint,
                matchScore: matchResult.score,
                matchingVersion: matchResult.matchingVersion,
              },
            });
            return j;
          });

          result.updated += 1;
          result.jobs.push({ id: updated.id, fingerprint: updated.jobFingerprint, action: 'updated', match_score: updated.matchScore, matching_version: updated.matchingVersion });

          const settings = await this.deps.prisma.matchSettings.findUnique({ where: { userId } });
          if (settings?.notifyOnMatch && matchResult.score >= settings.minMatchPercentage) {
            const alreadyNotified = await this.deps.prisma.notification.findFirst({
              where: {
                jobId: updated.id,
                channel: 'telegram',
                notificationType: 'new_match',
              },
            });
            if (!alreadyNotified) {
              jobsForNotification.push({ jobId: updated.id, score: matchResult.score });
            }
          }
        } catch (err: unknown) {
          if (this.isUniqueViolation(err)) {
            result.duplicates += 1;
            result.jobs.push({ id: existing.id, fingerprint: existing.jobFingerprint, action: 'duplicate' });
          } else {
            throw err;
          }
        }
      } else {
        try {
          const created = await this.deps.prisma.$transaction(async (tx) => {
            const job = await tx.job.create({
              data: {
                userId,
                sourceId: normalized.sourceId,
                externalJobId: normalized.externalJobId,
                jobFingerprint: normalized.jobFingerprint,
                title: normalized.title,
                company: normalized.company,
                location: normalized.location,
                url: normalized.canonicalUrl,
                description: normalized.description,
                salary: normalized.salary,
                scrapedAt: normalized.scrapedAt,
                status: 'NEW',
                matchScore: matchResult.score,
                matchingVersion: matchResult.matchingVersion,
              },
            });

            await tx.jobStatusHistory.create({
              data: {
                jobId: job.id,
                fromStatus: 'NEW',
                toStatus: 'NEW',
                note: 'Job discovered',
              },
            });

            return job;
          });

          result.created += 1;
          result.jobs.push({ id: created.id, fingerprint: created.jobFingerprint, action: 'created', match_score: created.matchScore, matching_version: created.matchingVersion });

          const settings = await this.deps.prisma.matchSettings.findUnique({ where: { userId } });
          if (settings?.notifyOnMatch && matchResult.score >= settings.minMatchPercentage) {
            const alreadyNotified = await this.deps.prisma.notification.findFirst({
              where: {
                jobId: created.id,
                channel: 'telegram',
                notificationType: 'new_match',
              },
            });
            if (!alreadyNotified) {
              jobsForNotification.push({ jobId: created.id, score: matchResult.score });
            }
          }
        } catch (err: unknown) {
          if (this.isUniqueViolation(err)) {
            const raced = await this.deps.deduplicator.findExisting(normalized);
            if (raced) {
              result.duplicates += 1;
              result.jobs.push({ id: raced.id, fingerprint: raced.jobFingerprint, action: 'duplicate', match_score: raced.matchScore, matching_version: raced.matchingVersion });
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        }
      }
    }

    let notificationsCreated = 0;
    if (jobsForNotification.length > 0) {
      notificationsCreated = await this.deps.notificationService.processJobsForNotifications(
        userId,
        jobsForNotification
      );
    }

    return { ...result, notificationsCreated };
  }

  private async loadNormalizedSkills(userId: string): Promise<NormalizedSkillForMatch[]> {
    const skills = await this.deps.prisma.skill.findMany({
      where: { userId },
      include: { aliases: true },
      orderBy: { createdAt: 'asc' },
    });
    return skills.map((s) => ({
      id: s.id,
      normalizedName: s.normalizedName,
      weight: s.weight,
      type: s.skillType as NormalizedSkillForMatch['type'],
      normalizedAliases: s.aliases.map((a) => a.normalizedAlias),
    }));
  }

  private hasChanges(existing: Job, normalized: NormalizedJob, newScore?: number): boolean {
    const existingCanonical = canonicalizeUrl(existing.url);
    const incomingCanonical = normalized.canonicalUrl;
    if (
      existing.title !== normalized.title ||
      existing.company !== normalized.company ||
      (existing.location ?? null) !== (normalized.location ?? null) ||
      existingCanonical !== incomingCanonical ||
      existing.description !== normalized.description ||
      (existing.salary ?? null) !== (normalized.salary ?? null)
    ) {
      return true;
    }
    if (newScore !== undefined && (existing.matchScore ?? null) !== newScore) return true;
    if (newScore !== undefined && (existing.matchingVersion ?? null) !== MATCHING_VERSION) return true;
    return false;
  }

  private isUniqueViolation(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002');
  }
}
