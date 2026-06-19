import { bscClient } from '../chains/bsc.js';
import { lookupStatic } from '../tokens/registry.js';
import { logger } from '../logger.js';
import type { TokenMeta } from '../tokens/registry.js';

// ── ERC-20 ABI (symbol + decimals only) ──────────────────────────────────────

const ERC20_ABI = [
  {
    name: 'symbol',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'decimals',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

// ── Cache ─────────────────────────────────────────────────────────────────────

// In-flight promises keyed by lowercase address — concurrent lookups of the
// same token coalesce into a single RPC call.
const inflight = new Map<string, Promise<TokenMeta>>();
const resolved = new Map<string, TokenMeta>();

/**
 * Resolves symbol and decimals for any BEP-20 token address.
 *
 * Resolution order:
 *   1. Static registry  (zero RPC cost, instant)
 *   2. In-memory cache  (populated by prior calls)
 *   3. On-chain via readContract  (symbol() + decimals() in parallel)
 *   4. Fallback: truncated address + 18 decimals  (non-standard tokens)
 */
export async function resolveTokenMeta(address: `0x${string}`): Promise<TokenMeta> {
  const key = address.toLowerCase();

  // 1. Static registry
  const known = lookupStatic(address);
  if (known !== null) return known;

  // 2. Memory cache
  const cached = resolved.get(key);
  if (cached !== undefined) return cached;

  // 3. Coalesce concurrent requests for the same address
  const pending = inflight.get(key);
  if (pending !== undefined) return pending;

  const promise = fetchFromChain(address, key);
  inflight.set(key, promise);
  return promise;
}

async function fetchFromChain(address: `0x${string}`, key: string): Promise<TokenMeta> {
  try {
    logger.debug('Fetching ERC-20 metadata from chain', { address });

    const [symbol, decimals] = await Promise.all([
      bscClient.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }),
      bscClient.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }),
    ]);

    const meta: TokenMeta = { symbol, decimals };
    resolved.set(key, meta);
    return meta;
  } catch {
    // Token has non-standard ABI (bytes32 symbol, missing function, proxy, etc.)
    // Use a truncated address so output is still identifiable.
    const meta: TokenMeta = {
      symbol:   address.slice(0, 8) + '…',
      decimals: 18,
    };
    logger.debug('ERC-20 metadata unavailable — using address stub', { address });
    resolved.set(key, meta);
    return meta;
  } finally {
    inflight.delete(key);
  }
}

/** Number of token addresses currently in the resolved cache. */
export function tokenCacheSize(): number {
  return resolved.size;
}
