import { ImageResponse } from 'next/og';
import { prisma } from '@/lib/prisma';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const fmt = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawAddress = searchParams.get('address') ?? '';
  const address = rawAddress.toLowerCase();

  let followerCount = 0;
  let winRate: number | null = null;
  let totalProfitYielded = 0;
  let volume24h = 0;

  if (address) {
    const [followers, closedCount, winnersCount, pnlSum, swapAgg] = await Promise.all([
      prisma.userVault.count({ where: { leader: address, status: { in: ['ACTIVE', 'PAUSED'] } } }),
      prisma.position.count({ where: { leader: address, status: 'CLOSED' } }),
      prisma.position.count({ where: { leader: address, status: 'CLOSED', pnl: { gt: 0 } } }),
      prisma.position.aggregate({ where: { leader: address, status: 'CLOSED' }, _sum: { pnl: true } }),
      prisma.leaderSwap.aggregate({
        where:  { leader: address, timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        _sum:   { usdValue: true },
      }),
    ]);
    followerCount = followers;
    winRate = closedCount > 0 ? Math.round((winnersCount / closedCount) * 100) : null;
    totalProfitYielded = Number(pnlSum._sum.pnl ?? 0);
    volume24h = Number(swapAgg._sum.usdValue ?? 0);
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #0a0a0c 0%, #18181b 100%)',
          padding: '64px',
          color: '#fafafa',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #34d399, #3b82f6)',
              display: 'flex',
            }}
          />
          <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>Aether</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 24, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Copy-Trading Leader
          </span>
          <span style={{ fontSize: 64, fontWeight: 300, fontFamily: 'monospace', letterSpacing: '-0.02em' }}>
            {address ? fmt(address) : 'Unknown'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 48 }}>
          {[
            { label: 'Followers', value: String(followerCount) },
            { label: 'Win Rate', value: winRate !== null ? `${winRate}%` : '—' },
            { label: 'P&L Generated', value: `${totalProfitYielded >= 0 ? '+' : ''}${totalProfitYielded.toFixed(2)} aUSD` },
            { label: '24h Volume', value: `$${volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
          ].map((s) => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 18, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {s.label}
              </span>
              <span style={{ fontSize: 36, fontWeight: 300, fontFamily: 'monospace' }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
