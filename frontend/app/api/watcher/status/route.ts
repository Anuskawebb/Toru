import { NextResponse } from 'next/server';
import { redis }        from '@/lib/redis';

const HEARTBEAT_KEY = 'aether:watcher:heartbeat';

export async function GET() {
  try {
    const data = await redis.get<{ ts: number }>(HEARTBEAT_KEY);
    if (!data) {
      return NextResponse.json({ online: false, lastChecked: null, ageMs: null });
    }
    const ageMs = Date.now() - data.ts;
    return NextResponse.json({ online: true, lastChecked: data.ts, ageMs });
  } catch {
    return NextResponse.json({ online: false, lastChecked: null, ageMs: null });
  }
}
