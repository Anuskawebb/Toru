import { bscClient } from '../chains/bsc.js';
import { logger } from '../logger.js';

// ── ABI ───────────────────────────────────────────────────────────────────────

const PAIR_ABI = [
  {
    name: 'token0',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'token1',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

// ── Cache ─────────────────────────────────────────────────────────────────────

export interface TokenPair {
  token0: `0x${string}`;
  token1: `0x${string}`;
}

// In-flight promises keyed by pair address, so concurrent lookups of the same
// pair coalesce into a single RPC call instead of N identical requests.
const inflight = new Map<string, Promise<TokenPair>>();
const resolved = new Map<string, TokenPair>();

/**
 * Returns the token0/token1 addresses for a PancakeSwap V2 pair.
 * Results are cached in memory for the lifetime of the process.
 */
export async function getTokenPair(pairAddress: `0x${string}`): Promise<TokenPair> {
  const key = pairAddress.toLowerCase();

  const cached = resolved.get(key);
  if (cached !== undefined) return cached;

  const pending = inflight.get(key);
  if (pending !== undefined) return pending;

  const promise = fetchPair(pairAddress, key);
  inflight.set(key, promise);
  return promise;
}

async function fetchPair(pairAddress: `0x${string}`, key: string): Promise<TokenPair> {
  try {
    logger.debug('Fetching token pair', { pair: pairAddress });

    const [token0, token1] = await Promise.all([
      bscClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token0' }),
      bscClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token1' }),
    ]);

    const pair: TokenPair = { token0, token1 };
    resolved.set(key, pair);
    return pair;
  } finally {
    inflight.delete(key);
  }
}

/** Returns how many pairs are currently cached (useful for logging). */
export function pairCacheSize(): number {
  return resolved.size;
}
