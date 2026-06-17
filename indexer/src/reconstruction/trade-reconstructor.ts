import { logger } from '../logger.js';
import type { RawSwap, RawEvent, NormalizedTrade } from '../types/index.js';

// WBNB address — represents native BNB in normalised trades (V4 BNB pools have
// no ERC-20 Transfer for the BNB leg, so we use WBNB as the canonical address).
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c' as `0x${string}`;

// ERC-20 Transfer(address indexed from, address indexed to, uint256 value)
const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Erc20Transfer {
  token:  `0x${string}`;
  from:   `0x${string}`;
  to:     `0x${string}`;
  amount: bigint;
}

function extractTransfers(events: readonly RawEvent[]): Erc20Transfer[] {
  const result: Erc20Transfer[] = [];
  for (const e of events) {
    if (e.topics[0] !== ERC20_TRANSFER_TOPIC || e.topics.length < 3) continue;
    const fromTopic = e.topics[1];
    const toTopic   = e.topics[2];
    if (fromTopic === undefined || toTopic === undefined) continue;
    let amount: bigint;
    try { amount = BigInt(e.data); } catch { continue; }
    result.push({
      token:  e.contractAddress,
      from:   `0x${fromTopic.slice(26)}` as `0x${string}`,
      to:     `0x${toTopic.slice(26)}`   as `0x${string}`,
      amount,
    });
  }
  return result;
}

function makeNormalized(
  raw: RawSwap,
  tokenIn:  `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn:  bigint,
  amountOut: bigint,
): NormalizedTrade {
  return {
    txHash:           raw.txHash,
    blockNumber:      raw.blockNumber,
    blockTimestampMs: raw.blockTimestampMs,
    wallet:           raw.wallet,
    pairAddress:      raw.contractAddress,
    dex:              raw.dex,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
  };
}

// ── Strategy A: known token pair (V2 and V3) ──────────────────────────────────
//
// amount0/amount1 are in unified swapper perspective (positive = received).
// Exactly one should be positive (tokenOut) and one negative (tokenIn).

function fromPair(
  raw: RawSwap,
  token0: `0x${string}`,
  token1: `0x${string}`,
): NormalizedTrade | null {
  const { amount0, amount1 } = raw;

  if (amount0 < 0n && amount1 > 0n) {
    // User sent token0, received token1
    return makeNormalized(raw, token0, token1, -amount0, amount1);
  }
  if (amount0 > 0n && amount1 < 0n) {
    // User received token0, sent token1
    return makeNormalized(raw, token1, token0, -amount1, amount0);
  }

  // Both same sign → flash swap or degenerate; skip
  logger.debug('Skipping swap with invalid signed amounts', {
    txHash:  raw.txHash,
    amount0: amount0.toString(),
    amount1: amount1.toString(),
    dex:     raw.dex,
  });
  return null;
}

// ── Strategy B: Transfer-based derivation (V4) ────────────────────────────────
//
// V4 PoolManager does not expose token addresses on the pool. Instead we read
// ERC-20 Transfer events in the same receipt:
//   Transfer from wallet → wallet is selling that token (tokenIn)
//   Transfer to wallet   → wallet is receiving that token (tokenOut)
//
// Native BNB fallback: BNB has no ERC-20 Transfer, so one side may be absent.
// We use the signed Swap amounts to determine the BNB quantity.

function fromTransfers(raw: RawSwap): NormalizedTrade | null {
  const walletLow = raw.wallet.toLowerCase();
  const transfers = extractTransfers(raw.siblingEvents);

  const sent = transfers.filter((t) => t.from.toLowerCase() === walletLow && t.amount > 0n);
  const recv = transfers.filter((t) => t.to.toLowerCase() === walletLow && t.amount > 0n);

  // Both sides are ERC-20
  if (sent.length > 0 && recv.length > 0) {
    const tin  = sent[0];
    const tout = recv[recv.length - 1];
    if (tin === undefined || tout === undefined) return null;
    if (tin.token.toLowerCase() === tout.token.toLowerCase()) return null;
    return makeNormalized(raw, tin.token, tout.token, tin.amount, tout.amount);
  }

  // User sent native BNB, received ERC-20
  // Negative Swap amount = BNB the swapper sent (swapper perspective)
  if (sent.length === 0 && recv.length > 0) {
    const bnbIn =
      raw.amount0 < 0n ? -raw.amount0 :
      raw.amount1 < 0n ? -raw.amount1 : null;
    if (bnbIn === null || bnbIn === 0n) return null;
    const tout = recv[recv.length - 1];
    if (tout === undefined) return null;
    return makeNormalized(raw, WBNB, tout.token, bnbIn, tout.amount);
  }

  // User sent ERC-20, received native BNB
  // Positive Swap amount = BNB the swapper received (swapper perspective)
  if (recv.length === 0 && sent.length > 0) {
    const bnbOut =
      raw.amount0 > 0n ? raw.amount0 :
      raw.amount1 > 0n ? raw.amount1 : null;
    if (bnbOut === null || bnbOut === 0n) return null;
    const tin = sent[0];
    if (tin === undefined) return null;
    return makeNormalized(raw, tin.token, WBNB, tin.amount, bnbOut);
  }

  logger.warn('Trade reconstruction failed — no Transfer events match wallet', {
    txHash: raw.txHash,
    dex:    raw.dex,
  });
  return null;
}

function resolveV4Tokens(raw: RawSwap): { token0: `0x${string}`; token1: `0x${string}` } | null {
  const transfers = extractTransfers(raw.siblingEvents);

  const abs0 = raw.amount0 < 0n ? -raw.amount0 : raw.amount0;
  const abs1 = raw.amount1 < 0n ? -raw.amount1 : raw.amount1;

  let token0: `0x${string}` | null = null;
  let token1: `0x${string}` | null = null;

  for (const t of transfers) {
    if (t.amount === abs0 && token0 === null) {
      token0 = t.token;
    }
    if (t.amount === abs1 && token1 === null) {
      token1 = t.token;
    }
  }

  // Fallback if one of the legs is native BNB (which has no ERC-20 Transfer event)
  if (token0 === null && abs0 > 0n) {
    token0 = WBNB;
  }
  if (token1 === null && abs1 > 0n) {
    token1 = WBNB;
  }

  if (token0 !== null && token1 !== null) {
    return { token0, token1 };
  }
  return null;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Converts a protocol-neutral RawSwap into a NormalizedTrade.
 *
 * Routing:
 *   token0 + token1 present → fromPair  (V2, V3)
 *   absent                  → Resolve using Transfer matching, else fallback to fromTransfers
 */
export function reconstructTrade(raw: RawSwap): NormalizedTrade | null {
  if (raw.token0 !== undefined && raw.token1 !== undefined) {
    return fromPair(raw, raw.token0, raw.token1);
  }

  const resolved = resolveV4Tokens(raw);
  if (resolved !== null) {
    return fromPair(raw, resolved.token0, resolved.token1);
  }

  return fromTransfers(raw);
}
