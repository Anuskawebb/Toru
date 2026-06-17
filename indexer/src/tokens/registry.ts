// ── Well-known BSC token metadata ────────────────────────────────────────────
// Note: All major BEP-20 stablecoins on BSC use 18 decimals (unlike Ethereum).
//
// This is a fast-path cache only. For tokens not listed here, resolveTokenMeta
// in cache/token-cache.ts fetches symbol() and decimals() from the contract.

export interface TokenMeta {
  symbol: string;
  decimals: number;
}

const REGISTRY: Record<string, TokenMeta> = {
  // Wrapped native
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { symbol: 'WBNB',  decimals: 18 },

  // Stablecoins
  '0x55d398326f99059ff775485246999027b3197955': { symbol: 'USDT',  decimals: 18 },
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { symbol: 'USDC',  decimals: 18 },
  '0xe9e7cea3dedca5984780bafc599bd69add087d56': { symbol: 'BUSD',  decimals: 18 },
  '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': { symbol: 'DAI',   decimals: 18 },

  // Blue-chips
  '0x2170ed0880ac9a755fd29b2688956bd959f933f8': { symbol: 'ETH',   decimals: 18 },
  '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c': { symbol: 'BTCB',  decimals: 18 },

  // DeFi
  '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82': { symbol: 'CAKE',  decimals: 18 },
  '0x3ee2200efb3400fabb9aacf31297cbdd1d435d47': { symbol: 'ADA',   decimals: 18 },
  '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd': { symbol: 'LINK',  decimals: 18 },
  '0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe': { symbol: 'XRP',   decimals: 18 },
  '0x8ff795a6f4d97e7887c79bea79aba5cc76444adf': { symbol: 'BCH',   decimals: 18 },
  '0x7083609fce4d1d8dc0c979aab8c869ea2c873402': { symbol: 'DOT',   decimals: 18 },
};

/**
 * Synchronous lookup against the static registry.
 * Returns null for tokens not in the list — callers should fall back to
 * resolveTokenMeta() in cache/token-cache.ts for on-chain resolution.
 */
export function lookupStatic(address: `0x${string}`): TokenMeta | null {
  return REGISTRY[address.toLowerCase()] ?? null;
}

/** Format a raw bigint amount into a human-readable decimal string. */
export function formatAmount(raw: bigint, decimals: number): string {
  if (raw === 0n) return '0';

  const divisor = 10n ** BigInt(decimals);
  const whole   = raw / divisor;
  const frac    = raw % divisor;

  if (frac === 0n) return whole.toString();

  // Left-pad fractional part, then trim trailing zeros, cap at 6 places
  const fracStr = frac
    .toString()
    .padStart(decimals, '0')
    .slice(0, 6)
    .replace(/0+$/, '');

  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}
