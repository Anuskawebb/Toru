import 'dotenv/config';
import { defineChain } from 'viem';

// ── Chains ────────────────────────────────────────────────────────────────────

// Mantle Mainnet — where leader activity is observed (Agni Finance pools)
export const mantleMainnet = defineChain({
  id: 5000,
  name: 'Mantle',
  nativeCurrency: { decimals: 18, name: 'MNT', symbol: 'MNT' },
  rpcUrls: {
    default: { http: ['https://rpc.mantle.xyz'] },
  },
});

// Mantle Sepolia Testnet — where VaultManager lives
export const mantleSepolia = defineChain({
  id: 5003,
  name: 'Mantle Sepolia Testnet',
  nativeCurrency: { decimals: 18, name: 'MNT', symbol: 'MNT' },
  rpcUrls: {
    default: { http: ['https://rpc.sepolia.mantle.xyz'] },
  },
});

// ── Tokens (Mantle Mainnet) ───────────────────────────────────────────────────
// Same addresses as frontend/config/tokens.ts MAINNET_TOKENS — VaultManager on
// Mantle Sepolia uses these as keys in its latestPrice mapping and allowlist.

export const TOKENS = {
  USDe: { address: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34' as `0x${string}`, symbol: 'USDe', decimals: 18, isStable: true  },
  WMNT: { address: '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8' as `0x${string}`, symbol: 'WMNT', decimals: 18, isStable: false },
  USDC: { address: '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9' as `0x${string}`, symbol: 'USDC', decimals: 6,  isStable: true  },
  USDT: { address: '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE' as `0x${string}`, symbol: 'USDT', decimals: 6,  isStable: true  },
  WETH: { address: '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111' as `0x${string}`, symbol: 'WETH', decimals: 18, isStable: false },
  METH: { address: '0xcDA86A272531e8640cD7F1a92c01839911B90bb0' as `0x${string}`, symbol: 'mETH', decimals: 18, isStable: false },
} as const;

export type TokenDef = typeof TOKENS[keyof typeof TOKENS];

// ── Pool definitions ──────────────────────────────────────────────────────────

export type DexId = 'agni-v3' | 'fusionx-v3';

export interface PoolDef {
  address:  `0x${string}`;
  token0:   TokenDef;
  token1:   TokenDef;
  // Symbol of the non-stable "base" token for this pool (used for BUY/SELL labelling)
  baseSymbol: string;
  // Which DEX/AMM this pool belongs to — determines the Swap event ABI used.
  dex: DexId;
}

// All tracked pools follow the token0=$1-stable / token1=WMNT layout
// (an address-sort coincidence: stable token addresses sort below WMNT's).
//
// Agni Finance (Algebra V3 fork) — verified active on-chain.
// token0=USDe (18 dec, $1-pegged stable), token1=WMNT (18 dec, volatile)
//
// FusionX V3 (standard Uniswap V3 fork) — WMNT/USDT and USDC/WMNT pools.
export const POOLS: PoolDef[] = [
  {
    address:    '0xeAfc4D6d4c3391Cd4Fc10c85D2f5f972d58C0dD5',
    token0:     TOKENS.USDe,
    token1:     TOKENS.WMNT,
    baseSymbol: 'WMNT',
    dex:        'agni-v3',
  },
  {
    address:    '0x262255F4770aEbE2D0C8b97a46287dCeCc2a0AfF',
    token0:     TOKENS.USDT,
    token1:     TOKENS.WMNT,
    baseSymbol: 'WMNT',
    dex:        'fusionx-v3',
  },
  {
    address:    '0xe87E42ff34d6baAF619eB91dd957e4EC45226894',
    token0:     TOKENS.USDC,
    token1:     TOKENS.WMNT,
    baseSymbol: 'WMNT',
    dex:        'fusionx-v3',
  },
  // WETH/mETH pools — same token0=USDT(6 dec) / token1=volatile(18 dec) layout.
  {
    address:    '0x425732f412F2A922156cF3C135a516c18F977Cc1',
    token0:     TOKENS.USDT,
    token1:     TOKENS.WETH,
    baseSymbol: 'WETH',
    dex:        'agni-v3',
  },
  {
    address:    '0xA125AF1A4704044501Fe12Ca9567eF1550E430e8',
    token0:     TOKENS.USDT,
    token1:     TOKENS.WETH,
    baseSymbol: 'WETH',
    dex:        'fusionx-v3',
  },
  {
    address:    '0xefe8bfd40352B9c14b64c06F5e699b3D46cA4ffC',
    token0:     TOKENS.USDT,
    token1:     TOKENS.METH,
    baseSymbol: 'mETH',
    dex:        'fusionx-v3',
  },
  // WMNT-anchored pool — token0=WMNT (priced via live oracle, not $1-stable),
  // token1=WETH. Users depositing MNT swap directly through pools like this.
  {
    address:    '0x9Ec313FF05946b6f3860A99B470625aBba7Eb0a2',
    token0:     TOKENS.WMNT,
    token1:     TOKENS.WETH,
    baseSymbol: 'WETH',
    dex:        'agni-v3',
  },
];

// Kept for copy-engine — the single tracked pool's token pair
export const POOL = {
  token0: TOKENS.USDe,
  token1: TOKENS.WMNT,
} as const;

// ── On-chain keeper config ────────────────────────────────────────────────────

export const VAULT_MANAGER_ADDRESS = (process.env.VAULT_MANAGER_ADDRESS ?? '') as `0x${string}`;
export const KEEPER_PRIVATE_KEY    = (process.env.KEEPER_PRIVATE_KEY    ?? '') as `0x${string}`;

// ── Copy-trade config ─────────────────────────────────────────────────────────

export const DEFAULT_COPY_PCT = Number(process.env.DEFAULT_COPY_PCT ?? 20);
export const STALE_BUY_MS     = 10_000; // skip BUYs older than 10s
