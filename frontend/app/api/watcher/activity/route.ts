import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/prisma';
import { redis }        from '@/lib/redis';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { mantleSepolia } from '@/config/chains';

// GET /api/watcher/activity
// Global, cross-user feed of every action the watcher has taken recently:
// positions opened, positions closed (incl. stop-loss), and trades skipped.
// Public — no auth required.

const VAULT_MANAGER = (process.env.NEXT_PUBLIC_VAULT_MANAGER_ADDRESS ?? '') as `0x${string}`;
const SKIP_EVENT     = parseAbiItem('event TradeSkipped(bytes32 indexed vaultId, string reason)');
const CACHE_KEY      = 'aether:watcher:activity';
const SCAN_BLOCKS    = 5_000n;

const client = createPublicClient({ chain: mantleSepolia, transport: http() });

export type WatcherEvent = {
  type:       'OPENED' | 'CLOSED' | 'SKIPPED';
  follower:   string;
  leader:     string;
  token:      string | null;
  amount:     number | null;
  pnl:        number | null;
  reason:     string | null;
  txHash:     string | null;
  happenedAt: string;
};

export async function GET() {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return NextResponse.json(cached);
  } catch { /* non-fatal */ }

  const [openedRecent, closedRecent, vaults] = await Promise.all([
    prisma.position.findMany({ orderBy: { openedAt: 'desc' }, take: 25 }),
    prisma.position.findMany({ where: { status: 'CLOSED' }, orderBy: { closedAt: 'desc' }, take: 25 }),
    prisma.userVault.findMany({ select: { onChainVaultId: true, follower: true, leader: true } }),
  ]);

  // Extract unique follower & leader addresses to fetch profiles
  const addresses = new Set<string>();
  openedRecent.forEach((p) => {
    addresses.add(p.follower.toLowerCase());
    addresses.add(p.leader.toLowerCase());
  });
  closedRecent.forEach((p) => {
    addresses.add(p.follower.toLowerCase());
    addresses.add(p.leader.toLowerCase());
  });
  vaults.forEach((v) => {
    addresses.add(v.follower.toLowerCase());
    addresses.add(v.leader.toLowerCase());
  });

  const profiles = await prisma.followerProfile.findMany({
    where: { follower: { in: Array.from(addresses) } },
    select: { follower: true, email: true },
  });

  const profileMap: Record<string, string> = {};
  for (const p of profiles) {
    if (p.email && p.email.includes('@')) {
      const handle = p.email.split('@')[0];
      if (handle) {
        profileMap[p.follower.toLowerCase()] = handle;
      }
    }
  }

  const events: WatcherEvent[] = [];

  for (const p of openedRecent) {
    events.push({
      type:       'OPENED',
      follower:   p.follower,
      leader:     p.leader,
      token:      p.token,
      amount:     Number(p.ausdcAllocated),
      pnl:        null,
      reason:     null,
      txHash:     p.txHashOpen,
      happenedAt: p.openedAt.toISOString(),
    });
  }

  for (const p of closedRecent) {
    if (!p.closedAt) continue;
    events.push({
      type:       'CLOSED',
      follower:   p.follower,
      leader:     p.leader,
      token:      p.token,
      amount:     Number(p.ausdcAllocated),
      pnl:        p.pnl != null ? Number(p.pnl) : 0,
      reason:     p.closeReason,
      txHash:     p.txHashClose,
      happenedAt: p.closedAt.toISOString(),
    });
  }

  // Skipped trades — recent block window only (cheap, no historical backfill needed for a live feed)
  if (VAULT_MANAGER) {
    try {
      const vaultMap = new Map<string, { follower: string; leader: string }>();
      for (const v of vaults) {
        if (v.onChainVaultId) vaultMap.set(v.onChainVaultId.toLowerCase(), { follower: v.follower, leader: v.leader });
      }

      const latest = await client.getBlockNumber();
      const from   = latest > SCAN_BLOCKS ? latest - SCAN_BLOCKS : 0n;
      const logs   = await client.getLogs({ address: VAULT_MANAGER, events: [SKIP_EVENT], fromBlock: from, toBlock: latest });

      const blockTimes = new Map<bigint, number>();
      await Promise.all(
        [...new Set(logs.map((l) => l.blockNumber).filter((b): b is bigint => b != null))].map(async (bn) => {
          try {
            const block = await client.getBlock({ blockNumber: bn });
            blockTimes.set(bn, Number(block.timestamp));
          } catch { /* skip */ }
        })
      );

      for (const log of logs.slice(-25)) {
        const vId = (log.args as { vaultId?: string }).vaultId?.toLowerCase();
        const v   = vId ? vaultMap.get(vId) : null;
        if (!v) continue;
        const ts = log.blockNumber != null ? blockTimes.get(log.blockNumber) : undefined;
        events.push({
          type:       'SKIPPED',
          follower:   v.follower,
          leader:     v.leader,
          token:      null,
          amount:     null,
          pnl:        null,
          reason:     (log.args as { reason?: string }).reason ?? null,
          txHash:     log.transactionHash,
          happenedAt: new Date((ts ?? Date.now() / 1000) * 1000).toISOString(),
        });
      }
    } catch (err) {
      console.error('[watcher-activity] skipped scan failed:', err);
    }
  }

  events.sort((a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime());
  const result = { events: events.slice(0, 40), profiles: profileMap };

  try { await redis.set(CACHE_KEY, result, { ex: 15 }); } catch { /* non-fatal */ }
  return NextResponse.json(result);
}
