import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/prisma';
import { redis, STAT_AI_CALLS, STAT_EXECUTIONS, STAT_EVALUATED } from '@/lib/redis';

const CACHE_KEY = 'aether:platform:stats';
const CACHE_TTL = 60; // 60s

// GET /api/stats — platform-wide aggregate metrics, no auth required
export async function GET() {
  const cached = await redis.get(CACHE_KEY);
  if (cached) return NextResponse.json(cached);

  const [vaultStats, totalPositions, openPositions, aiCallsToday, executionsToday, tradesEvaluatedToday] = await Promise.all([
    prisma.userVault.aggregate({
      where:  { status: 'ACTIVE' },
      _count: { _all: true },
      _sum:   { ausdcLocked: true },
    }),
    prisma.position.count(),
    prisma.position.count({ where: { status: 'OPEN' } }),
    redis.get<number>(STAT_AI_CALLS),
    redis.get<number>(STAT_EXECUTIONS),
    redis.get<number>(STAT_EVALUATED),
  ]);

  const result = {
    activeAgents:   vaultStats._count._all,
    ausdLocked:     Number(vaultStats._sum.ausdcLocked ?? 0),
    totalPositions,
    openPositions,
    aiCallsToday:         aiCallsToday ?? 0,
    executionsToday:      executionsToday ?? 0,
    tradesEvaluatedToday: tradesEvaluatedToday ?? 0,
  };

  await redis.set(CACHE_KEY, result, { ex: CACHE_TTL });
  return NextResponse.json(result);
}
