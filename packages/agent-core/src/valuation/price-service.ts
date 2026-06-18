import { db, tokenPrices, eq } from '@aether/db';
import { PriceState, computeConfidenceBreakdown, type RouteType, type PriceBundle } from './price-types.js';

export class PriceService {
  private static cache = new Map<string, { bundle: PriceBundle; fetchedAt: number }>();
  private static cacheTTLMs = 5000; // 5 seconds default cache TTL

  /**
   * Configures the in-memory cache TTL in milliseconds.
   */
  public static setTTL(ttlMs: number): void {
    this.cacheTTLMs = ttlMs;
  }

  /**
   * Clears the in-memory cache.
   */
  public static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Primary entry point for Portfolio and Risk Engines.
   * Resolves the current price in USD.
   */
  public static async getPrice(tokenAddress: string): Promise<number> {
    const bundle = await this.getPriceBundle(tokenAddress);
    return bundle ? bundle.priceUsd : 0.0;
  }

  /**
   * Retrieves the full valuation metadata bundle for a token.
   * Leverages an in-memory cache for O(1) reads.
   * Reconstructs confidenceBreakdown on the fly from stored fields
   * so callers can always inspect the three sub-scores for explainability.
   */
  public static async getPriceBundle(tokenAddress: string): Promise<PriceBundle | null> {
    const addr = tokenAddress.toLowerCase();
    const now = Date.now();
    const cached = this.cache.get(addr);

    if (cached && (now - cached.fetchedAt < this.cacheTTLMs)) {
      return cached.bundle;
    }

    const rows = await db
      .select()
      .from(tokenPrices)
      .where(eq(tokenPrices.tokenAddress, addr))
      .limit(1);

    if (rows.length > 0) {
      const row = rows[0]!;

      // Reconstruct the breakdown from stored fields — no extra query needed.
      const ageSinceUpdateMs = now - row.updatedAt.getTime();
      const confidenceBreakdown = computeConfidenceBreakdown(
        row.liquidityUsd,
        ageSinceUpdateMs,
        row.observationCount1h
      );

      const bundle: PriceBundle = {
        tokenAddress: row.tokenAddress,
        priceUsd: row.priceUsd,
        vwap1m: row.vwap1m,
        vwap15m: row.vwap15m,
        vwap1h: row.vwap1h,
        observationCount1h: row.observationCount1h,
        liquidityUsd: row.liquidityUsd,
        routeType: row.routeType as RouteType,
        priceState: row.priceState as PriceState,
        manipulationFlag: row.manipulationFlag,
        priceConfidence: row.priceConfidence,
        confidenceBreakdown,
        updatedAt: row.updatedAt
      };
      this.cache.set(addr, { bundle, fetchedAt: now });
      return bundle;
    }

    return null;
  }
}
