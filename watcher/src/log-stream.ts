import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const LOG_STREAM_KEY = 'aether:watcher:logs';
const MAX_LOGS = 200;
const TTL      = 3600; // 1h — feed is only useful while live

export type LogLevel = 'info' | 'warn' | 'error';

/** Pushes a log line onto a capped Redis list so the frontend can stream
 *  watcher activity live. Fire-and-forget; never throws. */
export async function pushLog(level: LogLevel, tag: string, msg: string): Promise<void> {
  try {
    const entry = { ts: Date.now(), level, tag, msg };
    const pipeline = redis.pipeline();
    pipeline.lpush(LOG_STREAM_KEY, entry);
    pipeline.ltrim(LOG_STREAM_KEY, 0, MAX_LOGS - 1);
    pipeline.expire(LOG_STREAM_KEY, TTL);
    await pipeline.exec();
  } catch { /* non-fatal */ }
}
