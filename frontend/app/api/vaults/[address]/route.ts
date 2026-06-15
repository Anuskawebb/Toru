import { NextResponse }    from 'next/server';
import { prisma }          from '@/lib/prisma';
import { createPublicClient, http } from 'viem';
import { mantleSepolia }   from '@/config/chains';
import { getWmntPrice }    from '@/lib/price';
import { redis }           from '@/lib/redis';

const VAULT_MANAGER = (process.env.NEXT_PUBLIC_VAULT_MANAGER_ADDRESS ?? '') as `0x${string}`;

// Reverse lookup: token symbol → contract address (for portfolio page tokenAddress field)
const SYMBOL_TO_ADDRESS: Record<string, string> = {
  WMNT: '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8',
  USDC: '0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9',
  USDe: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34',
  USDT: '0x201eba5cc46d216ce6dc03f6a759e8e766e956ae',
};

const VAULT_ABI_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'follower', type: 'address' },
      { internalType: 'address', name: 'leader',   type: 'address' },
    ],
    name:            'getOpenPositions',
    outputs:         [{ internalType: 'bytes32[]', name: 'openIds', type: 'bytes32[]' }],
    stateMutability: 'view',
    type:            'function',
  },
  {
    inputs:  [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    name:    'positions',
    outputs: [
      { internalType: 'address',  name: 'follower',      type: 'address' },
      { internalType: 'address',  name: 'leader',        type: 'address' },
      { internalType: 'bytes32',  name: 'vaultId',       type: 'bytes32' },
      { internalType: 'address',  name: 'token',         type: 'address' },
      { internalType: 'uint256',  name: 'ausdAllocated', type: 'uint256' },
      { internalType: 'uint256',  name: 'entryPrice',    type: 'uint256' },
      { internalType: 'uint256',  name: 'exitPrice',     type: 'uint256' },
      { internalType: 'int256',   name: 'pnl',           type: 'int256'  },
      { internalType: 'uint8',    name: 'status',        type: 'uint8'   },
      { internalType: 'uint256',  name: 'openedAt',      type: 'uint256' },
      { internalType: 'uint256',  name: 'closedAt',      type: 'uint256' },
    ],
    stateMutability: 'view',
    type:            'function',
  },
] as const;

const ADDRESS_TO_SYMBOL: Record<string, string> = {
  '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8': 'WMNT',
  '0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9': 'USDC',
  '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34': 'USDe',
  '0x201eba5cc46d216ce6dc03f6a759e8e766e956ae': 'USDT',
};

const client = createPublicClient({ chain: mantleSepolia, transport: http() });

// ── RPC fallback (used when positions table has no data yet) ──────────────────

async function fetchPositionsFromRpc(
  follower: string,
  vaults: any[],
  priceByToken: Record<string, number>
) {
  return Promise.all(
    vaults.map(async (vault) => {
      let onChainPositions: any[] = [];
      try {
        const openIds = await client.readContract({
          address: VAULT_MANAGER,
          abi:     VAULT_ABI_ABI,
          functionName: 'getOpenPositions',
          args:    [follower as `0x${string}`, vault.leader as `0x${string}`],
        });

        onChainPositions = await Promise.all(
          openIds.map(async (id) => {
            const pos = await client.readContract({
              address: VAULT_MANAGER,
              abi:     VAULT_ABI_ABI,
              functionName: 'positions',
              args:    [id],
            });
            const tokenAddress    = pos[3] as string;
            const ausdcAllocated  = Number(pos[4]) / 1e6;
            const entryPrice      = Number(pos[5]) / 1e10;
            const openedAt        = new Date(Number(pos[9]) * 1000).toISOString();
            const symbol          = ADDRESS_TO_SYMBOL[tokenAddress.toLowerCase()] ?? 'UNKNOWN';
            const currentPrice    = priceByToken[symbol] ?? entryPrice;
            const unrealizedPnl   = entryPrice > 0
              ? (ausdcAllocated * currentPrice) / entryPrice - ausdcAllocated
              : 0;
            return {
              id,
              token: symbol,
              tokenAddress,
              ausdcAllocated,
              entryPrice,
              currentPrice:  +currentPrice.toFixed(6),
              unrealizedPnl: +unrealizedPnl.toFixed(6),
              status:        'OPEN',
              openedAt,
              leader:        vault.leader,
            };
          })
        );
      } catch (err) {
        console.error(`[vaults-api] RPC fallback failed for leader ${vault.leader}:`, err);
      }
      return { vault, positions: onChainPositions };
    })
  );
}

// ── GET /api/vaults/[address] ─────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const follower    = address.toLowerCase();

  // 30-second Redis cache — shared across serverless instances
  const cacheKey = `aether:vaults:${follower}`;
  try {
    const cached = await redis.get<object>(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { 'X-Cache': 'HIT' },
      });
    }
  } catch {
    // Redis miss / unavailable — proceed with live fetch
  }

  const vaults = await prisma.userVault.findMany({
    where:   { follower },
    orderBy: { createdAt: 'desc' },
  });

  if (vaults.length === 0) {
    const empty = { vaults: [], summary: { totalLocked: 0, totalPnl: 0, activeCount: 0 } };
    return NextResponse.json(empty);
  }

  // ── Fast path: read positions from DB (populated by vault-listener in watcher) ──

  const leaders = vaults.map((v) => v.leader.toLowerCase());

  const [dbPositions, tokenPrices, closedPositions, lastActivityRows] = await Promise.all([
    prisma.position.findMany({ where: { follower, status: 'OPEN' } }),
    prisma.tokenPrice.findMany(),
    prisma.position.findMany({
      where:   { follower, leader: { in: leaders }, status: 'CLOSED' },
      orderBy: { closedAt: 'asc' },
      select:  { leader: true, pnl: true, closedAt: true },
    }),
    prisma.leaderSwap.groupBy({
      by:    ['leader'],
      where: { leader: { in: leaders } },
      _max:  { timestamp: true },
    }),
  ]);

  const lastActivityByLeader = new Map<string, string>();
  for (const row of lastActivityRows) {
    if (row._max.timestamp) lastActivityByLeader.set(row.leader.toLowerCase(), row._max.timestamp.toISOString());
  }

  // Build a cumulative realized-P&L sparkline per leader (closed positions only)
  const sparklineByLeader = new Map<string, number[]>();
  for (const p of closedPositions) {
    const key = p.leader.toLowerCase();
    const series = sparklineByLeader.get(key) ?? [0];
    series.push(series[series.length - 1] + Number(p.pnl ?? 0));
    sparklineByLeader.set(key, series);
  }

  // Build price map from DB; stablecoins are always $1
  const priceByToken: Record<string, number> = { USDC: 1.0, USDT: 1.0, USDe: 1.0 };
  for (const tp of tokenPrices) priceByToken[tp.token] = Number(tp.price);

  // If the DB has no positions at all for this follower, the vault-listener
  // hasn't run yet — fall back to on-chain reads (slower, but correct).
  const useRpc = dbPositions.length === 0 && vaults.some((v) => v.status === 'ACTIVE');

  let vaultPositionMap: Map<string, any[]> = new Map();

  if (useRpc) {
    if (!priceByToken['WMNT']) priceByToken['WMNT'] = await getWmntPrice().catch(() => 0);
    const rpcResults = await fetchPositionsFromRpc(follower, vaults, priceByToken);
    for (const { vault, positions } of rpcResults) {
      vaultPositionMap.set(vault.leader.toLowerCase(), positions);
    }
  } else {
    const hasWmnt = dbPositions.some((p) => p.token === 'WMNT');
    if (hasWmnt && !priceByToken['WMNT']) priceByToken['WMNT'] = await getWmntPrice().catch(() => 0);

    for (const p of dbPositions) {
      const leaderKey = p.leader.toLowerCase();
      if (!vaultPositionMap.has(leaderKey)) vaultPositionMap.set(leaderKey, []);
      const currentPrice  = priceByToken[p.token] ?? Number(p.entryPrice);
      const entryPrice    = Number(p.entryPrice);
      const alloc         = Number(p.ausdcAllocated);
      const unrealizedPnl = entryPrice > 0
        ? (alloc * currentPrice) / entryPrice - alloc
        : 0;
      vaultPositionMap.get(leaderKey)!.push({
        id:             p.onChainPositionId ?? p.id,
        token:          p.token,
        tokenAddress:   SYMBOL_TO_ADDRESS[p.token] ?? '',
        ausdcAllocated: alloc,
        entryPrice,
        currentPrice:   +currentPrice.toFixed(6),
        unrealizedPnl:  +unrealizedPnl.toFixed(6),
        status:         'OPEN',
        openedAt:       p.openedAt.toISOString(),
        leader:         p.leader,
      });
    }
  }

  let totalLocked = 0;
  let totalPnl    = 0;
  let activeCount = 0;

  const enrichedVaults = vaults.map((vault) => {
    const locked    = Number(vault.ausdcLocked);
    totalLocked    += locked;
    if (vault.status === 'ACTIVE') activeCount++;

    const positions  = vaultPositionMap.get(vault.leader.toLowerCase()) ?? [];
    const vaultPnl   = positions.reduce((s: number, p: any) => s + p.unrealizedPnl, 0);
    totalPnl        += vaultPnl;

    const leaderKey = vault.leader.toLowerCase();
    const sparkline = sparklineByLeader.get(leaderKey) ?? [0];
    const fullSparkline = [...sparkline, sparkline[sparkline.length - 1] + vaultPnl];

    return {
      ...vault,
      ausdcLocked:   locked,
      positions,
      unrealizedPnl: +vaultPnl.toFixed(6),
      sparkline:     fullSparkline.map((n) => +n.toFixed(6)),
      lastLeaderActivity: lastActivityByLeader.get(leaderKey) ?? null,
    };
  });

  const payload = {
    vaults: enrichedVaults,
    summary: {
      totalLocked: +totalLocked.toFixed(6),
      totalPnl:    +totalPnl.toFixed(6),
      activeCount,
    },
  };

  // Cache for 30 seconds in Redis
  try {
    await redis.set(cacheKey, payload, { ex: 30 });
  } catch { /* non-fatal */ }

  return NextResponse.json(payload);
}
