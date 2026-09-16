import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { getConfig } from '../../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

async function redisPlugin(fastify: FastifyInstance) {
  const config = getConfig();

  // Allow tests/dev without Redis — fallback gracefully
  let redis: Redis;
  try {
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    // Try to connect but don't block startup if unavailable (e.g., tests)
    // Connection errors are logged, not thrown
    redis.on('error', (err: Error) => {
      fastify.log.warn({ err }, 'Redis connection error');
    });

    // Attempt connect silently
    if (config.NODE_ENV !== 'test') {
      await redis.connect().catch(() => {
        fastify.log.warn('Redis unavailable — idempotency will use DB fallback only');
      });
    }
  } catch (err) {
    fastify.log.warn({ err }, 'Failed to initialize Redis');
    // Create a no-op stub that satisfies interface for tests
    redis = {
      get: async () => null,
      set: async () => 'OK',
      del: async () => 0,
      setex: async () => 'OK',
      quit: async () => 'OK',
      disconnect: () => {},
      on: () => redis,
    } as unknown as Redis;
  }

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    try {
      redis.disconnect();
    } catch {}
  });
}

export default fp(redisPlugin, {
  name: 'redis',
});
