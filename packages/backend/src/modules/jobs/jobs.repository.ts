import type { PrismaClient, Job, Prisma, JobStatus } from '@prisma/client';
import { AppError } from '../../shared/errors/index.js';

// ─── Interfaces (DIP) ───────────────────────────────────────────────────────

export interface IJobRepository {
  findBySourceAndExternalId(sourceId: string, externalJobId: string): Promise<Job | null>;
  findByFingerprint(fingerprint: string): Promise<Job | null>;
  findById(id: string, userId: string): Promise<Job | null>;
  create(data: Prisma.JobCreateInput): Promise<Job>;
  createMany(data: Prisma.JobCreateInput[]): Promise<number>;
  update(id: string, data: Prisma.JobUpdateInput): Promise<Job>;
  list(userId: string, params: JobListParams): Promise<{ jobs: Job[]; total: number }>;
  updateStatusWithHistory(params: {
    jobId: string;
    fromStatus: JobStatus;
    toStatus: JobStatus;
    note?: string;
  }): Promise<Job>;
}

export interface JobListParams {
  page: number;
  limit: number;
  status?: JobStatus;
  sourceId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface IIdempotencyRepository {
  findByKey(key: string, userId: string, scope: string): Promise<{ response: unknown; statusCode: number | null; expiresAt: Date } | null>;
  createPlaceholder(key: string, userId: string, scope: string, expiresAt: Date): Promise<void>;
  saveResponse(key: string, userId: string, scope: string, response: unknown, statusCode: number): Promise<void>;
  cleanupExpired(): Promise<void>;
}

// ─── Implementations ────────────────────────────────────────────────────────

export class JobRepository implements IJobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySourceAndExternalId(sourceId: string, externalJobId: string): Promise<Job | null> {
    return this.prisma.job.findFirst({
      where: { sourceId, externalJobId },
    });
  }

  async findByFingerprint(fingerprint: string): Promise<Job | null> {
    return this.prisma.job.findUnique({
      where: { jobFingerprint: fingerprint },
    });
  }

  async findById(id: string, userId: string): Promise<Job | null> {
    return this.prisma.job.findFirst({
      where: { id, userId },
    });
  }

  async create(data: Prisma.JobCreateInput): Promise<Job> {
    return this.prisma.job.create({ data });
  }

  async createMany(data: Prisma.JobCreateInput[]): Promise<number> {
    // Use createMany with skipDuplicates for bulk; Prisma expects JobCreateManyInput
    const result = await this.prisma.job.createMany({
      data: data as unknown as Prisma.JobCreateManyInput[],
      skipDuplicates: true,
    });
    return result.count;
  }

  async update(id: string, data: Prisma.JobUpdateInput): Promise<Job> {
    return this.prisma.job.update({ where: { id }, data });
  }

  async list(userId: string, params: JobListParams): Promise<{ jobs: Job[]; total: number }> {
    const where: Prisma.JobWhereInput = { userId };
    if (params.status) where.status = params.status;
    if (params.sourceId) where.sourceId = params.sourceId;
    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { company: { contains: params.search, mode: 'insensitive' } },
        { description: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.JobOrderByWithRelationInput = {};
    const sortField =
      params.sortBy === 'match_score'
        ? 'matchScore'
        : params.sortBy === 'scraped_at'
          ? 'scrapedAt'
          : 'createdAt';
    orderBy[sortField as keyof Prisma.JobOrderByWithRelationInput] = params.sortOrder ?? 'desc';

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.job.count({ where }),
    ]);

    return { jobs, total };
  }

  async updateStatusWithHistory(params: {
    jobId: string;
    fromStatus: JobStatus;
    toStatus: JobStatus;
    note?: string;
  }): Promise<Job> {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.update({
        where: { id: params.jobId },
        data: { status: params.toStatus },
      });

      await tx.jobStatusHistory.create({
        data: {
          jobId: params.jobId,
          fromStatus: params.fromStatus,
          toStatus: params.toStatus,
          note: params.note,
        },
      });

      return job;
    });
  }
}

export class IdempotencyRepository implements IIdempotencyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByKey(key: string, userId: string, scope: string) {
    // Prisma model IdempotencyKey has unique on key only; we verify userId+scope for isolation
    const record = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });

    if (!record) return null;
    // Verify ownership/scope and expiry
    if (record.userId !== userId || record.scope !== scope) return null;
    if (record.expiresAt < new Date()) {
      // Expired — delete lazily
      await this.prisma.idempotencyKey.delete({ where: { key } }).catch(() => {});
      return null;
    }
    if (record.response === null) {
      // Still processing — treat as not yet cached (caller may decide to conflict)
      return { response: null, statusCode: null, expiresAt: record.expiresAt };
    }
    return {
      response: record.response,
      statusCode: record.statusCode,
      expiresAt: record.expiresAt,
    };
  }

  async createPlaceholder(key: string, userId: string, scope: string, expiresAt: Date): Promise<void> {
    try {
      await this.prisma.idempotencyKey.create({
        data: { key, userId, scope, expiresAt },
      });
    } catch (err: unknown) {
      // Unique violation means concurrent creation — ignore, caller will fetch existing
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        return;
      }
      throw err;
    }
  }

  async saveResponse(key: string, userId: string, scope: string, response: unknown, statusCode: number): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { key },
      data: { response: response as Prisma.InputJsonValue, statusCode },
    });
  }

  async cleanupExpired(): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}
