import type { Redis } from 'ioredis';

/**
 * DistributedLock — Redis-based distributed lock for scrape concurrency protection.
 * Prevents two scheduled runs from scraping the same source simultaneously.
 *
 * Pattern: scrape-lock:{source_id}
 * Flow: Acquire lock → Run scraper → Submit jobs → Report result → Release lock
 *
 * Uses SET NX EX for atomic acquire with TTL (auto-expire safety net).
 * SOLID: Single responsibility — lock lifecycle management.
 */

const LOCK_TTL_SECONDS = 300; // 5 minutes — max scrape runtime
const LOCK_PREFIX = 'scrape-lock:';

export interface LockResult {
  acquired: boolean;
  lockId?: string;
}

export class DistributedLock {
  constructor(private readonly redis: Redis) {}

  /**
   * Attempt to acquire a lock for a source.
   * Returns acquired: true if lock obtained, false if another run is active.
   */
  async acquire(sourceId: string): Promise<LockResult> {
    const key = `${LOCK_PREFIX}${sourceId}`;
    const lockId = crypto.randomUUID();

    try {
      // SET NX EX — atomic: set if not exists, with expiry
      const result = await this.redis.set(key, lockId, 'EX', LOCK_TTL_SECONDS, 'NX');
      const acquired = result === 'OK';

      return { acquired, lockId: acquired ? lockId : undefined };
    } catch {
      // Redis unavailable — fail open (allow scrape) vs fail closed (block)
      // Fail open: allow scrape to proceed, log warning
      console.warn(`[DistributedLock] Redis unavailable — allowing scrape for ${sourceId}`);
      return { acquired: true, lockId: 'fallback' };
    }
  }

  /**
   * Release a lock — only if we own it (compare lockId).
   * Uses Lua script for atomic check-and-delete.
   */
  async release(sourceId: string, lockId: string): Promise<boolean> {
    const key = `${LOCK_PREFIX}${sourceId}`;

    // Lua script: check value matches, then delete
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.redis.eval(luaScript, 1, key, lockId) as number;
      return result === 1;
    } catch {
      console.warn(`[DistributedLock] Redis unavailable — could not release lock for ${sourceId}`);
      return false;
    }
  }

  /**
   * Check if a source is currently locked.
   */
  async isLocked(sourceId: string): Promise<boolean> {
    const key = `${LOCK_PREFIX}${sourceId}`;
    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch {
      return false;
    }
  }

  /**
   * Get remaining TTL for a lock (in seconds).
   */
  async getTtl(sourceId: string): Promise<number> {
    const key = `${LOCK_PREFIX}${sourceId}`;
    try {
      const ttl = await this.redis.ttl(key);
      return ttl;
    } catch {
      return -1;
    }
  }
}
