import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SkillsRepository } from './skills.repository.js';
import { SkillsService } from './skills.service.js';
import { CreateSkillSchema, UpdateSkillSchema, SkillIdParamSchema, ListSkillsQuerySchema } from './skills.validators.js';

/** Prisma returns camelCase; extension expects snake_case. */
function serializeSkill(s: Record<string, unknown>) {
  const aliases = (s.aliases as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    id: s.id,
    skill_name: s.skillName,
    normalized_name: s.normalizedName,
    weight: s.weight,
    skill_type: s.skillType,
    aliases: aliases.map((a) => ({
      alias: a.alias,
      normalized_alias: a.normalizedAlias,
    })),
  };
}

export async function skillsRoutes(fastify: FastifyInstance) {
  const repo = new SkillsRepository(fastify.prisma);
  const service = new SkillsService({ skillsRepository: repo, prisma: fastify.prisma });

  fastify.addHook('preHandler', fastify.authenticateAny);

  // GET /api/skills
  fastify.get('/skills', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = ListSkillsQuerySchema.parse(request.query);
    const skills = await service.list(request.userId!, {
      skillType: query.skill_type as any,
      search: query.search,
    });
    return reply.send({ data: skills.map(serializeSkill) });
  });

  // POST /api/skills
  fastify.post('/skills', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = CreateSkillSchema.parse(request.body);
    const skill = await service.create(request.userId!, body);
    return reply.status(201).send({ data: serializeSkill(skill as unknown as Record<string, unknown>) });
  });

  // PATCH /api/skills/:id
  fastify.patch('/skills/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = SkillIdParamSchema.parse(request.params);
    const body = UpdateSkillSchema.parse(request.body);
    const skill = await service.update(request.userId!, id, body);
    return reply.send({ data: serializeSkill(skill as unknown as Record<string, unknown>) });
  });

  // DELETE /api/skills/:id
  fastify.delete('/skills/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = SkillIdParamSchema.parse(request.params);
    await service.delete(request.userId!, id);
    return reply.send({ message: 'Skill deleted' });
  });
}
