import { bscClient } from '../chains/bsc.js';
import { logger } from '../logger.js';

// ── ABI ───────────────────────────────────────────────────────────────────────

const POOL_ABI = [
  {
    name: 'factory',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

// ── Cache ─────────────────────────────────────────────────────────────────────

// In-flight promises keyed by pool address, so concurrent lookups of the same
// pool coalesce into a single RPC call instead of N identical requests.
const inflight = new Map<string, Promise<`0x${string}`>>();
const resolved = new Map<string, `0x${string}`>();

/**
 * Returns the deploying factory address for a pool/pair contract.
 * Results are cached in memory for the lifetime of the process.
 */
export async function getPoolFactory(poolAddress: `0x${string}`): Promise<`0x${string}`> {
  const key = poolAddress.toLowerCase();

  const cached = resolved.get(key);
  if (cached !== undefined) return cached;

  const pending = inflight.get(key);
  if (pending !== undefined) return pending;

  const promise = fetchFactory(poolAddress, key);
  inflight.set(key, promise);
  return promise;
}

async function fetchFactory(poolAddress: `0x${string}`, key: string): Promise<`0x${string}`> {
  try {
    logger.debug('Fetching pool factory', { pool: poolAddress });

    const factory = await bscClient.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'factory',
    });

    const normalized = factory.toLowerCase() as `0x${string}`;
    resolved.set(key, normalized);
    return normalized;
  } finally {
    inflight.delete(key);
  }
}

/** Returns how many pool factories are currently cached. */
export function factoryCacheSize(): number {
  return resolved.size;
}
