import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { getConfig } from '../../config/env.js';

async function securityPlugin(fastify: FastifyInstance) {
  const config = getConfig();

  // CORS — handle "*" and comma-separated list for dashboard (5173) + direct API calls
  const corsOrigin = (() => {
    if (!config.CORS_ORIGIN || config.CORS_ORIGIN === '*') return true // reflect request origin
    if (config.CORS_ORIGIN.includes(',')) {
      const allowed = config.CORS_ORIGIN.split(',').map((s) => s.trim())
      return (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
        if (!origin) return cb(null, true)
        cb(null, allowed.includes(origin) || allowed.includes('*'))
      }
    }
    return config.CORS_ORIGIN
  })() as any

  await fastify.register(cors, {
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'Idempotency-Key'],
  });

  // Helmet (security headers)
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Rate limiting — global
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: 'Rate Limit',
      message: 'Too many requests, please try again later',
      code: 'RATE_LIMIT',
    }),
  });
}

export default fp(securityPlugin, {
  name: 'security',
});
