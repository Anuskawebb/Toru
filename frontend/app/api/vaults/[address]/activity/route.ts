import { NextResponse }    from 'next/server';
import { createPublicClient, http, keccak256, encodePacked, parseAbiItem } from 'viem';
import { mantleSepolia }   from '@/config/chains';
import { prisma }            from '@/lib/prisma';
import { explainTrade }      from '@/lib/explainTrade';
import { createNotification } from '@/lib/notifications';
import { sendTradeOpenedEmail } from '@/lib/email';
import { redis }             from '@/lib/redis';

// GET /api/vaults/[address]/activity?leader=0x...
//
// Reconstructs the on-chain agent-pipeline activity for a single
// (follower, leader) vault — every "tried trade" the watcher kicked off,
// and how it resolved (opened a position, or was skipped and why).
// There's no DB mirror of these events, so we read VaultManager's logs
// directly — same pattern as the keeper's on-chain position lookups.

const VAULT_MANAGER = (process.env.NEXT_PUBLIC_VAULT_MANAGER_ADDRESS ?? '') as `0x${string}`;

// Block the current VaultManager (0xEA364c...92efc) was deployed at on Mantle
// Sepolia — pipeline events can't exist before this, so there's no need to
// scan further back.
const DEPLOY_BLOCK = 39981447n;

const ADDRESS_TO_SYMBOL: Record<string, string> = {
  '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8': 'WMNT',
  '0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9': 'USDC',
  '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34': 'USDe',
  '0x201eba5cc46d216ce6dc03f6a759e8e766e956ae': 'USDT',
};

const symbolFor = (addr: string) =>
  ADDRESS_TO_SYMBOL[addr.toLowerCase()] ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;

const EVENTS = [
  parseAbiItem('event WatcherRequested(uint256 indexed requestId, bytes32 indexed vaultId)'),
  parseAbiItem('event WatcherResponse(uint256 indexed requestId, bytes32 indexed vaultId, address tokenOut, uint256 usdValue, uint256 tradeTimestamp)'),
  parseAbiItem('event StrategistResponse(uint256 indexed requestId, bytes32 indexed vaultId, uint8 score, bool willExecute)'),
  parseAbiItem('event TradeSkipped(bytes32 indexed vaultId, string reason)'),
  parseAbiItem('event PositionOpened(bytes32 indexed positionId, bytes32 indexed vaultId, address token, uint256 ausdAllocated, uint256 entryPrice)'),
] as const;

const client = createPublicClient({ chain: mantleSepolia, transport: http() });

// Mirrors the on-chain vaultId(follower, leader) = keccak256(abi.encodePacked(follower, leader))
const vaultIdFor = (follower: `0x${string}`, leader: `0x${string}`) =>
  keccak256(encodePacked(['address', 'address'], [follower, leader]));

type Attempt = {
  requestId:     string;
  txHash:        string | null;
  detectedAt:    string | null;
  token:         string | null;
  usdValue:      number | null;
  score:         number | null;
  status:        'pending' | 'skipped' | 'opened';
  reason:        string | null;
  ausdAllocated: number | null;
  entryPrice:    number | null;
  explanation:   string | null;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address }  = await params;
  const leaderParam  = new URL(req.url).searchParams.get('leader');

  if (!leaderParam) {
    return NextResponse.json({ error: 'leader query param required' }, { status: 400 });
  }
  if (!VAULT_MANAGER) {
    return NextResponse.json({ error: 'VaultManager address not configured' }, { status: 500 });
  }

  const follower = address.toLowerCase()     as `0x${string}`;
  const leader   = leaderParam.toLowerCase() as `0x${string}`;
  const vaultId  = vaultIdFor(follower, leader);

  // ── Response cache (30s) — avoids re-scanning logs on every page load ────
  const cacheKey = `aether:activity:${follower}:${leader}`;
  const cached   = await redis.get(cacheKey);
  if (cached) return NextResponse.json(cached);

  const latest = await client.getBlockNumber();

  // RPC caps getLogs at a 1000-block range — page through in chunks.
  // (Cast to `any[]` — viem's multi-event `getLogs` union type doesn't
  // narrow `args`/`eventName` cleanly, and we discriminate by hand below.)
  let logs: any[] = [];
  for (let from = DEPLOY_BLOCK; from <= latest; from += 1000n) {
    const to = from + 999n > latest ? latest : from + 999n;
    logs = logs.concat(
      await client.getLogs({ address: VAULT_MANAGER, events: EVENTS, fromBlock: from, toBlock: to })
    );
  }

  const relevant = logs
    .filter((log) => (log.args as { vaultId?: string }).vaultId?.toLowerCase() === vaultId)
    .sort((a, b) =>
      a.blockNumber !== b.blockNumber
        ? Number(a.blockNumber! - b.blockNumber!)
        : a.logIndex! - b.logIndex!
    );

  // Each pipeline run starts at `WatcherRequested` and ends at either
  // `TradeSkipped` or `PositionOpened` — anchor "attempts" there so failure
  // modes with no `WatcherResponse` (e.g. "watcher request failed") still show.
  const attempts: Attempt[] = [];
  let current: Attempt | null = null;

  for (const log of relevant) {
    const args = log.args as Record<string, unknown>;
    switch (log.eventName) {
      case 'WatcherRequested':
        current = {
          requestId:     (args.requestId as bigint).toString(),
          txHash:        log.transactionHash,
          detectedAt:    null,
          token:         null,
          usdValue:      null,
          score:         null,
          status:        'pending',
          reason:        null,
          ausdAllocated: null,
          entryPrice:    null,
          explanation:   null,
        };
        attempts.push(current);
        break;

      case 'WatcherResponse':
        if (current) {
          current.detectedAt = new Date(Number(args.tradeTimestamp as bigint) * 1000).toISOString();
          current.token      = symbolFor(args.tokenOut as string);
          current.usdValue   = Number(args.usdValue as bigint) / 1e6;
        }
        break;

      case 'StrategistResponse':
        if (current) current.score = Number(args.score as number);
        break;

      case 'TradeSkipped':
        if (current && current.status === 'pending') {
          current.status  = 'skipped';
          current.reason  = args.reason as string;
          // Point the explorer link at the tx that actually carries the
          // "why" (the resolving callback), not the kickoff tx.
          current.txHash  = log.transactionHash;
        }
        break;

      case 'PositionOpened':
        if (current && current.status === 'pending') {
          current.status        = 'opened';
          current.token         = symbolFor(args.token as string);
          current.ausdAllocated = Number(args.ausdAllocated as bigint) / 1e6;
          current.entryPrice    = Number(args.entryPrice as bigint) / 1e10;
          current.txHash        = log.transactionHash;
        }
        break;
    }
  }

  // Notify the follower the first time we see each opened position. The
  // activity feed has no DB mirror (reconstructed from logs on every view),
  // so dedupe on requestId — re-detecting the same PositionOpened on a later
  // poll upserts onto the existing notification instead of duplicating it.
  await Promise.all(
    attempts
      .filter((a) => a.status === 'opened')
      .map(async (a) => {
        const dedupeKey = `trade-opened:${a.requestId}`;
        const seenBefore = await prisma.notification.findUnique({ where: { dedupeKey } });

        await createNotification({
          recipient: follower,
          type:      'TRADE_OPENED',
          actor:     leader,
          message:   a.token
            ? `Your agent opened a ${a.token} position copying ${leader.slice(0, 6)}…${leader.slice(-4)}${a.ausdAllocated != null ? ` · ${a.ausdAllocated.toFixed(2)} aUSD` : ''}`
            : `Your agent opened a new position copying ${leader.slice(0, 6)}…${leader.slice(-4)}`,
          metadata:  { token: a.token, ausdAllocated: a.ausdAllocated, entryPrice: a.entryPrice, txHash: a.txHash },
          dedupeKey,
        }).catch((err) => console.error('[activity API] Failed to create trade notification:', err));

        // Only email on the first sighting of this position — the activity
        // feed is reconstructed from logs on every poll, so without this
        // check we'd re-send the email each time the page is refreshed.
        if (!seenBefore) {
          const profile = await prisma.followerProfile.findUnique({ where: { follower } }).catch(() => null);
          if (profile?.email && profile.notifications) {
            await sendTradeOpenedEmail(profile.email, {
              leader,
              token:         a.token,
              ausdAllocated: a.ausdAllocated,
              entryPrice:    a.entryPrice,
              txHash:        a.txHash,
            }).catch((err) => console.error('[activity API] Failed to send trade-opened email:', err));
          }
        }
      })
  );

  // Fetch follower configuration settings
  let riskLevel = 3;
  let maxPerTradePct = 20;
  let limits = {
    slippageBps:       100,
    minLeaderTradeUsd: 0,
    maxLeaderTradeUsd: 0,
    minAllocUsd:       0,
    maxAllocUsd:       0,
  };
  try {
    const vault = await prisma.userVault.findUnique({
      where: {
        follower_leader: {
          follower: follower.toLowerCase(),
          leader: leader.toLowerCase(),
        },
      },
    });
    if (vault) {
      riskLevel = vault.riskLevel;
      maxPerTradePct = vault.maxPerTradePct;
      limits = {
        slippageBps:       vault.slippageBps,
        minLeaderTradeUsd: Number(vault.minLeaderTradeUsd),
        maxLeaderTradeUsd: Number(vault.maxLeaderTradeUsd),
        minAllocUsd:       Number(vault.minAllocUsd),
        maxAllocUsd:       Number(vault.maxAllocUsd),
      };
    }
  } catch (err) {
    console.error('[activity API] Failed to fetch UserVault details:', err);
  }

  // Generate and attach explanations in parallel.
  // Wrapped per-item so a single failure doesn't wipe all explanations.
  const populatedAttempts = await Promise.all(
    attempts.reverse().map(async (a) => {
      let explanation: string | null = null;
      if (a.status === 'opened' || a.status === 'skipped') {
        try {
          explanation = await explainTrade(a, riskLevel, maxPerTradePct, limits);
          // explainTrade always returns a string — guard against empty-string cache entries
          if (!explanation) explanation = null;
        } catch (err) {
          console.error(`[activity API] explainTrade failed for requestId=${a.requestId}:`, err);
        }
      }
      console.log(`[activity API] attempt requestId=${a.requestId} status=${a.status} explanation=${explanation ? explanation.slice(0, 60) + '…' : 'null'}`);
      return { ...a, explanation };
    })
  );

  const response = { vaultId, attempts: populatedAttempts };
  await redis.set(cacheKey, response, { ex: 30 });
  return NextResponse.json(response);
}
