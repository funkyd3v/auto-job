import type { PrismaClient, Source } from '@prisma/client';
import { NotFoundError } from '../../shared/errors/index.js';
import type { CreateSourceInput, UpdateSourceInput } from './sources.validators.js';

export class SourcesService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(userId: string): Promise<Source[]> {
    return this.prisma.source.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, input: CreateSourceInput): Promise<Source> {
    const source = await this.prisma.source.create({
      data: {
        userId,
        name: input.name,
        sourceType: input.source_type,
        baseUrl: input.base_url,
        scraperConfig: (input.scraper_config ?? {}) as never,
        scraperVersion: input.scraper_version,
        configVersion: input.config_version ?? 1,
        isEnabled: input.is_enabled ?? true,
        schedule: input.schedule,
      },
    });

    await this.prisma.auditLog.create({
      data: { userId, action: 'source_created', resourceType: 'source', resourceId: source.id, details: { name: input.name, source_type: input.source_type } },
    }).catch(() => {});

    return source;
  }

  async update(userId: string, sourceId: string, input: UpdateSourceInput): Promise<Source> {
    const existing = await this.prisma.source.findFirst({ where: { id: sourceId, userId } });
    if (!existing) throw new NotFoundError('Source');

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.base_url !== undefined) data.baseUrl = input.base_url;
    if (input.scraper_config !== undefined) data.scraperConfig = input.scraper_config;
    if (input.scraper_version !== undefined) data.scraperVersion = input.scraper_version;
    if (input.config_version !== undefined) data.configVersion = input.config_version;
    else if (input.scraper_config !== undefined || input.schedule !== undefined) {
      // Auto-bump config_version on config/schedule change
      data.configVersion = existing.configVersion + 1;
    }
    if (input.is_enabled !== undefined) data.isEnabled = input.is_enabled;
    if (input.schedule !== undefined) data.schedule = input.schedule;

    const updated = await this.prisma.source.update({ where: { id: sourceId }, data: data as never });

    await this.prisma.auditLog.create({
      data: { userId, action: 'source_updated', resourceType: 'source', resourceId: sourceId, details: input as never },
    }).catch(() => {});

    return updated;
  }

  async remove(userId: string, sourceId: string): Promise<void> {
    const existing = await this.prisma.source.findFirst({ where: { id: sourceId, userId } });
    if (!existing) throw new NotFoundError('Source');
    await this.prisma.source.delete({ where: { id: sourceId } });
    await this.prisma.auditLog.create({
      data: { userId, action: 'source_deleted', resourceType: 'source', resourceId: sourceId },
    }).catch(() => {});
  }
}
