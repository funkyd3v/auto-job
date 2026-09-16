import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { JobRepository } from './jobs.repository.js';
import { JobNormalizer, JobDeduplicationService, JobIngestionService } from './jobs.service.js';

const prisma = new PrismaClient();

describe('JobIngestion Integration', () => {
  let userId: string;
  let sourceId: string;
  let service: JobIngestionService;

  beforeAll(async () => {
    await prisma.$connect();

    const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$2b$12$dummyhashdummyhashdummyhashdummyha',
        matchSettings: { create: {} },
      },
    });
    userId = user.id;

    const source = await prisma.source.create({
      data: {
        userId,
        name: 'LinkedIn Test',
        sourceType: 'linkedin',
        baseUrl: 'https://linkedin.com',
        scraperConfig: {},
        scraperVersion: '1.0.0',
        schedule: '0 */6 * * *',
      },
    });
    sourceId = source.id;

    const jobRepo = new JobRepository(prisma);
    const normalizer = new JobNormalizer();
    const deduplicator = new JobDeduplicationService(jobRepo);
    service = new JobIngestionService({ prisma, jobRepository: jobRepo, normalizer, deduplicator });
  });

  afterAll(async () => {
    // Cleanup in reverse FK order
    await prisma.job.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.source.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('creates new job and deduplicates on fingerprint', async () => {
    const job = {
      title: 'Senior TypeScript Engineer',
      company: 'Acme',
      url: 'https://example.com/job/123?utm_source=email',
      description: 'We need TypeScript',
      external_job_id: null as string | null,
      location: 'Remote',
    };

    const result1 = await service.ingest(userId, { source_id: sourceId, jobs: [job] });
    expect(result1.created).toBe(1);
    expect(result1.duplicates).toBe(0);

    // Same job with canonical URL variation -> should be duplicate, not new
    const duplicate = {
      ...job,
      url: 'https://example.com/job/123?tracking_id=xyz',
      description: 'We need TypeScript',
    };
    const result2 = await service.ingest(userId, { source_id: sourceId, jobs: [duplicate] });
    expect(result2.created).toBe(0);
    expect(result2.duplicates).toBe(1);

    // Same fingerprint but updated description -> should be updated, not duplicate
    const updated = {
      ...job,
      url: 'https://example.com/job/123',
      description: 'We need TypeScript + Node.js — updated',
    };
    const result3 = await service.ingest(userId, { source_id: sourceId, jobs: [updated] });
    expect(result3.updated).toBe(1);

    // Verify DB has exactly one record
    const count = await prisma.job.count({ where: { userId, sourceId } });
    expect(count).toBe(1);
    const stored = await prisma.job.findFirst({ where: { userId, sourceId } });
    expect(stored?.description).toContain('Node.js');
  });

  it('deduplicates via external_job_id primary key', async () => {
    // Create second source for external ID test
    const source2 = await prisma.source.create({
      data: {
        userId,
        name: 'Indeed Test',
        sourceType: 'indeed',
        baseUrl: 'https://indeed.com',
        scraperConfig: {},
        scraperVersion: '1.0.0',
        schedule: '0 */6 * * *',
      },
    });

    const jobWithExtId = {
      external_job_id: 'ext-999',
      title: 'Backend Dev',
      company: 'Beta',
      url: 'https://indeed.com/viewjob?jk=ext-999',
      description: 'backend',
    };

    const r1 = await service.ingest(userId, { source_id: source2.id, jobs: [jobWithExtId] });
    expect(r1.created).toBe(1);

    // Same external ID, same source -> update, not duplicate create
    const r2 = await service.ingest(userId, {
      source_id: source2.id,
      jobs: [{ ...jobWithExtId, description: 'backend updated' }],
    });
    expect(r2.updated).toBe(1);

    // Same external ID but different source -> allowed (different source_id), should create new
    // Use original linkedin source with same external ID value but different source -> fingerprint differs due sourceType
    const r3 = await service.ingest(userId, {
      source_id: sourceId,
      jobs: [{ ...jobWithExtId, url: 'https://example.com/other?jk=ext-999' }],
    });
    // Fingerprint includes sourceType, so different sourceType => different fingerprint => new record
    expect(r3.created).toBe(1);

    await prisma.job.deleteMany({ where: { sourceId: source2.id } });
    await prisma.source.delete({ where: { id: source2.id } });
  });

  it('enforces UNIQUE constraints at DB level', async () => {
    const dupJob = {
      title: 'Unique Test',
      company: 'UniqueCo',
      url: 'https://example.com/unique?x=1',
      description: 'unique',
      external_job_id: 'uniq-ext-1',
    };
    const r1 = await service.ingest(userId, { source_id: sourceId, jobs: [dupJob] });
    expect(r1.created).toBe(1);

    // Try direct prisma create with same fingerprint -> should throw P2002
    const normalizer = new JobNormalizer();
    const normalized = normalizer.normalize(dupJob, sourceId, 'linkedin');
    await expect(
      prisma.job.create({
        data: {
          userId,
          sourceId,
          externalJobId: 'different-ext',
          jobFingerprint: normalized.jobFingerprint,
          title: 'Other',
          company: 'Other',
          url: 'https://example.com/other',
          description: 'other',
          scrapedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Try same (sourceId, externalJobId) -> should also throw
    await expect(
      prisma.job.create({
        data: {
          userId,
          sourceId,
          externalJobId: 'uniq-ext-1',
          jobFingerprint: 'a'.repeat(64),
          title: 'Other2',
          company: 'Other2',
          url: 'https://example.com/other2',
          description: 'other2',
          scrapedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('supports listing and status transition', async () => {
    const { jobs, total } = await service.list(userId, { page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' } as any);
    expect(total).toBeGreaterThan(0);
    expect(jobs.length).toBeGreaterThan(0);

    const first = jobs[0];
    const updated = await service.updateStatus(userId, first.id, { status: 'SAVED', note: 'test save' });
    expect(updated.status).toBe('SAVED');

    const history = await prisma.jobStatusHistory.findMany({ where: { jobId: first.id } });
    expect(history.length).toBeGreaterThan(0);
    expect(history.some((h) => h.toStatus === 'SAVED')).toBe(true);
  });
});
