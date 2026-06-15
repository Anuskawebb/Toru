import { NextResponse } from 'next/server';
import { redis }        from '@/lib/redis';

// GET /api/watcher/logs
// Returns the most recent watcher console log lines (newest first) for a
// live "Watcher Console" feed. Public — no auth required.

const LOG_STREAM_KEY = 'aether:watcher:logs';

export type WatcherLog = {
  ts:    number;
  level: 'info' | 'warn' | 'error';
  tag:   string;
  msg:   string;
};

export async function GET() {
  try {
    const logs = await redis.lrange<WatcherLog>(LOG_STREAM_KEY, 0, 99);
    return NextResponse.json({ logs });
  } catch {
    return NextResponse.json({ logs: [] });
  }
}
