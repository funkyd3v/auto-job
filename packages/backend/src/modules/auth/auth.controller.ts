import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from './auth.service.js';
import {
  LoginSchema,
  RegisterSchema,
  RefreshTokenSchema,
  CreateApiKeySchema,
} from './auth.validators.js';

export async function authRoutes(fastify: FastifyInstance) {
  const authService = new AuthService(fastify.prisma, fastify);

  // POST /api/auth/register
  fastify.post(
    '/register',
    {
      preHandler: [fastify.rateLimit({ max: 5, timeWindow: '15 minutes' })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = RegisterSchema.parse(request.body);
      const user = await authService.register(body);
      return reply.status(201).send({ user });
    },
  );

  // POST /api/auth/login
  fastify.post(
    '/login',
    {
      preHandler: [fastify.rateLimit({ max: 5, timeWindow: '15 minutes' })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = LoginSchema.parse(request.body);
      const ip = request.ip;
      const tokens = await authService.login(body, ip);

      reply.setCookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/api/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.send({
        accessToken: tokens.accessToken,
        user: { email: body.email },
      });
    },
  );

  // POST /api/auth/logout
  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie('refreshToken', { path: '/api/auth/refresh' });
    return reply.send({ message: 'Logged out' });
  });

  // POST /api/auth/refresh
  fastify.post(
    '/refresh',
    {
      preHandler: [fastify.rateLimit({ max: 10, timeWindow: '15 minutes' })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const refreshToken = request.cookies?.refreshToken as string | undefined;
      if (!refreshToken) {
        const body = RefreshTokenSchema.parse(request.body);
        const tokens = await authService.refresh(body.refreshToken);

        reply.setCookie('refreshToken', tokens.refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: '/api/auth/refresh',
          maxAge: 7 * 24 * 60 * 60,
        });

        return reply.send({ accessToken: tokens.accessToken });
      }

      const tokens = await authService.refresh(refreshToken);

      reply.setCookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/api/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.send({ accessToken: tokens.accessToken });
    },
  );
}

export async function apiKeyRoutes(fastify: FastifyInstance) {
  const authService = new AuthService(fastify.prisma, fastify);

  // All routes in this plugin require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /api/api-keys
  fastify.post(
    '/api-keys',
    {
      preHandler: [fastify.rateLimit({ max: 5, timeWindow: '1 hour' })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = CreateApiKeySchema.parse(request.body);
      const key = await authService.createApiKey(request.userId!, body);
      return reply.status(201).send({
        message: 'API key created. Store the full key securely — it will not be shown again.',
        key,
      });
    },
  );

  // GET /api/api-keys
  fastify.get('/api-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    const keys = await authService.listApiKeys(request.userId!);
    return reply.send({ keys });
  });

  // DELETE /api/api-keys/:id
  fastify.delete('/api-keys/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await authService.revokeApiKey(request.userId!, id);
    return reply.send({ message: 'API key revoked' });
  });
}
