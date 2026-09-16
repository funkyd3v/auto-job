import type { PrismaClient, Skill, SkillAlias, Prisma } from '@prisma/client';
import type { SkillType } from '@prisma/client';

// ─── Interfaces — ISP + DIP ─────────────────────────────────────────────────

export interface ISkillsRepository {
  findByUserId(userId: string, filters?: { skillType?: SkillType; search?: string }): Promise<(Skill & { aliases: SkillAlias[] })[]>;
  findById(id: string, userId: string): Promise<(Skill & { aliases: SkillAlias[] }) | null>;
  findByNormalizedName(normalizedName: string, userId: string): Promise<Skill | null>;
  create(data: { userId: string; skillName: string; normalizedName: string; weight: number; skillType: SkillType; aliases: string[] }): Promise<Skill & { aliases: SkillAlias[] }>;
  update(id: string, userId: string, data: Partial<{ skillName: string; normalizedName: string; weight: number; skillType: SkillType; aliases: string[] }>): Promise<Skill & { aliases: SkillAlias[] }>;
  delete(id: string, userId: string): Promise<void>;
}

export interface IMatchSettingsRepository {
  get(userId: string): Promise<{ userId: string; minMatchPercentage: number; notifyOnMatch: boolean; updatedAt: Date } | null>;
  upsert(userId: string, data: { minMatchPercentage?: number; notifyOnMatch?: boolean }): Promise<{ userId: string; minMatchPercentage: number; notifyOnMatch: boolean; updatedAt: Date }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeName(input: string): string {
  return input.trim().toLowerCase();
}

// ─── Implementations ────────────────────────────────────────────────────────

export class SkillsRepository implements ISkillsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserId(userId: string, filters?: { skillType?: SkillType; search?: string }) {
    const where: Prisma.SkillWhereInput = { userId };
    if (filters?.skillType) where.skillType = filters.skillType;
    if (filters?.search) {
      const search = filters.search.trim();
      where.OR = [
        { skillName: { contains: search, mode: 'insensitive' } },
        { normalizedName: { contains: search.toLowerCase(), mode: 'insensitive' } },
        { aliases: { some: { alias: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    return this.prisma.skill.findMany({
      where,
      include: { aliases: true },
      orderBy: [{ weight: 'desc' }, { skillName: 'asc' }],
    });
  }

  async findById(id: string, userId: string) {
    return this.prisma.skill.findFirst({
      where: { id, userId },
      include: { aliases: true },
    });
  }

  async findByNormalizedName(normalizedName: string, userId: string) {
    return this.prisma.skill.findFirst({
      where: { userId, normalizedName },
    });
  }

  async create(data: { userId: string; skillName: string; normalizedName: string; weight: number; skillType: SkillType; aliases: string[] }) {
    const normalizedAliases = data.aliases.map((a) => ({ alias: a.trim(), normalizedAlias: normalizeName(a) }));
    // Deduplicate aliases case-insensitively
    const deduped = new Map<string, { alias: string; normalizedAlias: string }>();
    for (const a of normalizedAliases) {
      if (!deduped.has(a.normalizedAlias) && a.normalizedAlias !== data.normalizedName) {
        deduped.set(a.normalizedAlias, a);
      }
    }
    const aliasesArray = Array.from(deduped.values());

    return this.prisma.skill.create({
      data: {
        userId: data.userId,
        skillName: data.skillName,
        normalizedName: data.normalizedName,
        weight: data.weight,
        skillType: data.skillType,
        aliases: {
          create: aliasesArray.map((a) => ({ alias: a.alias, normalizedAlias: a.normalizedAlias })),
        },
      },
      include: { aliases: true },
    });
  }

  async update(id: string, userId: string, data: Partial<{ skillName: string; normalizedName: string; weight: number; skillType: SkillType; aliases: string[] }>) {
    return this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.SkillUpdateInput = {};
      if (data.skillName !== undefined) updateData.skillName = data.skillName;
      if (data.normalizedName !== undefined) updateData.normalizedName = data.normalizedName;
      if (data.weight !== undefined) updateData.weight = data.weight;
      if (data.skillType !== undefined) updateData.skillType = data.skillType;

      const skill = await tx.skill.update({
        where: { id },
        data: updateData,
      });

      if (data.aliases !== undefined) {
        // Replace aliases atomically
        await tx.skillAlias.deleteMany({ where: { skillId: id } });
        const normalizedAliases = data.aliases.map((a) => ({ alias: a.trim(), normalizedAlias: normalizeName(a) }));
        const deduped = new Map<string, { alias: string; normalizedAlias: string }>();
        const currentNormalized = (data.normalizedName ?? skill.normalizedName).toLowerCase();
        for (const a of normalizedAliases) {
          if (!deduped.has(a.normalizedAlias) && a.normalizedAlias !== currentNormalized && a.normalizedAlias.length > 0) {
            deduped.set(a.normalizedAlias, a);
          }
        }
        if (deduped.size > 0) {
          await tx.skillAlias.createMany({
            data: Array.from(deduped.values()).map((a) => ({
              skillId: id,
              alias: a.alias,
              normalizedAlias: a.normalizedAlias,
            })),
          });
        }
      }

      return tx.skill.findFirstOrThrow({
        where: { id, userId },
        include: { aliases: true },
      });
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    // Ensure ownership via findFirst
    const existing = await this.prisma.skill.findFirst({ where: { id, userId } });
    if (!existing) throw new Error('Skill not found');
    await this.prisma.skill.delete({ where: { id } });
  }
}

export class MatchSettingsRepository implements IMatchSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(userId: string) {
    return this.prisma.matchSettings.findUnique({ where: { userId } });
  }

  async upsert(userId: string, data: { minMatchPercentage?: number; notifyOnMatch?: boolean }) {
    return this.prisma.matchSettings.upsert({
      where: { userId },
      create: {
        userId,
        minMatchPercentage: data.minMatchPercentage ?? 70,
        notifyOnMatch: data.notifyOnMatch ?? true,
      },
      update: {
        ...(data.minMatchPercentage !== undefined ? { minMatchPercentage: data.minMatchPercentage } : {}),
        ...(data.notifyOnMatch !== undefined ? { notifyOnMatch: data.notifyOnMatch } : {}),
      },
    });
  }
}
