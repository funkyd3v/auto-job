import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { getConfig } from '../../config/env.js';
import { UnauthorizedError } from '../errors/index.js';
import { hashApiKey } from './auth-utils.js';
import { PrismaClient } from '@prisma/client';

export interface JwtPayload {
  id: string;
  email: string;
  sub?: string;
  iat: number;
  exp: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    userEmail?: string;
    apiKeyScopes?: string[];
    apiKeyId?: string;
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateAny: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function authPlugin(fastify: FastifyInstance) {
  // Verify JWT access token
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        throw new UnauthorizedError('Missing or invalid authorization header');
      }

      const token = authHeader.substring(7);
      const payload = request.server.jwt.verify<JwtPayload>(token);

      request.userId = payload.sub || payload.id;
      request.userEmail = payload.email;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError('Invalid or expired token');
    }
  });

  // Verify API key
  fastify.decorate('authenticateApiKey', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const apiKey = request.headers['x-api-key'] as string;
      if (!apiKey) {
        throw new UnauthorizedError('Missing API key');
      }

      const prisma = fastify.prisma;
      const keyHash = await hashApiKey(apiKey);

      const keyRecord = await prisma.apiKey.findFirst({
        where: { keyHash },
        include: { user: true },
      });

      if (!keyRecord || keyRecord.revokedAt) {
        throw new UnauthorizedError('Invalid or revoked API key');
      }

      if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
        throw new UnauthorizedError('API key expired');
      }

      // Update last used
      await prisma.apiKey.update({
        where: { id: keyRecord.id },
        data: { lastUsedAt: new Date() },
      });

      request.userId = keyRecord.userId;
      request.userEmail = keyRecord.user.email;
      request.apiKeyScopes = (keyRecord.scopes as string[]) ?? [];
      request.apiKeyId = keyRecord.id;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError('Invalid API key');
    }
  });

  // Verify either JWT or API key (for jobs ingestion: extension uses API key, dashboard uses JWT)
  fastify.decorate('authenticateAny', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const payload = request.server.jwt.verify<JwtPayload>(token);
        request.userId = payload.sub || payload.id;
        request.userEmail = payload.email;
        return;
      } catch (err) {
        // If API key also present, try it; otherwise throw
        if (!apiKey) {
          throw new UnauthorizedError('Invalid or expired token');
        }
      }
    }

    if (apiKey) {
      await (fastify as unknown as { authenticateApiKey: typeof fastify.authenticateApiKey }).authenticateApiKey(request, reply);
      return;
    }

    throw new UnauthorizedError('Missing authentication: provide Bearer token or X-Api-Key');
  });
}

export default fp(authPlugin, {
  name: 'auth',
});
