import { db, priceObservations, tokenPrices, and, inArray, gte, lt, sql } from '@aether/db';
import { PriceState, computeConfidenceBreakdown, type RouteType } from './price-types.js';
import { BSC_STABLES, WBNB_ADDRESS } from './price-observation-service.js';

function parseUtcDate(val: string | Date | null | undefined): Date | undefined {
  if (!val) return undefined;
  if (val instanceof Date) {
    return val;
  }
  let str = String(val).trim();
  if (!str) return undefined;
  let isoStr = str.replace(' ', 'T');
  const hasTimezone = isoStr.endsWith('Z') || /[+-]\d{2}(:?\d{2})?$/.test(isoStr);
  if (!hasTimezone) {
    isoStr += 'Z';
  }
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? undefined : d;
}

type LatestObsRow = {
  token_address: string;
  price_usd: number;
  volume_usd: number;
  source: string;
  observed_at: Date | string;
};

type RouteRow = { token_address: string };

export class PriceAggregator {
  /**
   * Aggregates price observations to compute VWAPs and pricing metrics.
   *
   * Batch architecture: replaces the prior per-token loop (O(N×6) queries)
   * with 7 fixed batch queries regardless of token count:
   *   1. Distinct latest observation per token (DISTINCT ON)
   *   2. All 1h observations for all tokens
   *   3. All existing token_prices rows
   *   4–6. Three route-detection queries (stable / WBNB / external)
   *   7. One batch INSERT … ON CONFLICT upsert
   *
   * Plus one optional batch UPDATE for tokens with no observations.
   */
  public static async aggregatePrices(
    now: Date = new Date(),
    liquidityOverrides?: Record<string, number>,
    tokenAddresses?: string[]
  ): Promise<void> {
    // 1. Resolve the list of tokens to process
    let addressesToProcess: string[];

    if (tokenAddresses && tokenAddresses.length > 0) {
      addressesToProcess = tokenAddresses.map(addr => addr.toLowerCase());
    } else {
      // Parallel full-table scans — unavoidable when no filter is provided
      const [obsTokens, priceTokens] = await Promise.all([
        db.select({ tokenAddress: priceObservations.tokenAddress }).from(priceObservations),
        db.select({ tokenAddress: tokenPrices.tokenAddress }).from(tokenPrices),
      ]);
      const allAddresses = new Set<string>();
      obsTokens.forEach(t => allAddresses.add(t.tokenAddress.toLowerCase()));
      priceTokens.forEach(t => allAddresses.add(t.tokenAddress.toLowerCase()));
      addressesToProcess = Array.from(allAddresses);
    }

    if (addressesToProcess.length === 0) return;

    const addrSqlList = sql.join(addressesToProcess.map(a => sql`${a}`), sql`, `);

    // 2. Batch fetch: latest observation per token (single DISTINCT ON query)
    const latestObsRows = await db.execute<LatestObsRow>(sql`
      SELECT DISTINCT ON (token_address)
        token_address, price_usd, volume_usd, source, observed_at
      FROM price_observations
      WHERE token_address IN (${addrSqlList})
      ORDER BY token_address, observed_at DESC
    `);

    // 3. Batch fetch: all observations in the last hour across all tokens
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const hourObsRows = await db
      .select()
      .from(priceObservations)
      .where(and(
        inArray(priceObservations.tokenAddress, addressesToProcess),
        gte(priceObservations.observedAt, oneHourAgo)
      ));

    // 4. Batch fetch: existing token_prices rows (for liquidity carry-forward)
    const existingPriceRows = await db
      .select()
      .from(tokenPrices)
      .where(inArray(tokenPrices.tokenAddress, addressesToProcess));

    // 5. Batch route detection (3 queries instead of N×3)
    const routeMap = await this.batchDetermineRouteTypes(addressesToProcess);

    // Build in-memory lookup maps from batch results
    const latestObsMap = new Map<string, LatestObsRow>();
    for (const row of latestObsRows) {
      latestObsMap.set(row.token_address, row);
    }

    const hourObsMap = new Map<string, typeof hourObsRows>();
    for (const obs of hourObsRows) {
      const list = hourObsMap.get(obs.tokenAddress) ?? [];
      list.push(obs);
      hourObsMap.set(obs.tokenAddress, list);
    }

    const existingPriceMap = new Map<string, typeof existingPriceRows[0]>();
    for (const p of existingPriceRows) {
      existingPriceMap.set(p.tokenAddress, p);
    }

    // VWAP: Σ(USD_volume) / Σ(token_volume) = Σ(USD) / Σ(USD/price)
    const calculateVwap = (obsList: typeof hourObsRows, fallback: number): number => {
      if (obsList.length === 0) return fallback;
      let sumUsdVolume = 0;
      let sumTokenVolume = 0;
      for (const obs of obsList) {
        sumUsdVolume += obs.volumeUsd;
        sumTokenVolume += obs.volumeUsd / obs.priceUsd;
      }
      return sumTokenVolume > 0 ? sumUsdVolume / sumTokenVolume : fallback;
    };

    // 6. Compute per-token metrics in memory — O(N) CPU, zero additional I/O
    const upsertRows: Array<typeof tokenPrices.$inferInsert> = [];
    const unresolvableAddresses: string[] = [];

    for (const tokenAddress of addressesToProcess) {
      const latestObs = latestObsMap.get(tokenAddress);
      const existingPrice = existingPriceMap.get(tokenAddress);

      if (!latestObs) {
        // No observations at all — mark existing price record UNRESOLVABLE
        if (existingPrice) unresolvableAddresses.push(tokenAddress);
        continue;
      }

      const spotPrice = latestObs.price_usd;
      const lastObservedAt = parseUtcDate(latestObs.observed_at)!;
      const ageMs = now.getTime() - lastObservedAt.getTime();

      const hourObs = hourObsMap.get(tokenAddress) ?? [];
      const observationCount1h = hourObs.length;

      const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
      const oneMinAgo = new Date(now.getTime() - 1 * 60 * 1000);

      const obs1h  = hourObs.filter(o => o.priceUsd > 0 && o.volumeUsd > 0);
      const obs15m = obs1h.filter(o => o.observedAt.getTime() >= fifteenMinsAgo.getTime());
      const obs1m  = obs1h.filter(o => o.observedAt.getTime() >= oneMinAgo.getTime());

      const vwap1h  = calculateVwap(obs1h,  spotPrice);
      const vwap15m = calculateVwap(obs15m, spotPrice);
      const vwap1m  = calculateVwap(obs1m,  spotPrice);

      // Manipulation detection: spot > 15% off from 15m VWAP
      // Minimum observation count threshold = 3
      let manipulationFlag = false;
      if (vwap15m > 0 && observationCount1h >= 3) {
        const deviation = Math.abs(spotPrice - vwap15m) / vwap15m;
        if (deviation > 0.15) manipulationFlag = true;
      }

      // Price state machine
      let priceState: PriceState;
      if (manipulationFlag) {
        priceState = PriceState.MANIPULATED;
      } else if (ageMs > 12 * 60 * 60 * 1000) {
        priceState = PriceState.UNRESOLVABLE;
      } else if (ageMs > 15 * 60 * 1000) {
        priceState = PriceState.STALE;
      } else {
        priceState = PriceState.FRESH;
      }

      // Carry forward liquidity from the existing record unless an override is provided
      const liquidityUsd = liquidityOverrides?.[tokenAddress] ?? existingPrice?.liquidityUsd ?? 0;
      const breakdown = computeConfidenceBreakdown(liquidityUsd, ageMs, observationCount1h);
      const priceConfidence = breakdown.liquidity + breakdown.freshness + breakdown.observations;
      const routeType = routeMap.get(tokenAddress) ?? 'WBNB_ROUTE';

      upsertRows.push({
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
        updatedAt: now,
      });
    }

    // 7a. Batch upsert all priced tokens in a single statement
    if (upsertRows.length > 0) {
      await db.insert(tokenPrices).values(upsertRows).onConflictDoUpdate({
        target: tokenPrices.tokenAddress,
        set: {
          priceUsd:           sql`EXCLUDED.price_usd`,
          vwap1m:             sql`EXCLUDED.vwap_1m`,
          vwap15m:            sql`EXCLUDED.vwap_15m`,
          vwap1h:             sql`EXCLUDED.vwap_1h`,
          observationCount1h: sql`EXCLUDED.observation_count_1h`,
          liquidityUsd:       sql`EXCLUDED.liquidity_usd`,
          routeType:          sql`EXCLUDED.route_type`,
          priceState:         sql`EXCLUDED.price_state`,
          priceConfidence:    sql`EXCLUDED.price_confidence`,
          manipulationFlag:   sql`EXCLUDED.manipulation_flag`,
          updatedAt:          sql`EXCLUDED.updated_at`,
        },
      });
    }

    // 7b. Batch mark tokens with no observations as UNRESOLVABLE
    if (unresolvableAddresses.length > 0) {
      await db.update(tokenPrices)
        .set({ priceState: PriceState.UNRESOLVABLE, priceConfidence: 0, updatedAt: now })
        .where(inArray(tokenPrices.tokenAddress, unresolvableAddresses));
    }
  }

  /**
   * Determines route types for all non-routing tokens using 3 batch queries.
   *
   * Replaces the prior per-token determineRouteType() that issued 1–3 DB
   * round-trips per token. Priority order matches the original:
   *   DIRECT_STABLE > WBNB_ROUTE > EXTERNAL > WBNB_ROUTE (default)
   */
  private static async batchDetermineRouteTypes(
    tokenAddresses: string[]
  ): Promise<Map<string, RouteType>> {
    const routeMap = new Map<string, RouteType>();
    const stablesArray = Array.from(BSC_STABLES);
    const stablesSqlList = sql.join(stablesArray.map(s => sql`${s}`), sql`, `);

    // Tokens that ARE stables or WBNB need no lookup
    const lookupAddresses: string[] = [];
    for (const addr of tokenAddresses) {
      if (BSC_STABLES.has(addr) || addr === WBNB_ADDRESS) {
        routeMap.set(addr, 'DIRECT_STABLE');
      } else {
        lookupAddresses.push(addr);
      }
    }

    if (lookupAddresses.length === 0) return routeMap;

    const lookupSqlList = sql.join(lookupAddresses.map(a => sql`${a}`), sql`, `);

    // Query 1: tokens that have ever traded directly against a stablecoin
    const stableDirectRows = await db.execute<RouteRow>(sql`
      SELECT DISTINCT
        CASE
          WHEN token_in_address  IN (${stablesSqlList}) THEN token_out_address
          ELSE token_in_address
        END AS token_address
      FROM trades
      WHERE
        (token_in_address  IN (${lookupSqlList}) AND token_out_address IN (${stablesSqlList}))
        OR
        (token_out_address IN (${lookupSqlList}) AND token_in_address  IN (${stablesSqlList}))
    `);

    // Query 2: tokens that have ever traded directly against WBNB
    const wbnbRouteRows = await db.execute<RouteRow>(sql`
      SELECT DISTINCT
        CASE
          WHEN token_in_address  = ${WBNB_ADDRESS} THEN token_out_address
          ELSE token_in_address
        END AS token_address
      FROM trades
      WHERE
        (token_in_address  IN (${lookupSqlList}) AND token_out_address = ${WBNB_ADDRESS})
        OR
        (token_out_address IN (${lookupSqlList}) AND token_in_address  = ${WBNB_ADDRESS})
    `);

    // Query 3: tokens that have an external oracle observation
    const externalRows = await db.execute<RouteRow>(sql`
      SELECT DISTINCT token_address
      FROM price_observations
      WHERE token_address IN (${lookupSqlList})
        AND source = 'EXTERNAL_ORACLE'
    `);

    const stableSet   = new Set(stableDirectRows.map(r => r.token_address));
    const wbnbSet     = new Set(wbnbRouteRows.map(r => r.token_address));
    const externalSet = new Set(externalRows.map(r => r.token_address));

    for (const addr of lookupAddresses) {
      if (stableSet.has(addr)) {
        routeMap.set(addr, 'DIRECT_STABLE');
      } else if (wbnbSet.has(addr)) {
        routeMap.set(addr, 'WBNB_ROUTE');
      } else if (externalSet.has(addr)) {
        routeMap.set(addr, 'EXTERNAL');
      } else {
        routeMap.set(addr, 'WBNB_ROUTE');
      }
    }

    return routeMap;
  }

  /**
   * Prunes price observations older than the specified retention window (default: 7 days).
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
