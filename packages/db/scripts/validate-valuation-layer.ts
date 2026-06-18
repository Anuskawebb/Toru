import { db, priceObservations, tokenPrices, trades, eq } from '../src/client.js';
import {
  PriceObservationService,
  PriceAggregator,
  PriceService,
  PriceState,
  WBNB_ADDRESS,
  computeConfidenceBreakdown
} from '../../../packages/agent-core/src/index.js';

console.log('Aether Valuation Layer Validation Suite (v2)');
console.log('================================================================');

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS  ${message}`);
    passCount++;
  } else {
    console.error(`  FAIL  ${message}`);
    failCount++;
  }
}

async function runValidation() {
  try {
    // 0. Clean database state for testing
    console.log('Cleaning test tables...');
    await db.delete(priceObservations);
    await db.delete(tokenPrices);
    await db.delete(trades);

    const now = new Date();
    const USDT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
    const POOL_A = '0xaaaa000000000000000000000000000000000001';

    // Set fixed WBNB cache to avoid DB lookup dependencies for WBNB price
    PriceObservationService.setCachedWbnbPrice(600.0);

    // ── SCENARIO 1: Direct Stablecoin Route — spot, VWAP, route type ──────────
    console.log('\n── Scenario 1: Direct Stablecoin Route (TKN_A) ──────────────────');
    const TKN_A = '0x1111111111111111111111111111111111111111';

    await db.insert(trades).values({
      txHash: '0xabc1230000000000000000000000000000000000000000000000000000000001',
      blockNumber: 10000n,
      timestamp: new Date(now.getTime() - 2 * 60 * 1000),
      wallet: '0x0000000000000000000000000000000000000001',
      dex: 'PancakeSwapV3',
      tokenInAddress: USDT_ADDRESS,
      tokenOutAddress: TKN_A,
      tokenInSymbol: 'USDT',
      tokenOutSymbol: 'TKN_A',
      tokenInDecimals: 18,
      tokenOutDecimals: 18,
      amountIn: '300000000000000000000',
      amountOut: '200000000000000000000'
    });

    // Buy: 300 USDT → 200 TKN_A  →  spot = $1.50  (include pairAddress)
    await PriceObservationService.recordObservation({
      tokenIn: USDT_ADDRESS,
      tokenOut: TKN_A,
      amountIn: '300000000000000000000',
      amountOut: '200000000000000000000',
      tokenInDecimals: 18,
      tokenOutDecimals: 18,
      pairAddress: POOL_A,
      observedAt: new Date(now.getTime() - 2 * 60 * 1000)
    });

    // Sell: 100 TKN_A → 150 USDT  →  spot = $1.50
    await PriceObservationService.recordObservation({
      tokenIn: TKN_A,
      tokenOut: USDT_ADDRESS,
      amountIn: '100000000000000000000',
      amountOut: '150000000000000000000',
      tokenInDecimals: 18,
      tokenOutDecimals: 18,
      pairAddress: POOL_A,
      observedAt: new Date(now.getTime() - 1 * 60 * 1000)
    });

    await PriceAggregator.aggregatePrices(now, { [TKN_A]: 150000.0 });

    PriceService.clearCache();
    const priceA = await PriceService.getPrice(TKN_A);
    const bundleA = await PriceService.getPriceBundle(TKN_A);

    assert(priceA === 1.50, `getPrice returned correct spot price ($1.50)`);
    assert(bundleA !== null, `getPriceBundle successfully returned a bundle`);
    if (bundleA) {
      assert(bundleA.vwap1m === 1.50,  `1m VWAP correct  (got ${bundleA.vwap1m})`);
      assert(bundleA.vwap15m === 1.50, `15m VWAP correct (got ${bundleA.vwap15m})`);
      assert(bundleA.vwap1h === 1.50,  `1h VWAP correct  (got ${bundleA.vwap1h})`);
      assert(bundleA.observationCount1h === 2, `Observation count 2 (got ${bundleA.observationCount1h})`);
      assert(bundleA.routeType === 'DIRECT_STABLE', `Route: DIRECT_STABLE`);
      assert(bundleA.priceState === PriceState.FRESH, `PriceState: FRESH`);
      assert(bundleA.manipulationFlag === false, `No manipulation flag`);
      // Liq(150k→30) + Fresh(1m→40) + Obs(2→5) = 75
      assert(bundleA.priceConfidence === 75, `Total confidence 75 (got ${bundleA.priceConfidence})`);
    }

    // ── SCENARIO 2: Multi-Hop WBNB Route ──────────────────────────────────────
    console.log('\n── Scenario 2: Multi-Hop WBNB Route (TKN_B) ────────────────────');
    const TKN_B = '0x2222222222222222222222222222222222222222';
    const POOL_B = '0xbbbb000000000000000000000000000000000002';

    await db.insert(trades).values({
      txHash: '0xabc1230000000000000000000000000000000000000000000000000000000002',
      blockNumber: 10001n,
      timestamp: new Date(now.getTime() - 3 * 60 * 1000),
      wallet: '0x0000000000000000000000000000000000000001',
      dex: 'PancakeSwapV3',
      tokenInAddress: WBNB_ADDRESS,
      tokenOutAddress: TKN_B,
      tokenInSymbol: 'WBNB',
      tokenOutSymbol: 'TKN_B',
      tokenInDecimals: 18,
      tokenOutDecimals: 18,
      amountIn: '500000000000000000',
      amountOut: '100000000000000000000'
    });

    // 0.5 WBNB ($600) → 100 TKN_B  →  spot = $3.00
    await PriceObservationService.recordObservation({
      tokenIn: WBNB_ADDRESS,
      tokenOut: TKN_B,
      amountIn: '500000000000000000',
      amountOut: '100000000000000000000',
      tokenInDecimals: 18,
      tokenOutDecimals: 18,
      pairAddress: POOL_B,
      observedAt: new Date(now.getTime() - 3 * 60 * 1000)
    });

    await PriceAggregator.aggregatePrices(now, { [TKN_B]: 50000.0 });

    PriceService.clearCache();
    const bundleB = await PriceService.getPriceBundle(TKN_B);
    assert(bundleB !== null, `getPriceBundle returned a bundle for TKN_B`);
    if (bundleB) {
      assert(bundleB.priceUsd === 3.0, `Spot price via WBNB = $3 (got ${bundleB.priceUsd})`);
      assert(bundleB.routeType === 'WBNB_ROUTE', `Route: WBNB_ROUTE`);
      assert(bundleB.priceState === PriceState.FRESH, `PriceState: FRESH`);
      // Liq(50k→20) + Fresh(3m→40) + Obs(1→0) = 60
      assert(bundleB.priceConfidence === 60, `Total confidence 60 (got ${bundleB.priceConfidence})`);
    }

    // ── SCENARIO 3: Pool address attribution stored in price_observations ──────
    console.log('\n── Scenario 3: sourcePoolAddress attribution (TKN_A) ────────────');
    const { isNotNull } = await import('drizzle-orm');
    const poolRows = await db
      .select({ pool: priceObservations.sourcePoolAddress })
      .from(priceObservations)
      .where(isNotNull(priceObservations.sourcePoolAddress))
      .limit(1);
    assert(poolRows.length > 0, `price_observations rows carry sourcePoolAddress`);
    assert(poolRows[0]?.pool === POOL_A, `sourcePoolAddress matches POOL_A (got ${poolRows[0]?.pool})`);

    // ── SCENARIO 4: Confidence breakdown structure ─────────────────────────────
    console.log('\n── Scenario 4: confidenceBreakdown structure ────────────────────');
    PriceService.clearCache();
    const bundleA2 = await PriceService.getPriceBundle(TKN_A);
    assert(bundleA2 !== null, `PriceBundle available for breakdown check`);
    if (bundleA2) {
      const bd = bundleA2.confidenceBreakdown;
      assert(typeof bd.liquidity === 'number',    `breakdown.liquidity is a number (${bd.liquidity})`);
      assert(typeof bd.freshness === 'number',    `breakdown.freshness is a number (${bd.freshness})`);
      assert(typeof bd.observations === 'number', `breakdown.observations is a number (${bd.observations})`);
      assert(
        bd.liquidity + bd.freshness + bd.observations === bundleA2.priceConfidence,
        `breakdown sums to priceConfidence (${bd.liquidity}+${bd.freshness}+${bd.observations}=${bundleA2.priceConfidence})`
      );
      // Liq(150k→30) + Fresh(~0 read delay ≤5m→40) + Obs(2→5) = 75
      assert(bd.liquidity === 30,    `liquidity sub-score = 30 (got ${bd.liquidity})`);
      assert(bd.observations === 5,  `observations sub-score = 5  (got ${bd.observations})`);
    }

    // ── SCENARIO 5: computeConfidenceBreakdown pure function ──────────────────
    console.log('\n── Scenario 5: computeConfidenceBreakdown pure function ─────────');
    const b1 = computeConfidenceBreakdown(1_500_000, 8 * 60_000, 15);
    assert(b1.liquidity === 40,     `$1.5M liquidity → 40 (got ${b1.liquidity})`);
    assert(b1.freshness === 35,     `8m age → 35       (got ${b1.freshness})`);
    assert(b1.observations === 10,  `15 obs → 10       (got ${b1.observations})`);
    assert(b1.liquidity + b1.freshness + b1.observations === 85, `Total = 85`);

    const b2 = computeConfidenceBreakdown(5_000, 5 * 60 * 60_000, 0);
    assert(b2.liquidity === 0,    `<$10k → 0         (got ${b2.liquidity})`);
    assert(b2.freshness === 0,    `5h age → 0        (got ${b2.freshness})`);
    assert(b2.observations === 0, `0 obs → 0         (got ${b2.observations})`);

    // ── SCENARIO 6: Price confidence decay & stale states ─────────────────────
    console.log('\n── Scenario 6: Price Confidence Decay & Stale States (TKN_C) ─────');
    const TKN_C = '0x3333333333333333333333333333333333333333';

    await db.insert(trades).values({
      txHash: '0xabc1230000000000000000000000000000000000000000000000000000000003',
      blockNumber: 10002n,
      timestamp: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      wallet: '0x0000000000000000000000000000000000000001',
      dex: 'PancakeSwapV3',
      tokenInAddress: USDT_ADDRESS,
      tokenOutAddress: TKN_C,
      tokenInSymbol: 'USDT',
      tokenOutSymbol: 'TKN_C',
      tokenInDecimals: 18,
      tokenOutDecimals: 18,
      amountIn: '100000000000000000000',
      amountOut: '10000000000000000000'
    });

    await PriceObservationService.recordObservation({
      tokenIn: USDT_ADDRESS,
      tokenOut: TKN_C,
      amountIn: '100000000000000000000',
      amountOut: '10000000000000000000',
      tokenInDecimals: 18,
      tokenOutDecimals: 18,
      observedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000)
    });

    await PriceAggregator.aggregatePrices(now, { [TKN_C]: 12000.0 });

    PriceService.clearCache();
    const bundleC1 = await PriceService.getPriceBundle(TKN_C);
    assert(bundleC1 !== null, `Bundle for TKN_C`);
    if (bundleC1) {
      assert(bundleC1.priceState === PriceState.STALE, `STALE after 3h`);
      // Liq(12k→10) + Fresh(3h→10) + Obs(1→0) = 20
      assert(bundleC1.priceConfidence === 20, `Confidence 20 (got ${bundleC1.priceConfidence})`);
    }

    const futureTime = new Date(now.getTime() + 10 * 60 * 60 * 1000); // 13h total age
    await PriceAggregator.aggregatePrices(futureTime, { [TKN_C]: 12000.0 });

    PriceService.clearCache();
    const bundleC2 = await PriceService.getPriceBundle(TKN_C);
    assert(bundleC2 !== null, `Bundle for TKN_C in future`);
    if (bundleC2) {
      assert(bundleC2.priceState === PriceState.UNRESOLVABLE, `UNRESOLVABLE after 13h`);
      assert(bundleC2.priceConfidence === 10, `Confidence 10 (got ${bundleC2.priceConfidence})`);
    }

    // ── SCENARIO 7: Manipulation detection — no price clamping ────────────────
    console.log('\n── Scenario 7: Manipulation Detection (TKN_D) ──────────────────');
    const TKN_D = '0x4444444444444444444444444444444444444444';

    await db.insert(trades).values({
      txHash: '0xabc1230000000000000000000000000000000000000000000000000000000004',
      blockNumber: 10003n,
      timestamp: new Date(now.getTime() - 10 * 60 * 1000),
      wallet: '0x0000000000000000000000000000000000000001',
      dex: 'PancakeSwapV3',
      tokenInAddress: USDT_ADDRESS,
      tokenOutAddress: TKN_D,
      tokenInSymbol: 'USDT',
      tokenOutSymbol: 'TKN_D',
      tokenInDecimals: 18,
      tokenOutDecimals: 18,
      amountIn: '3000000000000000000000',
      amountOut: '3000000000000000000000'
    });

    for (const [minsAgo, amtIn, amtOut] of [
      [10, '1000000000000000000000', '1000000000000000000000'],
      [8,  '1000000000000000000000', '1000000000000000000000'],
      [5,  '1000000000000000000000', '1000000000000000000000'],
    ] as [number, string, string][]) {
      await PriceObservationService.recordObservation({
        tokenIn: USDT_ADDRESS, tokenOut: TKN_D,
        amountIn: amtIn, amountOut: amtOut,
        tokenInDecimals: 18, tokenOutDecimals: 18,
        observedAt: new Date(now.getTime() - minsAgo * 60 * 1000)
      });
    }

    // Spike to $1.30 — 30% above $1.00 VWAP15m
    await PriceObservationService.recordObservation({
      tokenIn: USDT_ADDRESS, tokenOut: TKN_D,
      amountIn: '65000000000000000000',
      amountOut: '50000000000000000000',
      tokenInDecimals: 18, tokenOutDecimals: 18,
      observedAt: new Date(now.getTime() - 10 * 1000)
    });

    await PriceAggregator.aggregatePrices(now, { [TKN_D]: 1200000.0 });

    PriceService.clearCache();
    const bundleD = await PriceService.getPriceBundle(TKN_D);
    assert(bundleD !== null, `Bundle for TKN_D`);
    if (bundleD) {
      assert(bundleD.manipulationFlag === true, `manipulationFlag = true`);
      assert(bundleD.priceState === PriceState.MANIPULATED, `PriceState: MANIPULATED`);
      assert(bundleD.priceUsd === 1.30, `Spot price unclamped at $1.30 (got ${bundleD.priceUsd})`);
      assert(bundleD.vwap15m > 1.0 && bundleD.vwap15m < 1.01, `VWAP15m ≈ $1.00 (got ${bundleD.vwap15m})`);
    }

    // ── SCENARIO 8: pruneObservations retention policy ─────────────────────────
    console.log('\n── Scenario 8: pruneObservations (retention policy) ─────────────');
    const TKN_E = '0x5555555555555555555555555555555555555555';

    // One fresh observation and one "ancient" observation (10 days old)
    await PriceObservationService.recordObservation({
      tokenIn: USDT_ADDRESS, tokenOut: TKN_E,
      amountIn: '100000000000000000000',
      amountOut: '50000000000000000000',
      tokenInDecimals: 18, tokenOutDecimals: 18,
      observedAt: new Date(now.getTime() - 1 * 60 * 1000)          // 1 minute ago (keep)
    });
    await PriceObservationService.recordObservation({
      tokenIn: USDT_ADDRESS, tokenOut: TKN_E,
      amountIn: '100000000000000000000',
      amountOut: '50000000000000000000',
      tokenInDecimals: 18, tokenOutDecimals: 18,
      observedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) // 10 days ago (prune)
    });

    const beforeRows = await db
      .select({ pool: priceObservations.tokenAddress })
      .from(priceObservations)
      .where(eq(priceObservations.tokenAddress, TKN_E));
    assert(beforeRows.length === 2, `2 observations before pruning (got ${beforeRows.length})`);

    await PriceAggregator.pruneObservations(7, now);

    const afterRows = await db
      .select({ pool: priceObservations.tokenAddress })
      .from(priceObservations)
      .where(eq(priceObservations.tokenAddress, TKN_E));
    assert(afterRows.length === 1, `1 observation remaining after pruning (got ${afterRows.length})`);
    console.log('\n================================================================');
    console.log(`Validation Results: ${passCount} PASS  ${failCount} FAIL`);

    if (failCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }

  } catch (err) {
    console.error('Unhandled validation exception:', err);
    process.exit(1);
  }
}

runValidation();
