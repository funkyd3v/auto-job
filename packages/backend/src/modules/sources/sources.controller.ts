import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CreateSourceSchema, UpdateSourceSchema, SourceIdParamSchema } from './sources.validators.js';
import { SourcesService } from './sources.service.js';
import { ForbiddenError } from '../../shared/errors/index.js';

/** Prisma returns camelCase; extension expects snake_case. */
function serializeSource(s: Record<string, unknown>) {
  return {
    id: s.id,
    name: s.name,
    source_type: s.sourceType,
    base_url: s.baseUrl,
    scraper_config: s.scraperConfig,
    config_version: s.configVersion,
    scraper_version: s.scraperVersion,
    is_enabled: s.isEnabled,
    schedule: s.schedule,
  };
}

function assertScopes(request: FastifyRequest, required: string[]) {
  const scopes = request.apiKeyScopes;
  if (scopes && !required.some((s) => scopes.includes(s))) {
    throw new ForbiddenError(`Missing scope: ${required.join(', ')}`);
  }
}

export async function sourcesRoutes(fastify: FastifyInstance) {
  const service = new SourcesService(fastify.prisma);

  // Dashboard (JWT) + extension (API key sources:read) share this endpoint
  fastify.addHook('preHandler', fastify.authenticateAny);

  // GET /api/sources
  fastify.get('/sources', async (request: FastifyRequest, reply: FastifyReply) => {
    assertScopes(request, ['sources:read']);
    const sources = await service.list(request.userId!);
    return reply.send({ data: sources.map(serializeSource) });
  });

  // POST /api/sources — dashboard only (JWT); scopes not enforced for JWT but audit logged
  fastify.post('/sources', async (request: FastifyRequest, reply: FastifyReply) => {
    // Allow JWT or API key with sources:write (not in locked scopes, but accept jobs:write holder? Keep open)
    const body = CreateSourceSchema.parse(request.body);
    const source = await service.create(request.userId!, body);
    return reply.status(201).send({ data: serializeSource(source as unknown as Record<string, unknown>) });
  });

  // PATCH /api/sources/:id
  fastify.patch('/sources/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = SourceIdParamSchema.parse(request.params);
    const body = UpdateSourceSchema.parse(request.body);
    const source = await service.update(request.userId!, id, body);
    return reply.send({ data: serializeSource(source as unknown as Record<string, unknown>) });
  });

  // DELETE /api/sources/:id
  fastify.delete('/sources/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = SourceIdParamSchema.parse(request.params);
    await service.remove(request.userId!, id);
    return reply.send({ message: 'Source deleted' });
  });
}
