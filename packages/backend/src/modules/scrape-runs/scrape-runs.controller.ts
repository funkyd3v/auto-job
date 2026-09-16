import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CreateScrapeRunSchema, ScrapeRunIdParamSchema } from './scrape-runs.validators.js';
import { ScrapeRunsService } from './scrape-runs.service.js';
import { ForbiddenError } from '../../shared/errors/index.js';

function assertScopes(request: FastifyRequest, required: string[]) {
  const scopes = request.apiKeyScopes;
  if (scopes && !required.some((s) => scopes.includes(s))) {
    throw new ForbiddenError(`Missing scope: ${required.join(', ')}`);
  }
}

export async function scrapeRunsRoutes(fastify: FastifyInstance) {
  const service = new ScrapeRunsService(fastify.prisma);

  fastify.addHook('preHandler', fastify.authenticateAny);

  // POST /api/scrape-runs — extension reports after each source run
  fastify.post('/scrape-runs', async (request: FastifyRequest, reply: FastifyReply) => {
    assertScopes(request, ['scrape-runs:write']);
    const body = CreateScrapeRunSchema.parse(request.body);
    const run = await service.create(request.userId!, body);
    return reply.status(201).send({ data: run });
  });

  // GET /api/scrape-runs?source_id=
  fastify.get('/scrape-runs', async (request: FastifyRequest, reply: FastifyReply) => {
    const { source_id } = request.query as { source_id?: string };
    const runs = await service.list(request.userId!, source_id);
    return reply.send({ data: runs });
  });

  // GET /api/scrape-runs/:id
  fastify.get('/scrape-runs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = ScrapeRunIdParamSchema.parse(request.params);
    const run = await service.getById(request.userId!, id);
    return reply.send({ data: run });
  });
}
