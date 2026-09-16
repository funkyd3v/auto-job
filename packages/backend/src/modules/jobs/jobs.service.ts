import type { PrismaClient, Prisma, Job, Source, JobStatus, MatchSettings } from '@prisma/client';
import type { IJobRepository, JobListParams } from './jobs.repository.js';
import type { IngestRequest, NormalizedJob, IngestResult, IngestJobInput } from './jobs.types.js';
import { canonicalizeUrl } from '../../shared/utils/url.js';
import { sanitizeHtml, sanitizeText } from '../../shared/utils/sanitize.js';
import { generateJobFingerprint, normalizeForFingerprint } from '../../shared/utils/fingerprint.js';
import { NotFoundError, BadRequestError } from '../../shared/errors/index.js';
import { MatchingEngine } from '../matching/matching.engine.js';
import { MATCHING_VERSION } from '../matching/matching.types.js';
import type { NormalizedSkillForMatch } from '../matching/matching.types.js';
import type { NotificationService } from '../notifications/notifications.service.js';

// ─── Normalizer (SRP) ───────────────────────────────────────────────────────

/**
 * Normalizes a single ingested job. Pure, testable, no side-effects.
 * Implements sanitization, URL canonicalization, and fingerprint generation.
 */
export class JobNormalizer {
  normalize(raw: IngestJobInput, sourceId: string, sourceType: string): NormalizedJob {
    // 1. Sanitize & normalize text fields
    const title = sanitizeText(raw.title);
    const company = sanitizeText(raw.company);
    const location = raw.location ? sanitizeText(raw.location) : null;
    const salary = raw.salary ? sanitizeText(raw.salary) : null;

    // 2. URL canonicalization (for fingerprint) — keep original url for display
    const url = raw.url.trim();
    const canonicalUrl = canonicalizeUrl(url);

    // 3. Description sanitization — treat as untrusted HTML
    const description = sanitizeHtml(raw.description);

    // 4. External ID normalization
    const externalJobId = raw.external_job_id?.trim() ? raw.external_job_id.trim() : null;

    // 5. Scraped at
    const scrapedAt = raw.scraped_at ? new Date(raw.scraped_at) : new Date();
    if (Number.isNaN(scrapedAt.getTime())) {
      throw new BadRequestError(`Invalid scraped_at timestamp: ${raw.scraped_at}`);
    }

    // 6. Fingerprint components (lowercased, collapsed)
    const normalizedTitle = normalizeForFingerprint(title);
    const normalizedCompany = normalizeForFingerprint(company);

    const jobFingerprint = generateJobFingerprint({
      sourceType,
      canonicalUrl,
      normalizedTitle,
      normalizedCompany,
    });

    return {
      sourceId,
      sourceType,
      externalJobId,
      title,
      company,
      location,
      url,
      canonicalUrl,
      description,
      salary,
      scrapedAt,
      jobFingerprint,
      normalizedTitle,
      normalizedCompany,
    };
  }
}

// ─── Deduplication Service (SRP) ────────────────────────────────────────────

export class JobDeduplicationService {
  constructor(private readonly jobRepo: IJobRepository) {}

  /**
   * Find existing job via primary key (source_id, external_job_id) or fallback fingerprint.
   * Per DOMAIN.md: primary = (source_id, external_job_id), fallback = fingerprint.
   * Database enforces both UNIQUE constraints for race safety.
   */
  async findExisting(normalized: NormalizedJob): Promise<Job | null> {
    // Primary: external ID path
    if (normalized.externalJobId) {
      const byExternal = await this.jobRepo.findBySourceAndExternalId(normalized.sourceId, normalized.externalJobId);
      if (byExternal) return byExternal;
    }
    // Fallback: fingerprint (also handles cross-source fingerprint uniqueness)
    const byFingerprint = await this.jobRepo.findByFingerprint(normalized.jobFingerprint);
    return byFingerprint;
  }
}

// ─── Main Ingestion Service (Orchestrator, DIP) ─────────────────────────────

export interface JobIngestionDependencies {
  prisma: PrismaClient;
  jobRepository: IJobRepository;
  normalizer: JobNormalizer;
  deduplicator: JobDeduplicationService;
  notificationService?: NotificationService;
  matchingEngine?: MatchingEngine;
}

export class JobIngestionService {
  constructor(private readonly deps: JobIngestionDependencies) {}

  /**
   * Ingest a batch of jobs for a user/source.
   * - Validates source ownership
   * - Normalizes each job
   * - Deduplicates (primary + fingerprint)
   * - Persists via atomic per-job transaction with unique-violation handling
   * - Returns metrics for scrape run / observability
   *
   * Phase 7+: Extension sends pre-matched jobs with match_score, matched_skills,
   * and matching_version. Backend trusts these values and stores them directly.
   * Backend does NOT recalculate matching — extension is the source of truth for scores.
   *
   * Idempotency is handled at controller layer; this service is idempotent via DB constraints
   * and update-in-place semantics (same logical job → one record).
   */
  async ingest(userId: string, request: IngestRequest): Promise<IngestResult> {
    const { source_id: sourceId, jobs: rawJobs } = request;

    // Validate source exists and belongs to user
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

    // Jobs that qualify for a "new match" notification — resolved at the end
    // through the NotificationService (policy + DB-level dedup UNIQUE(job_id, channel, type)).
    const jobsForNotification: { jobId: string; score: number }[] = [];

    // Phase 7+: Matching moved to extension.
    // If extension sends pre-matched data, use it directly (trust the score).
    // Fallback: if no match_score sent (legacy extension), calculate server-side.
    const hasPreMatchedData = rawJobs.some((j) => j.match_score !== undefined && j.match_score !== null);
    let matchingEngine: MatchingEngine | null = null;
    let normalizedSkills: NormalizedSkillForMatch[] | null = null;

    if (!hasPreMatchedData) {
      // Legacy fallback — extension didn't send match data, calculate server-side
      matchingEngine = this.deps.matchingEngine ?? new MatchingEngine();
      normalizedSkills = await this.loadNormalizedSkills(userId);
    }

    for (const raw of rawJobs) {
      const normalized = this.deps.normalizer.normalize(raw, source.id, source.sourceType);

      // Use pre-matched data from extension OR calculate server-side
      let matchScore: number | null;
      let matchingVersion: string | null;
      let matchedSkillsPayload: unknown;

      if (raw.match_score !== undefined && raw.match_score !== null) {
        // Extension sent pre-matched data — trust it
        matchScore = raw.match_score;
        matchingVersion = raw.matching_version ?? MATCHING_VERSION;
        matchedSkillsPayload = raw.matched_skills ?? [];
      } else {
        // Legacy fallback — calculate server-side
        const matchResult = matchingEngine!.calculate({ title: normalized.title, description: normalized.description }, normalizedSkills!);
        matchScore = matchResult.score;
        matchingVersion = matchResult.matchingVersion;
        matchedSkillsPayload = matchResult.matchedSkills;
      }

      // Attempt deduplication
      let existing: Job | null = null;
      try {
        existing = await this.deps.deduplicator.findExisting(normalized);
      } catch (err) {
        // Fail open — treat as new if lookup fails; will be caught by unique constraint handling
        existing = null;
      }

      if (existing) {
        // Check if ownership matches (should, because fingerprint unique global — but enforce isolation)
        if (existing.userId !== userId) {
          // Fingerprint collision across users: per spec fingerprint is global UNIQUE.
          // We must not leak cross-user data. Treat as conflict and skip.
          // However spec says single-user system, so this is edge. We'll count as duplicate.
          result.duplicates += 1;
          result.jobs.push({ id: existing.id, fingerprint: existing.jobFingerprint, action: 'duplicate', match_score: existing.matchScore, matching_version: existing.matchingVersion });
          continue;
        }

        // Compare fields to decide update vs duplicate (including match_score drift)
        const needsUpdate = this.hasChanges(existing, normalized, matchScore);

        if (!needsUpdate) {
          result.duplicates += 1;
          result.jobs.push({ id: existing.id, fingerprint: existing.jobFingerprint, action: 'duplicate', match_score: existing.matchScore, matching_version: existing.matchingVersion });
          continue;
        }

        // Update existing job — recalc scrapedAt, keep createdAt, update fields + match score atomically
        try {
          const updated = await this.deps.prisma.$transaction(async (tx) => {
            const j = await tx.job.update({
              where: { id: existing!.id },
              data: {
                title: normalized.title,
                company: normalized.company,
                location: normalized.location,
                // Store canonical URL to avoid tracking param churn
                url: normalized.canonicalUrl,
                description: normalized.description,
                salary: normalized.salary,
                scrapedAt: normalized.scrapedAt,
                jobFingerprint: normalized.jobFingerprint,
                matchScore: matchScore,
                matchingVersion: matchingVersion,
                matchedSkills: matchedSkillsPayload as Prisma.InputJsonValue,
              },
            });
            return j;
          });
          result.updated += 1;
          result.jobs.push({ id: updated.id, fingerprint: updated.jobFingerprint, action: 'updated', match_score: updated.matchScore, matching_version: updated.matchingVersion });

          if (matchScore !== null) {
            jobsForNotification.push({ jobId: updated.id, score: matchScore });
          }
        } catch (err: unknown) {
          // Handle unique violation on fingerprint update (race or collision)
          if (this.isUniqueViolation(err)) {
            // Fingerprint collision — treat as duplicate
            result.duplicates += 1;
            result.jobs.push({ id: existing.id, fingerprint: existing.jobFingerprint, action: 'duplicate' });
          } else {
            throw err;
          }
        }
      } else {
        // Create new job — handle concurrent unique violation via catch
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
                matchScore: matchScore,
                matchingVersion: matchingVersion,
                matchedSkills: matchedSkillsPayload as Prisma.InputJsonValue,
              },
            });

            // Initialize status history (NEW -> NEW for audit trail of creation)
            await tx.jobStatusHistory.create({
              data: {
                jobId: job.id,
                fromStatus: 'NEW',
                toStatus: 'NEW',
                note: 'Job discovered',
              },
            });

            // In phase 5+, we would also create notification + outbox in same transaction.
            // Outbox pattern placeholder: job and event committed atomically (ARCHITECTURE.md)

            return job;
          });

          result.created += 1;
          result.jobs.push({ id: created.id, fingerprint: created.jobFingerprint, action: 'created', match_score: created.matchScore, matching_version: created.matchingVersion });

          if (matchScore !== null) {
            jobsForNotification.push({ jobId: created.id, score: matchScore });
          }
        } catch (err: unknown) {
          if (this.isUniqueViolation(err)) {
            // Lost race — another request created same job concurrently. Fetch and treat as duplicate/update
            const raced = await this.deps.deduplicator.findExisting(normalized);
            if (raced) {
              result.duplicates += 1;
              result.jobs.push({ id: raced.id, fingerprint: raced.jobFingerprint, action: 'duplicate', match_score: raced.matchScore, matching_version: raced.matchingVersion });
            } else {
              // Should not happen — rethrow
              throw err;
            }
          } else {
            throw err;
          }
        }
      }
    }

    // Create notifications + outbox events for eligible new matches.
    // NotificationService handles policy checks (notifyOnMatch, threshold) and
    // DB-level deduplication via UNIQUE(job_id, channel, notification_type).
    if (this.deps.notificationService && jobsForNotification.length > 0) {
      try {
        await this.deps.notificationService.processJobsForNotifications(userId, jobsForNotification);
      } catch (error) {
        console.error('[JobIngestionService] Failed to create notifications:', error);
      }
    }

    return result;
  }

  async list(userId: string, query: JobListParams): Promise<{ jobs: Job[]; total: number; page: number; limit: number }> {
    const { jobs, total } = await this.deps.jobRepository.list(userId, query);
    return { jobs, total, page: query.page, limit: query.limit };
  }

  async getById(userId: string, jobId: string): Promise<Job> {
    const job = await this.deps.jobRepository.findById(jobId, userId);
    if (!job) throw new NotFoundError('Job');
    return job;
  }

  /** Delete a job scoped to the owning user. Notification + status-history rows cascade. */
  async deleteById(userId: string, jobId: string): Promise<void> {
    const job = await this.deps.jobRepository.findById(jobId, userId);
    if (!job) throw new NotFoundError('Job');

    await this.deps.prisma.job.delete({ where: { id: jobId } });

    await this.deps.prisma.auditLog
      .create({
        data: {
          userId,
          action: 'job_deleted',
          resourceType: 'job',
          resourceId: jobId,
          details: { title: job.title, company: job.company },
        },
      })
      .catch(() => {}); // non-critical
  }

  async updateStatus(userId: string, jobId: string, input: { status: JobStatus; note?: string }): Promise<Job> {
    const job = await this.deps.jobRepository.findById(jobId, userId);
    if (!job) throw new NotFoundError('Job');

    if (job.status === input.status) {
      return job;
    }

    // Record status change atomically
    const updated = await this.deps.jobRepository.updateStatusWithHistory({
      jobId,
      fromStatus: job.status,
      toStatus: input.status,
      note: input.note,
    });

    // Audit log for pipeline movement
    await this.deps.prisma.auditLog
      .create({
        data: {
          userId,
          action: 'job_status_changed',
          resourceType: 'job',
          resourceId: jobId,
          details: { from: job.status, to: input.status, note: input.note },
        },
      })
      .catch(() => {}); // non-critical

    return updated;
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

  private hasChanges(existing: Job, normalized: NormalizedJob, newScore?: number | null): boolean {
    // Compare canonical URLs to avoid churn on tracking params
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
    // If match score changed (skills updated or extension recalculated), we need to persist new score
    if (newScore !== undefined && (existing.matchScore ?? null) !== newScore) return true;
    if (newScore !== undefined && (existing.matchingVersion ?? null) !== MATCHING_VERSION) return true;
    return false;
  }

  private isUniqueViolation(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002');
  }
}
