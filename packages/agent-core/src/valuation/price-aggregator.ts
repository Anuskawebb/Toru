import { db, priceObservations, tokenPrices, trades, eq, and, or, inArray, desc, gte, lt } from '@aether/db';
import { PriceState, computeConfidenceBreakdown, type RouteType } from './price-types.js';
import { BSC_STABLES, WBNB_ADDRESS } from './price-observation-service.js';

export class PriceAggregator {
  /**
   * Aggregates price observations to compute VWAPs and pricing metrics for specified or all tokens.
   */
  public static async aggregatePrices(
    now: Date = new Date(),
    liquidityOverrides?: Record<string, number>,
    tokenAddresses?: string[]
  ): Promise<void> {
    let addressesToProcess: string[] = [];

    if (tokenAddresses && tokenAddresses.length > 0) {
      addressesToProcess = tokenAddresses.map(addr => addr.toLowerCase());
    } else {
      // Find all distinct token addresses from price_observations and token_prices
      const obsTokens = await db
        .select({ tokenAddress: priceObservations.tokenAddress })
        .from(priceObservations);
      const priceTokens = await db
        .select({ tokenAddress: tokenPrices.tokenAddress })
        .from(tokenPrices);

      const allAddresses = new Set<string>();
      obsTokens.forEach(t => allAddresses.add(t.tokenAddress.toLowerCase()));
      priceTokens.forEach(t => allAddresses.add(t.tokenAddress.toLowerCase()));
      addressesToProcess = Array.from(allAddresses);
    }

    for (const tokenAddress of addressesToProcess) {
      // 1. Fetch latest observation (no time limit)
      const latestObsResult = await db
        .select()
        .from(priceObservations)
        .where(eq(priceObservations.tokenAddress, tokenAddress))
        .orderBy(desc(priceObservations.observedAt))
        .limit(1);

      // Fetch existing token price if any
      const existingPriceRow = await db
        .select()
        .from(tokenPrices)
        .where(eq(tokenPrices.tokenAddress, tokenAddress))
        .limit(1);
      const existingPrice = existingPriceRow[0];

      if (latestObsResult.length === 0) {
        // No observations at all. If a price record exists, mark it UNRESOLVABLE
        if (existingPrice) {
          await db
            .update(tokenPrices)
            .set({
              priceState: PriceState.UNRESOLVABLE,
              priceConfidence: 0.0,
              updatedAt: now
            })
            .where(eq(tokenPrices.tokenAddress, tokenAddress));
        }
        continue;
      }

      const latestObs = latestObsResult[0]!;
      const spotPrice = latestObs.priceUsd;
      const lastObservedAt = latestObs.observedAt;
      const ageMs = now.getTime() - lastObservedAt.getTime();

      // 2. Fetch observations in the last 1 hour
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const hourObs = await db
        .select()
        .from(priceObservations)
        .where(
          and(
            eq(priceObservations.tokenAddress, tokenAddress),
            gte(priceObservations.observedAt, oneHourAgo)
          )
        );

      const observationCount1h = hourObs.length;

      // Filter lookbacks in memory
      const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
      const oneMinAgo = new Date(now.getTime() - 1 * 60 * 1000);

      const obs1h = hourObs.filter(o => o.priceUsd > 0 && o.volumeUsd > 0);
      const obs15m = obs1h.filter(o => o.observedAt.getTime() >= fifteenMinsAgo.getTime());
      const obs1m = obs1h.filter(o => o.observedAt.getTime() >= oneMinAgo.getTime());

      // VWAP Helper: VWAP = Sum(Volume USD) / Sum(Volume USD / Price USD)
      const calculateVwap = (obsList: typeof hourObs, fallback: number): number => {
        if (obsList.length === 0) return fallback;
        let sumUsdVolume = 0;
        let sumTokenVolume = 0;
        for (const obs of obsList) {
          sumUsdVolume += obs.volumeUsd;
          sumTokenVolume += obs.volumeUsd / obs.priceUsd;
        }
        return sumTokenVolume > 0 ? sumUsdVolume / sumTokenVolume : fallback;
      };

      const vwap1h = calculateVwap(obs1h, spotPrice);
      const vwap15m = calculateVwap(obs15m, spotPrice);
      const vwap1m = calculateVwap(obs1m, spotPrice);

      // 3. Manipulation Detection (deviation > 15% from VWAP 15m)
      let manipulationFlag = false;
      if (vwap15m > 0) {
        const deviation = Math.abs(spotPrice - vwap15m) / vwap15m;
        if (deviation > 0.15) {
          manipulationFlag = true;
        }
      }

      // 4. Resolve Route Type
      const routeType = await this.determineRouteType(tokenAddress);

      // 5. Resolve Price State
      let priceState = PriceState.FRESH;
      if (manipulationFlag) {
        priceState = PriceState.MANIPULATED;
      } else if (ageMs > 12 * 60 * 60 * 1000) {
        priceState = PriceState.UNRESOLVABLE;
      } else if (ageMs > 15 * 60 * 1000) {
        priceState = PriceState.STALE;
      } else {
        priceState = PriceState.FRESH;
      }

      // 6. Compute Price Confidence
      let liquidityUsd = 0.0;
      if (liquidityOverrides && liquidityOverrides[tokenAddress] !== undefined) {
        liquidityUsd = liquidityOverrides[tokenAddress];
      } else if (existingPrice) {
        liquidityUsd = existingPrice.liquidityUsd;
      }

      // Compute confidence sub-scores via the canonical pure function
      const breakdown = computeConfidenceBreakdown(liquidityUsd, ageMs, observationCount1h);
      const priceConfidence = breakdown.liquidity + breakdown.freshness + breakdown.observations;

      // 7. Upsert results into token_prices
      await db
        .insert(tokenPrices)
        .values({
          tokenAddress,
          priceUsd: spotPrice,
          vwap1m,
          vwap15m,
          vwap1h,
          observationCount1h,
          liquidityUsd,
          routeType,
          priceState,
          priceConfidence,
          manipulationFlag,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: tokenPrices.tokenAddress,
          set: {
            priceUsd: spotPrice,
            vwap1m,
            vwap15m,
            vwap1h,
            observationCount1h,
            liquidityUsd,
            routeType,
            priceState,
            priceConfidence,
            manipulationFlag,
            updatedAt: now
          }
        });
    }
  }

  /**
   * Helper to derive the route type of a token based on its swap pairs.
   */
  private static async determineRouteType(tokenAddress: string): Promise<RouteType> {
    const addr = tokenAddress.toLowerCase();

    if (BSC_STABLES.has(addr) || addr === WBNB_ADDRESS) {
      return 'DIRECT_STABLE';
    }

    const stablesArray = Array.from(BSC_STABLES);

    // Check if there is any swap directly against a stablecoin
    const directTrade = await db
      .select({ id: trades.id })
      .from(trades)
      .where(
        or(
          and(eq(trades.tokenInAddress, addr), inArray(trades.tokenOutAddress, stablesArray)),
          and(eq(trades.tokenOutAddress, addr), inArray(trades.tokenInAddress, stablesArray))
        )
      )
      .limit(1);

    if (directTrade.length > 0) {
      return 'DIRECT_STABLE';
    }

    // Check if there is any trade directly against WBNB
    const wbnbTrade = await db
      .select({ id: trades.id })
      .from(trades)
      .where(
        or(
          and(eq(trades.tokenInAddress, addr), eq(trades.tokenOutAddress, WBNB_ADDRESS)),
          and(eq(trades.tokenOutAddress, addr), eq(trades.tokenInAddress, WBNB_ADDRESS))
        )
      )
      .limit(1);

    if (wbnbTrade.length > 0) {
      return 'WBNB_ROUTE';
    }

    // Check if any observation came from an oracle
    const externalObs = await db
      .select({ id: priceObservations.id })
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.tokenAddress, addr),
          eq(priceObservations.source, 'EXTERNAL_ORACLE')
        )
      )
      .limit(1);

    if (externalObs.length > 0) {
      return 'EXTERNAL';
    }

    return 'WBNB_ROUTE';
  }

  /**
   * Prunes price observations older than the specified retention window (default: 7 days).
   * This implements Aether's data retention policy, preventing database bloat and maintaining fast aggregation times.
   */
  public static async pruneObservations(retentionDays: number = 7, now: Date = new Date()): Promise<void> {
    const cutoffDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    try {
      await db
        .delete(priceObservations)
        .where(lt(priceObservations.observedAt, cutoffDate));
      console.log(`Pruned price observations older than ${cutoffDate.toISOString()}`);
    } catch (error) {
      console.error('Failed to prune price observations:', error);
    }
  }
}
