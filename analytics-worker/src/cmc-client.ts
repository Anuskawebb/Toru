/**
 * CoinMarketCap AI Agent Hub client.
 *
 * Provides two signals used by the analytics + execution layers:
 *   1. Fear & Greed index — market-wide sentiment (updates hourly)
 *   2. Trending tokens    — most-visited tokens on CMC (updates every 15 min)
 *
 * Both are cached in-process. If CMC_API_KEY is unset, all functions
 * return null / empty set — the rest of the system degrades gracefully.
 */

const CMC_BASE = 'https://pro-api.coinmarketcap.com';

export type FearAndGreedClassification =
  | 'Extreme Fear'
  | 'Fear'
  | 'Neutral'
  | 'Greed'
  | 'Extreme Greed';

export interface FearAndGreed {
  value: number;                       // 0–100
  classification: FearAndGreedClassification;
  updatedAt: Date;
}

interface FgCache { data: FearAndGreed; expiresAt: number }
interface TrendingCache { symbols: Set<string>; expiresAt: number }

let fgCache:       FgCache       | null = null;
let trendingCache: TrendingCache | null = null;

function apiKey(): string {
  return process.env.CMC_API_KEY ?? '';
}

function headers(): Record<string, string> {
  return { 'X-CMC_PRO_API_KEY': apiKey(), 'Accept': 'application/json' };
}

/**
 * Returns the current Fear & Greed index, or null when the key is absent / call fails.
 * Cached for 1 hour (CMC updates the index hourly).
 */
export async function getFearAndGreed(): Promise<FearAndGreed | null> {
  if (!apiKey()) return null;
  if (fgCache && Date.now() < fgCache.expiresAt) return fgCache.data;

  try {
    const res = await fetch(`${CMC_BASE}/v3/fear-and-greed/latest`, { headers: headers() });
    if (!res.ok) {
      console.warn(`[cmc] F&G fetch failed: HTTP ${res.status}`);
      return null;
    }

    const json = await res.json() as {
      data: { value: number; value_classification: string; timestamp: string };
    };

    const data: FearAndGreed = {
      value:          json.data.value,
      classification: json.data.value_classification as FearAndGreedClassification,
      updatedAt:      new Date(json.data.timestamp),
    };

    fgCache = { data, expiresAt: Date.now() + 60 * 60 * 1000 }; // 1h TTL
    return data;
  } catch (e) {
    console.warn('[cmc] F&G fetch error:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Returns the set of token symbols currently trending on CMC (most-visited).
 * Cached for 15 minutes. Returns empty set when key is absent / call fails.
 */
export async function getTrendingSymbols(): Promise<Set<string>> {
  if (!apiKey()) return new Set();
  if (trendingCache && Date.now() < trendingCache.expiresAt) return trendingCache.symbols;

  try {
    const res = await fetch(
      `${CMC_BASE}/v1/cryptocurrency/trending/most-visited?limit=20`,
      { headers: headers() },
    );
    if (!res.ok) {
      console.warn(`[cmc] Trending fetch failed: HTTP ${res.status}`);
      return new Set();
    }

    const json = await res.json() as { data: Array<{ symbol: string }> };
    const symbols = new Set(json.data.map(t => t.symbol.toUpperCase()));

    trendingCache = { symbols, expiresAt: Date.now() + 15 * 60 * 1000 }; // 15min TTL
    return symbols;
  } catch (e) {
    console.warn('[cmc] Trending fetch error:', e instanceof Error ? e.message : e);
    return new Set();
  }
}
