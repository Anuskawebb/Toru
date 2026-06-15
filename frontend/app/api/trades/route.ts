import { NextResponse }  from 'next/server';
import { prisma }        from '@/lib/prisma';
import { redis }         from '@/lib/redis';
import { createPublicClient, http, keccak256, encodePacked, parseAbiItem } from 'viem';
import { mantleSepolia } from '@/config/chains';
import { getWmntPrice }  from '@/lib/price';

const VAULT_MANAGER = (process.env.NEXT_PUBLIC_VAULT_MANAGER_ADDRESS ?? '') as `0x${string}`;

// Block the current VaultManager (0xEA364c...92efc) was deployed at on Mantle Sepolia.
const DEPLOY_BLOCK = 39981447n;

// Only scan for SKIPPED-trade events — OPEN/CLOSED trades come from the DB.
const SKIPPED_EVENTS = [
  parseAbiItem('event WatcherRequested(uint256 indexed requestId, bytes32 indexed vaultId)'),
  parseAbiItem('event WatcherResponse(uint256 indexed requestId, bytes32 indexed vaultId, address tokenOut, uint256 usdValue, uint256 tradeTimestamp)'),
  parseAbiItem('event TradeSkipped(bytes32 indexed vaultId, string reason)'),
] as const;

const client = createPublicClient({ chain: mantleSepolia, transport: http() });

const ADDRESS_TO_SYMBOL: Record<string, string> = {
  '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8': 'WMNT',
  '0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9': 'USDC',
  '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34': 'USDe',
  '0x201eba5cc46d216ce6dc03f6a759e8e766e956ae': 'USDT',
};

const symbolFor = (addr: string) =>
  ADDRESS_TO_SYMBOL[addr.toLowerCase()] ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;

const vaultIdFor = (follower: `0x${string}`, leader: `0x${string}`) =>
  keccak256(encodePacked(['address', 'address'], [follower, leader]));

// ── In-process cache (survives warm lambda re-use; discarded on cold start) ───
const globalForLogs = globalThis as unknown as {
  skippedLogs:      any[];
  lastSyncedBlock:  bigint;
  activeSyncPromise: Promise<void> | null;
};

if (!globalForLogs.skippedLogs) {
  globalForLogs.skippedLogs      = [];
  globalForLogs.lastSyncedBlock  = DEPLOY_BLOCK;
  globalForLogs.activeSyncPromise = null;
}

// ── Redis keys ────────────────────────────────────────────────────────────────
const REDIS_LOGS_KEY  = 'aether:trades:skippedLogs';
const REDIS_BLOCK_KEY = 'aether:trades:lastBlock';
const LOGS_TTL        = 86_400; // 24h

// ── Block timestamp cache (only used for SKIPPED trades without tradeTimestamp) ──
const blockTimeCache = new Map<string, number>();

async function getBlockTime(blockNumber: string): Promise<number> {
  if (blockTimeCache.has(blockNumber)) return blockTimeCache.get(blockNumber)!;
  try {
    const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
    const ts    = Number(block.timestamp);
    blockTimeCache.set(blockNumber, ts);
    return ts;
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

// Recursively converts BigInt fields (blockNumber, args.requestId, args.usdValue,
// args.tradeTimestamp, etc.) to strings so logs can be JSON-serialized for Redis.
function serializeLog(value: unknown): any {
  return JSON.parse(JSON.stringify(value, (_key, v) =>
    typeof v === 'bigint' ? v.toString() : v
  ));
}

// ── Sync skipped-trade logs (cold start: load from Redis, then scan delta) ───
async function syncSkippedLogs() {
  if (!VAULT_MANAGER) return;

  if (globalForLogs.activeSyncPromise) {
    await globalForLogs.activeSyncPromise;
    return;
  }

  globalForLogs.activeSyncPromise = (async () => {
    try {
      // Load persisted state from Redis on cold start
      if (globalForLogs.lastSyncedBlock === DEPLOY_BLOCK) {
        const [logsData, blockData] = await Promise.all([
          redis.get<any[]>(REDIS_LOGS_KEY),
          redis.get<string>(REDIS_BLOCK_KEY),
        ]);
        if (logsData)  globalForLogs.skippedLogs     = logsData;
        if (blockData) globalForLogs.lastSyncedBlock = BigInt(blockData);
        console.log(`[trades-sync] Loaded from Redis: ${globalForLogs.skippedLogs.length} logs, lastBlock=${globalForLogs.lastSyncedBlock}`);
      }

      const latest = await client.getBlockNumber();
      if (latest <= globalForLogs.lastSyncedBlock) return;

      console.log(`[trades-sync] Syncing blocks ${globalForLogs.lastSyncedBlock}→${latest}…`);

      let newLogs: any[] = [];
      for (let from = globalForLogs.lastSyncedBlock; from <= latest; from += 1000n) {
        const to    = from + 999n > latest ? latest : from + 999n;
        const chunk = await client.getLogs({
          address: VAULT_MANAGER,
          events:  SKIPPED_EVENTS,
          fromBlock: from,
          toBlock:   to,
        });
        newLogs = newLogs.concat(chunk.map(serializeLog));
      }

      globalForLogs.skippedLogs     = globalForLogs.skippedLogs.concat(newLogs);
      globalForLogs.lastSyncedBlock = latest;
      console.log(`[trades-sync] Sync done. Total skipped logs: ${globalForLogs.skippedLogs.length}`);

      // Persist to Redis so the next cold start loads quickly
      await Promise.all([
        redis.set(REDIS_LOGS_KEY,  globalForLogs.skippedLogs,                   { ex: LOGS_TTL }),
        redis.set(REDIS_BLOCK_KEY, globalForLogs.lastSyncedBlock.toString(),    { ex: LOGS_TTL }),
      ]).catch((err) => console.error('[trades-sync] Redis save failed:', err));

    } catch (err) {
      console.error('[trades-sync] Sync error:', err);
    } finally {
      globalForLogs.activeSyncPromise = null;
    }
  })();

  await globalForLogs.activeSyncPromise;
}

// GET /api/trades?address=0x...
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address          = searchParams.get('address')?.toLowerCase();
  if (!address) return NextResponse.json({ error: 'address query param required' }, { status: 400 });

  // 30-second Redis response cache per address
  const responseCacheKey = `aether:trades:result:${address}`;
  try {
    const cached = await redis.get<object>(responseCacheKey);
    if (cached) return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });
  } catch { /* non-fatal */ }

  // ── 1. Load OPEN + CLOSED trades from the DB (written by vault-listener) ──
  const [dbPositions, tokenPrices, vaults] = await Promise.all([
    prisma.position.findMany({
      where:   { follower: address },
      orderBy: { openedAt: 'desc' },
    }),
    prisma.tokenPrice.findMany(),
    prisma.userVault.findMany({ where: { follower: address } }),
  ]);

  const priceByToken: Record<string, number> = { USDC: 1.0, USDT: 1.0, USDe: 1.0 };
  for (const tp of tokenPrices) priceByToken[tp.token] = Number(tp.price);

  // Get WMNT price (for OPEN P&L)
  let wmntPrice = priceByToken['WMNT'] ?? 0.5;
  if (!priceByToken['WMNT']) {
    try { wmntPrice = await getWmntPrice(); } catch { /* use fallback */ }
  }

  // Build DB-backed trades
  const dbTrades = dbPositions.map((p) => {
    const entryPrice = Number(p.entryPrice);
    const alloc      = Number(p.ausdcAllocated);

    if (p.status === 'OPEN') {
      const currentPrice = priceByToken[p.token] ?? entryPrice;
      const pnl    = entryPrice > 0 ? (alloc * currentPrice) / entryPrice - alloc : 0;
      const pnlPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
      return {
        id:             p.onChainPositionId ?? p.id,
        leader:         p.leader,
        token:          p.token,
        ausdcAllocated: alloc,
        entryPrice,
        exitPrice:      null,
        pnl:            +pnl.toFixed(6),
        pnlPct:         +pnlPct.toFixed(2),
        status:         'OPEN' as const,
        reason:         null,
        closeReason:    null,
        openedAt:       p.openedAt.toISOString(),
        closedAt:       null,
        txHashOpen:     p.txHashOpen ?? null,
        txHashClose:    null,
      };
    }

    const exitPrice = Number(p.exitPrice ?? 0);
    const pnlPct    = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
    return {
      id:             p.onChainPositionId ?? p.id,
      leader:         p.leader,
      token:          p.token,
      ausdcAllocated: alloc,
      entryPrice,
      exitPrice:      exitPrice > 0 ? exitPrice : null,
      pnl:            Number(p.pnl ?? 0),
      pnlPct:         +pnlPct.toFixed(2),
      status:         'CLOSED' as const,
      reason:         null,
      closeReason:    p.closeReason ?? null,
      openedAt:       p.openedAt.toISOString(),
      closedAt:       p.closedAt?.toISOString() ?? null,
      txHashOpen:     p.txHashOpen  ?? null,
      txHashClose:    p.txHashClose ?? null,
    };
  });

  // ── 2. Load SKIPPED trades from logs ─────────────────────────────────────────

  if (vaults.length === 0) {
    const result = { trades: dbTrades };
    try { await redis.set(responseCacheKey, result, { ex: 30 }); } catch { /* non-fatal */ }
    return NextResponse.json(result);
  }

  await syncSkippedLogs();

  // Build set of this follower's vaultIds
  const vaultIds = new Set(
    vaults.map((v) =>
      vaultIdFor(address as `0x${string}`, v.leader.toLowerCase() as `0x${string}`).toLowerCase()
    )
  );
  const vaultIdToLeader: Record<string, string> = {};
  for (const v of vaults) {
    const vId = vaultIdFor(address as `0x${string}`, v.leader.toLowerCase() as `0x${string}`).toLowerCase();
    vaultIdToLeader[vId] = v.leader;
  }

  const relevant = globalForLogs.skippedLogs.filter((log) => {
    const vId = (log.args as { vaultId?: string }).vaultId?.toLowerCase();
    return vId && vaultIds.has(vId);
  });

  // Pre-fetch all unique block timestamps IN PARALLEL (avoids sequential RPC calls)
  // Only needed for WatcherRequested logs that lack a tradeTimestamp from WatcherResponse
  const blocksNeedingTime = new Set<string>();
  for (const log of relevant) {
    if (log.eventName === 'WatcherRequested' && log.blockNumber != null) {
      blocksNeedingTime.add(log.blockNumber);
    }
  }
  await Promise.all([...blocksNeedingTime].map((bn) => getBlockTime(bn)));

  // Process log stream per vault
  const skippedTrades: any[] = [];

  for (const vId of Array.from(vaultIds)) {
    const leader   = vaultIdToLeader[vId];
    const vaultLog = relevant
      .filter((l) => (l.args as { vaultId?: string }).vaultId?.toLowerCase() === vId)
      .sort((a, b) =>
        a.blockNumber !== b.blockNumber
          ? Number(a.blockNumber!) - Number(b.blockNumber!)
          : a.logIndex! - b.logIndex!
      );

    let cur: any = null;

    for (const log of vaultLog) {
      const args = log.args as any;
      switch (log.eventName) {
        case 'WatcherRequested':
          cur = {
            id:             args.requestId.toString(),
            leader,
            token:          'WMNT',
            ausdcAllocated: 0,
            entryPrice:     0,
            exitPrice:      null,
            pnl:            0,
            pnlPct:         0,
            status:         'PENDING',
            reason:         null,
            openedAt:       new Date(getBlockTime_sync(log.blockNumber!) * 1000).toISOString(),
            closedAt:       null,
            txHashOpen:     log.transactionHash,
            txHashClose:    null,
          };
          break;

        case 'WatcherResponse':
          if (cur) {
            // Use the leader's actual trade timestamp from the event — no extra RPC call
            cur.openedAt = new Date(Number(args.tradeTimestamp as bigint) * 1000).toISOString();
            cur.token    = symbolFor(args.tokenOut);
          }
          break;

        case 'TradeSkipped':
          if (cur && cur.status === 'PENDING') {
            cur.status     = 'SKIPPED';
            cur.reason     = args.reason;
            cur.txHashOpen = log.transactionHash;
            skippedTrades.push(cur);
            cur = null;
          }
          break;
      }
    }
  }

  // ── 3. Merge and sort ─────────────────────────────────────────────────────────
  const all = [...dbTrades, ...skippedTrades].filter((t) => t.status !== 'PENDING');
  all.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());

  const result = { trades: all };
  try { await redis.set(responseCacheKey, result, { ex: 30 }); } catch { /* non-fatal */ }

  return NextResponse.json(result);
}

// Synchronous block time lookup (only for already-prefetched entries)
function getBlockTime_sync(blockNumber: string): number {
  return blockTimeCache.get(blockNumber) ?? Math.floor(Date.now() / 1000);
}
