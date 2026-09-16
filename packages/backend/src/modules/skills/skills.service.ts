import type { SkillType } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../shared/errors/index.js';
import type { ISkillsRepository } from './skills.repository.js';
import type { CreateSkillInput, UpdateSkillInput } from './skills.validators.js';

// ─── Service — SRP, DIP ─────────────────────────────────────────────────────

export interface SkillsServiceDependencies {
  skillsRepository: ISkillsRepository;
  prisma: import('@prisma/client').PrismaClient;
}

function normalizeName(input: string): string {
  return input.trim().toLowerCase();
}

export class SkillsService {
  constructor(private readonly deps: SkillsServiceDependencies) {}

  async list(userId: string, filters?: { skillType?: SkillType; search?: string }) {
    return this.deps.skillsRepository.findByUserId(userId, filters);
  }

  async getById(userId: string, id: string) {
    const skill = await this.deps.skillsRepository.findById(id, userId);
    if (!skill) throw new NotFoundError('Skill');
    return skill;
  }

  async create(userId: string, input: CreateSkillInput) {
    const normalizedName = normalizeName(input.skill_name);

    // Unique per user — check to give 409 before DB
    const existing = await this.deps.skillsRepository.findByNormalizedName(normalizedName, userId);
    if (existing) {
      throw new ConflictError(`Skill "${input.skill_name}" already exists`);
    }

    // Validate aliases don't collide with existing skill names after normalization
    // (dedup handled in repo, but we surface no hard error — aliases that duplicate names are ignored)

    const skill = await this.deps.skillsRepository.create({
      userId,
      skillName: input.skill_name.trim(),
      normalizedName,
      weight: input.weight ?? 1,
      skillType: input.skill_type as SkillType,
      aliases: input.aliases ?? [],
    });

    await this.deps.prisma.auditLog
      .create({
        data: {
          userId,
          action: 'skill_created',
          resourceType: 'skill',
          resourceId: skill.id,
          details: { skill_name: skill.skillName, skill_type: skill.skillType },
        },
      })
      .catch(() => {});

    return skill;
  }

  async update(userId: string, id: string, input: UpdateSkillInput) {
    const existing = await this.deps.skillsRepository.findById(id, userId);
    if (!existing) throw new NotFoundError('Skill');

    let normalizedName: string | undefined;
    if (input.skill_name !== undefined) {
      normalizedName = normalizeName(input.skill_name);
      if (normalizedName !== existing.normalizedName) {
        const dup = await this.deps.skillsRepository.findByNormalizedName(normalizedName, userId);
        if (dup && dup.id !== id) {
          throw new ConflictError(`Skill "${input.skill_name}" already exists`);
        }
      }
    }

    const updated = await this.deps.skillsRepository.update(id, userId, {
      ...(input.skill_name !== undefined ? { skillName: input.skill_name.trim(), normalizedName: normalizedName! } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
      ...(input.skill_type !== undefined ? { skillType: input.skill_type as SkillType } : {}),
      ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
    });

    await this.deps.prisma.auditLog
      .create({
        data: {
          userId,
          action: 'skill_updated',
          resourceType: 'skill',
          resourceId: id,
          details: input as never,
        },
      })
      .catch(() => {});

    return updated;
  }

  async delete(userId: string, id: string) {
    const existing = await this.deps.skillsRepository.findById(id, userId);
    if (!existing) throw new NotFoundError('Skill');

    await this.deps.skillsRepository.delete(id, userId);

    await this.deps.prisma.auditLog
      .create({
        data: { userId, action: 'skill_deleted', resourceType: 'skill', resourceId: id },
      })
      .catch(() => {});
  }
}
