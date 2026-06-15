import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/** Increments a daily throughput counter, expiring it at the next UTC midnight. */
export async function incrStat(key: string): Promise<void> {
  try {
    const value = await redis.incr(key);
    if (value === 1) {
      const now     = new Date();
      const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
      const ttl      = Math.ceil((midnight - now.getTime()) / 1000);
      await redis.expire(key, ttl);
    }
  } catch { /* non-fatal */ }
}

export const STAT_AI_CALLS   = 'aether:stats:aiCalls:today';
export const STAT_EXECUTIONS = 'aether:stats:executions:today';
export const STAT_EVALUATED  = 'aether:stats:evaluated:today';
