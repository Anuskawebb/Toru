import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/prisma';
import { redis }        from '@/lib/redis';

// GET /api/traders/[address]/inference
// AI-generated natural-language summary of a leader's on-chain trading
// pattern, derived from `leader_swaps` (Mantle Mainnet) + `positions`
// (copy-trade win rate). Cached in Redis for 1h.

const CACHE_TTL = 60 * 60; // 1h

const ADDRESS_TO_SYMBOL: Record<string, string> = {
  '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8': 'WMNT',
  '0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9': 'USDC',
  '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34': 'USDe',
  '0x201eba5cc46d216ce6dc03f6a759e8e766e956ae': 'USDT',
};

const symbolFor = (addr: string) =>
  ADDRESS_TO_SYMBOL[addr.toLowerCase()] ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address: rawAddress } = await params;
  const address = rawAddress.toLowerCase();

  const cacheKey = `aether:inference:${address}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return NextResponse.json(cached);
  } catch { /* non-fatal */ }

  const [swaps, closedCount, winnersCount] = await Promise.all([
    prisma.leaderSwap.findMany({
      where:   { leader: address },
      orderBy: { timestamp: 'desc' },
      take:    100,
    }),
    prisma.position.count({ where: { leader: address, status: 'CLOSED' } }),
    prisma.position.count({ where: { leader: address, status: 'CLOSED', pnl: { gt: 0 } } }),
  ]);

  if (swaps.length < 5) {
    const result = { summary: null, recommendation: null, confidence: null, reason: 'not_enough_data' };
    try { await redis.set(cacheKey, result, { ex: CACHE_TTL }); } catch { /* non-fatal */ }
    return NextResponse.json(result);
  }

  // ── Most active hour of day (UTC) ──────────────────────────────────────────
  const hourCounts = new Map<number, number>();
  for (const s of swaps) {
    const hour = s.timestamp.getUTCHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  const mostActiveHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // ── Most traded token pair ──────────────────────────────────────────────────
  const pairCounts = new Map<string, number>();
  for (const s of swaps) {
    const a = symbolFor(s.tokenIn);
    const b = symbolFor(s.tokenOut);
    const pair = [a, b].sort().join('/');
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
  }
  const mostTradedPair = [...pairCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // ── Avg trade size (USD) ────────────────────────────────────────────────────
  const avgTradeSize = swaps.reduce((sum, s) => sum + Number(s.usdValue), 0) / swaps.length;

  // ── Buy / sell ratio ─────────────────────────────────────────────────────────
  const buys  = swaps.filter((s) => s.side === 'BUY').length;
  const sells = swaps.filter((s) => s.side === 'SELL').length;

  // ── Activity trend: last 30 vs previous 30 swaps (trades-per-day rate) ─────
  let trend: 'increasing' | 'decreasing' | 'steady' = 'steady';
  if (swaps.length >= 60) {
    const last30 = swaps.slice(0, 30);
    const prev30 = swaps.slice(30, 60);
    const rate = (group: typeof swaps) => {
      const spanMs = group[0].timestamp.getTime() - group[group.length - 1].timestamp.getTime();
      const spanDays = Math.max(spanMs / (1000 * 60 * 60 * 24), 1 / 24);
      return group.length / spanDays;
    };
    const recentRate = rate(last30);
    const prevRate   = rate(prev30);
    if (recentRate > prevRate * 1.15) trend = 'increasing';
    else if (recentRate < prevRate * 0.85) trend = 'decreasing';
  }

  // ── Win rate from copy-trade positions ──────────────────────────────────────
  const winRate = closedCount > 0 ? Math.round((winnersCount / closedCount) * 100) : null;

  const stats = {
    mostActiveHour,
    mostTradedPair,
    avgTradeSize: Math.round(avgTradeSize * 100) / 100,
    buys,
    sells,
    trend,
    winRate,
    closedCount,
    sampleSize: swaps.length,
  };

  const { summary, recommendation, confidence } = await generateSummary(address, stats);

  const result = { summary, recommendation, confidence, stats };
  try { await redis.set(cacheKey, result, { ex: CACHE_TTL }); } catch { /* non-fatal */ }
  return NextResponse.json(result);
}

export type Recommendation = 'follow' | 'caution' | 'avoid';

export interface InferenceSummary {
  summary:        string;
  recommendation: Recommendation | null;
  confidence:     number | null;
}

async function generateSummary(address: string, stats: {
  mostActiveHour: number;
  mostTradedPair: string;
  avgTradeSize: number;
  buys: number;
  sells: number;
  trend: string;
  winRate: number | null;
  closedCount: number;
  sampleSize: number;
}): Promise<InferenceSummary> {
  const fallback: InferenceSummary = {
    summary:
      `This trader is most active around ${stats.mostActiveHour}:00 UTC, primarily trading the ${stats.mostTradedPair} pair ` +
      `with an average trade size of $${stats.avgTradeSize.toLocaleString()}. ` +
      `Their activity has been ${stats.trend} over recent trades (${stats.buys} buys vs ${stats.sells} sells)` +
      (stats.winRate !== null ? `, and copy-traders following them have a ${stats.winRate}% win rate over ${stats.closedCount} closed positions.` : '.'),
    recommendation: null,
    confidence:     null,
  };

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return fallback;

  const prompt =
    `You are the leader-analysis agent for Aether, an on-chain copy-trading platform on Mantle. ` +
    `Analyze the on-chain trading behavior of a wallet (${address.slice(0, 6)}…${address.slice(-4)}) ` +
    `on Mantle Mainnet, based on its last ${stats.sampleSize} swaps.\n\n` +
    `Stats:\n` +
    `- Most active hour (UTC): ${stats.mostActiveHour}:00\n` +
    `- Most traded pair: ${stats.mostTradedPair}\n` +
    `- Average trade size: $${stats.avgTradeSize}\n` +
    `- Buy/sell split: ${stats.buys} buys / ${stats.sells} sells\n` +
    `- Recent activity trend: ${stats.trend}\n` +
    (stats.winRate !== null
      ? `- Copy-trade win rate: ${stats.winRate}% over ${stats.closedCount} closed positions\n`
      : '') +
    `\nRespond with strict JSON: {"summary": "<2-3 sentence data-driven summary of this trader's behavior for someone ` +
    `deciding whether to copy-trade them, no markdown>", "recommendation": "follow"|"caution"|"avoid", "confidence": <integer 0-100>}.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 200,
        temperature: 0.4,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) {
        const parsed = JSON.parse(text);
        const recommendation: Recommendation | null =
          parsed.recommendation === 'follow' || parsed.recommendation === 'caution' || parsed.recommendation === 'avoid'
            ? parsed.recommendation
            : null;
        const confidence = Number(parsed.confidence);
        if (typeof parsed.summary === 'string' && parsed.summary) {
          return {
            summary: parsed.summary,
            recommendation,
            confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, Math.round(confidence))) : null,
          };
        }
      }
    } else {
      console.error(`[inference] OpenAI API returned error status: ${res.status}`);
    }
  } catch (err) {
    console.error('[inference] OpenAI fetch error:', err);
  }

  return fallback;
}
