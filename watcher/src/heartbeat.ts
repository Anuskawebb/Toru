import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const HEARTBEAT_KEY = 'aether:watcher:heartbeat';
const TTL = 60; // seconds — expires if watcher goes silent

export async function writeHeartbeat(): Promise<void> {
  await redis.set(HEARTBEAT_KEY, { ts: Date.now() }, { ex: TTL }).catch(() => {});
}
