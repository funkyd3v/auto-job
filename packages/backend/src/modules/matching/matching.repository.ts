import type { PrismaClient } from '@prisma/client';
import type { NormalizedSkillForMatch } from './matching.types.js';

// ─── Interfaces (DIP/ISP) ──────────────────────────────────────────────────

export interface ISkillLoader {
  loadNormalizedSkills(userId: string): Promise<NormalizedSkillForMatch[]>;
}

export interface IMatchSettingsRepo {
  get(userId: string): Promise<{ userId: string; minMatchPercentage: number; notifyOnMatch: boolean } | null>;
  upsert(userId: string, data: { minMatchPercentage?: number; notifyOnMatch?: boolean }): Promise<{ userId: string; minMatchPercentage: number; notifyOnMatch: boolean; updatedAt: Date }>;
}

// ─── Implementations ────────────────────────────────────────────────────────

export class PrismaSkillLoader implements ISkillLoader {
  constructor(private readonly prisma: PrismaClient) {}

  async loadNormalizedSkills(userId: string): Promise<NormalizedSkillForMatch[]> {
    const skills = await this.prisma.skill.findMany({
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
}

export class MatchSettingsRepo implements IMatchSettingsRepo {
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
