/**
 * CMC Agent Hub client with x402 micropayment support.
 *
 * x402 protocol: agent wallet pays $0.01 USDC on Base per request — no API key needed.
 * Payment is verifiable on-chain proof that the agent autonomously buys intelligence.
 *
 * Payment details (from CMC Agent Hub docs):
 *   Network:  Base (chain ID 8453)
 *   Token:    USDC on Base — 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   Amount:   $0.01 per request
 *   Endpoint: https://pro-api.coinmarketcap.com/x402/...
 *
 * Available x402 paths:
 *   GET /x402/v3/cryptocurrency/quotes/latest    — live token prices
 *   GET /x402/v3/cryptocurrency/listings/latest  — top tokens (sortable by gainers)
 *   GET /x402/v4/dex/pairs/quotes/latest         — DEX pair prices (BSC pairs!)
 *   GET /x402/v1/dex/search                      — search DEX pairs
 *
 * Flow per request:
 *   1. Send request to CMC x402 endpoint (no API key header)
 *   2. CMC returns 402 with payment details (amount, payTo address, network)
 *   3. TWAK sends USDC from agent wallet on Base to CMC's payment address
 *   4. Retry with X-Payment proof header containing the tx hash
 *   5. CMC returns data
 *
 * Falls back to standard CMC_API_KEY for Fear & Greed (not in x402 catalogue).
 * All x402 calls fall back to API key if TWAK sidecar is unreachable.
 */

import { TwakClient } from '../execution/twak/twak-client.js';

const CMC_BASE        = 'https://pro-api.coinmarketcap.com';
const BASE_CHAIN      = 'base';
const USDC_ON_BASE    = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// $0.01 USDC = 10000 in 6-decimal units
const USDC_PER_REQUEST = '10000';

// ── x402 protocol types ──────────────────────────────────────────────────────

interface X402Accept {
  scheme:             string;   // "exact"
  network:            string;   // "base-mainnet"
  maxAmountRequired:  string;   // USDC in 6-decimal units (e.g. "10000" = $0.01)
  payTo:              string;   // CMC's USDC payment address on Base
  asset:              string;   // USDC contract address
  resource:           string;   // the URL being purchased
  maxTimeoutSeconds?: number;
}

interface X402PaymentRequired {
  x402Version: number;
  accepts:     X402Accept[];
  error?:      string;
}

interface X402PaymentProof {
  x402Version: number;
  scheme:      string;
  network:     string;
  payload: {
    from:   string;
    to:     string;
    txHash: string;
    amount: string;
    asset:  string;
  };
}

// ── core x402 fetch ──────────────────────────────────────────────────────────

async function fetchWithX402(
  path:        string,
  params:      Record<string, string | number>,
  agentWallet: string,
  twakClient:  TwakClient,
): Promise<unknown | null> {
  const qs  = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const url = `${CMC_BASE}${path}?${qs}`;

  // Step 1 — initial request with no API key (x402 flow)
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  } catch (e) {
    console.warn(`[x402] Initial fetch failed:`, e instanceof Error ? e.message : e);
    return null;
  }

  // Already got data (endpoint doesn't require payment, or cached)
  if (res.ok) return res.json();

  if (res.status !== 402) {
    console.warn(`[x402] Unexpected status ${res.status} for ${path}`);
    return null;
  }

  // Step 2 — parse payment requirements from 402 response
  let payReq: X402PaymentRequired;
  try {
    payReq = await res.json() as X402PaymentRequired;
  } catch {
    console.warn('[x402] Could not parse 402 body');
    return null;
  }

  const accept = payReq.accepts?.find(a => a.network.includes('base')) ?? payReq.accepts?.[0];
  if (!accept) {
    console.warn('[x402] No Base payment scheme offered');
    return null;
  }

  // Amount in human-readable USDC (6 decimals)
  const usdcAmount = (Number(accept.maxAmountRequired) / 1e6).toFixed(6);
  console.log(`[x402] Paying $${usdcAmount} USDC on Base from ${agentWallet.slice(0, 10)}... → ${accept.payTo.slice(0, 10)}...`);

  // Step 3 — TWAK sends USDC on Base from agent wallet
  let txHash: string;
  try {
    const payment = await twakClient.transfer({
      chain:  BASE_CHAIN,
      token:  accept.asset ?? USDC_ON_BASE,
      to:     accept.payTo,
      amount: usdcAmount,
    });

    if (!payment.success || !payment.hash) {
      console.warn('[x402] TWAK payment failed:', payment.message ?? 'no hash');
      return null;
    }

    txHash = payment.hash;
    console.log(`[x402] Payment tx: ${txHash}`);
  } catch (e) {
    console.warn('[x402] TWAK transfer error:', e instanceof Error ? e.message : e);
    return null;
  }

  // Step 4 — build proof and retry
  const proof: X402PaymentProof = {
    x402Version: 1,
    scheme:      accept.scheme,
    network:     accept.network,
    payload: {
      from:   agentWallet,
      to:     accept.payTo,
      txHash,
      amount: accept.maxAmountRequired,
      asset:  accept.asset ?? USDC_ON_BASE,
    },
  };

  try {
    const retryRes = await fetch(url, {
      headers: {
        'Accept':    'application/json',
        'X-Payment': Buffer.from(JSON.stringify(proof)).toString('base64'),
      },
    });

    if (!retryRes.ok) {
      console.warn(`[x402] Retry failed: HTTP ${retryRes.status}`);
      return null;
    }

    console.log(`[x402] ✓ Data received — on-chain proof: ${txHash}`);
    return retryRes.json();
  } catch (e) {
    console.warn('[x402] Retry error:', e instanceof Error ? e.message : e);
    return null;
  }
}

// Fallback: standard API key
function apiKeyHeaders() {
  return { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY ?? '', 'Accept': 'application/json' };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface CmcFearAndGreed {
  value:          number;
  classification: string;
}

export interface CmcGainer {
  symbol:        string;
  name:          string;
  percentChange: number;
  price:         number;
}

export interface CmcTokenQuote {
  symbol:          string;
  name:            string;
  price:           number;
  percentChange24h: number;
  marketCap:       number;
  volume24h:       number;
}

export interface CmcGlobalMetrics {
  totalMarketCapUsd: number;
  btcDominancePct:   number;
  defiMarketCapUsd:  number;
  totalVolume24hUsd: number;
}

export interface CmcDexPair {
  baseSymbol:  string;
  quoteSymbol: string;
  price:       number;
  volume24h:   number;
  exchange:    string;
}

/**
 * Fear & Greed — not in x402 catalogue, uses API key only.
 */
export async function getFearAndGreedX402(
  _agentWallet: string,
  _twakClient:  TwakClient,
): Promise<CmcFearAndGreed | null> {
  const key = process.env.CMC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${CMC_BASE}/v3/fear-and-greed/latest`, { headers: apiKeyHeaders() });
    if (!res.ok) return null;
    const json = await res.json() as any;
    return { value: json.data.value, classification: json.data.value_classification };
  } catch { return null; }
}

/**
 * Top gainers — via x402 (agent pays $0.01 USDC on Base), falls back to API key.
 * Uses /x402/v3/cryptocurrency/listings/latest sorted by 24h % change.
 */
export async function getTopGainersX402(
  agentWallet: string,
  twakClient:  TwakClient,
  limit = 10,
): Promise<CmcGainer[]> {
  // Try x402 first
  try {
    const data = await fetchWithX402(
      '/x402/v3/cryptocurrency/listings/latest',
      { limit, sort: 'percent_change_24h', sort_dir: 'desc', convert: 'USD' },
      agentWallet,
      twakClient,
    ) as any;
    if (Array.isArray(data?.data)) {
      return data.data.map((t: any) => ({
        symbol:        t.symbol,
        name:          t.name,
        percentChange: t.quote?.USD?.percent_change_24h ?? 0,
        price:         t.quote?.USD?.price ?? 0,
      }));
    }
  } catch { /* fall through */ }

  // Fallback: API key
  const key = process.env.CMC_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `${CMC_BASE}/v1/cryptocurrency/listings/latest?limit=${limit}&sort=percent_change_24h&sort_dir=desc&convert=USD`,
      { headers: apiKeyHeaders() },
    );
    if (!res.ok) return [];
    const json = await res.json() as any;
    return (json.data ?? []).map((t: any) => ({
      symbol:        t.symbol,
      name:          t.name,
      percentChange: t.quote?.USD?.percent_change_24h ?? 0,
      price:         t.quote?.USD?.price ?? 0,
    }));
  } catch { return []; }
}

/**
 * Live price quotes for specific token symbols — via x402.
 * Used to verify signal prices before executing trades.
 */
export async function getTokenQuotesX402(
  symbols:     string[],
  agentWallet: string,
  twakClient:  TwakClient,
): Promise<Map<string, CmcTokenQuote>> {
  const result = new Map<string, CmcTokenQuote>();
  if (symbols.length === 0) return result;

  try {
    const data = await fetchWithX402(
      '/x402/v3/cryptocurrency/quotes/latest',
      { symbol: symbols.join(','), convert: 'USD' },
      agentWallet,
      twakClient,
    ) as any;

    if (data?.data) {
      for (const [sym, entry] of Object.entries(data.data as Record<string, any>)) {
        const q = (Array.isArray(entry) ? entry[0] : entry)?.quote?.USD;
        if (!q) continue;
        result.set(sym.toUpperCase(), {
          symbol:           sym,
          name:             entry[0]?.name ?? sym,
          price:            q.price ?? 0,
          percentChange24h: q.percent_change_24h ?? 0,
          marketCap:        q.market_cap ?? 0,
          volume24h:        q.volume_24h ?? 0,
        });
      }
    }
  } catch { /* fall through */ }

  // Fallback for any missing symbols
  const missing = symbols.filter(s => !result.has(s.toUpperCase()));
  if (missing.length > 0 && process.env.CMC_API_KEY) {
    try {
      const res = await fetch(
        `${CMC_BASE}/v2/cryptocurrency/quotes/latest?symbol=${missing.join(',')}&convert=USD`,
        { headers: apiKeyHeaders() },
      );
      if (res.ok) {
        const json = await res.json() as any;
        for (const [sym, entries] of Object.entries(json.data as Record<string, any>)) {
          const entry = Array.isArray(entries) ? entries[0] : entries;
          const q = entry?.quote?.USD;
          if (!q) continue;
          result.set(sym.toUpperCase(), {
            symbol:           sym,
            name:             entry.name ?? sym,
            price:            q.price ?? 0,
            percentChange24h: q.percent_change_24h ?? 0,
            marketCap:        q.market_cap ?? 0,
            volume24h:        q.volume_24h ?? 0,
          });
        }
      }
    } catch { /* ignore */ }
  }

  return result;
}

/**
 * BSC DEX pair quotes — via x402 (/x402/v4/dex/pairs/quotes/latest).
 * Gives live BSC DEX liquidity data for tokens we're considering buying.
 */
export async function getDexPairsX402(
  tokenAddresses: string[],
  agentWallet:    string,
  twakClient:     TwakClient,
): Promise<CmcDexPair[]> {
  if (tokenAddresses.length === 0) return [];

  try {
    const data = await fetchWithX402(
      '/x402/v4/dex/pairs/quotes/latest',
      { address: tokenAddresses.join(','), network_slug: 'bsc' },
      agentWallet,
      twakClient,
    ) as any;

    if (Array.isArray(data?.data?.pairs)) {
      return data.data.pairs.map((p: any) => ({
        baseSymbol:  p.base_asset_symbol ?? '',
        quoteSymbol: p.quote_asset_symbol ?? 'BNB',
        price:       p.quote?.USD?.price ?? 0,
        volume24h:   p.quote?.USD?.volume_24h ?? 0,
        exchange:    p.exchange?.name ?? '',
      }));
    }
  } catch { /* fall through */ }

  return [];
}

/**
 * Global market metrics — via API key (no x402 path available for this endpoint).
 */
export async function getGlobalMetricsX402(
  _agentWallet: string,
  _twakClient:  TwakClient,
): Promise<CmcGlobalMetrics | null> {
  const key = process.env.CMC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${CMC_BASE}/v1/global-metrics/quotes/latest`, { headers: apiKeyHeaders() });
    if (!res.ok) return null;
    const json = await res.json() as any;
    const d = json.data;
    return {
      totalMarketCapUsd: d.quote?.USD?.total_market_cap ?? 0,
      btcDominancePct:   d.btc_dominance ?? 0,
      defiMarketCapUsd:  d.defi_market_cap ?? 0,
      totalVolume24hUsd: d.quote?.USD?.total_volume_24h ?? 0,
    };
  } catch { return null; }
}
