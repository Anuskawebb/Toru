import {
  db,
  walletPositions,
  portfolioSnapshots,
  portfolioState,
  tokenPrices,
  eq,
  inArray
} from '../src/client.js';
import {
  PortfolioStateService,
  PortfolioValuationEngine,
  PriceService,
  PriceState,
  toRiskPortfolioState,
  type RouteType
} from '../../../packages/agent-core/src/index.js';

console.log('Aether Portfolio State Engine Validation Suite');
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
  const AGENT_WALLET = '0x1111111111111111111111111111111111111111';
  const USDT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
  const CAKE_ADDRESS = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
  const SHIT_ADDRESS = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

  try {
    // 0. Clean database state for testing — scoped to test wallet / test token addresses only.
    console.log('Cleaning test tables (scoped to test wallet and test token addresses)...');
    await db.delete(portfolioSnapshots).where(eq(portfolioSnapshots.agentWallet, AGENT_WALLET));
    await db.delete(portfolioState).where(eq(portfolioState.agentWallet, AGENT_WALLET));
    await db.delete(walletPositions).where(eq(walletPositions.wallet, AGENT_WALLET));
    await db.delete(tokenPrices).where(inArray(tokenPrices.tokenAddress, [CAKE_ADDRESS, SHIT_ADDRESS]));

    const now = new Date();

    // Instantiate service
    const service = new PortfolioStateService({
      agentWalletAddress: AGENT_WALLET,
      startingCapitalUsd: 10000
    });

    // ── SCENARIO 1: Dry Run / Clean State ────────────────────────────────────
    console.log('\n── Scenario 1: Dry Run / Clean State ───────────────────────────');
    
    // Clear price service cache
    PriceService.clearCache();

    const result1 = await service.refresh(now);
    assert(result1.snapshot.portfolioUsd === 0, 'Portfolio USD is 0');
    assert(result1.snapshot.stablecoinUsd === 0, 'Stablecoin USD is 0');
    assert(result1.snapshot.tokenExposureUsd === 0, 'Token Exposure USD is 0');
    assert(result1.snapshot.openPositions === 0, 'Open positions is 0');
    assert(result1.snapshot.unpricedPositions === 0, 'Unpriced positions is 0');
    assert(result1.snapshot.drawdownPct === 0, 'Bootstrap: drawdown initialized to 0% (no prior portfolio_state row — stale_oracle / drawdown blockers suppressed)');
    assert(result1.snapshot.rollingLossPct24h === 0, 'Bootstrap: rolling 24h loss initialized to 0% (no 24h baseline snapshot exists yet)');
    assert(result1.snapshot.valuationConfidence === 0, 'Valuation confidence is 0 (no assets)');

    // Verify row was written to portfolio_state
    const state1 = await service.readCurrentState();
    assert(state1 !== null, 'portfolio_state row was written');
    if (state1) {
      assert(state1.portfolioUsd === 0, 'portfolio_state portfolioUsd is 0');
      assert(state1.drawdownPct === 0, 'Bootstrap: portfolio_state drawdownPct initialized to 0');
    }

    // ── SCENARIO 2: Stablecoin-Only Portfolio ────────────────────────────────
    console.log('\n── Scenario 2: Stablecoin-Only Portfolio ───────────────────────');
    
    // Clear snapshots scoped to test wallet only — never touches other agents' snapshot history
    await db.delete(portfolioSnapshots).where(eq(portfolioSnapshots.agentWallet, AGENT_WALLET));

    // Insert 5,000 USDT position
    await db.insert(walletPositions).values({
      wallet: AGENT_WALLET,
      tokenAddress: USDT_ADDRESS,
      tokenSymbol: 'USDT',
      tokenDecimals: 18,
      netAmount: '5000000000000000000000', // 5,000 USDT
      firstTradeAt: now,
      lastTradeAt: now,
      tradeCount: 1
    });

    const result2 = await service.refresh(now);
    assert(result2.snapshot.portfolioUsd === 5000, `Portfolio USD is 5000 (got ${result2.snapshot.portfolioUsd})`);
    assert(result2.snapshot.stablecoinUsd === 5000, `Stablecoin USD is 5000 (got ${result2.snapshot.stablecoinUsd})`);
    assert(result2.snapshot.tokenExposureUsd === 0, `Token Exposure USD is 0 (got ${result2.snapshot.tokenExposureUsd})`);
    assert(result2.snapshot.openPositions === 0, `Open positions is 0 (got ${result2.snapshot.openPositions})`);
    // cashReservePct and totalExposurePct are now relative to current portfolioUsd ($5000),
    // not frozen startingCapitalUsd ($10000). 100% of the portfolio is stablecoins.
    assert(result2.snapshot.cashReservePct === 100, `Cash reserve pct is 100% of current $5000 portfolio (got ${result2.snapshot.cashReservePct})`);
    assert(result2.snapshot.totalExposurePct === 0, `Total exposure pct is 0% (got ${result2.snapshot.totalExposurePct})`);
    assert(result2.snapshot.drawdownPct === 50, `Drawdown pct is 50% (peak = 10000 baseline, got ${result2.snapshot.drawdownPct})`);
    assert(result2.snapshot.rollingLossPct24h === 50, `Rolling 24h loss is 50% (baseline = 10000, got ${result2.snapshot.rollingLossPct24h})`);
    assert(result2.snapshot.valuationConfidence === 100, `Valuation confidence is 100 (stablecoin only, got ${result2.snapshot.valuationConfidence})`);

    // ── SCENARIO 3: Portfolio with Fresh Priced Tokens ────────────────────────
    console.log('\n── Scenario 3: Portfolio with Fresh Priced Tokens ──────────────');
    
    // Insert 2,000 CAKE position (decimals = 18)
    await db.insert(walletPositions).values({
      wallet: AGENT_WALLET,
      tokenAddress: CAKE_ADDRESS,
      tokenSymbol: 'CAKE',
      tokenDecimals: 18,
      netAmount: '2000000000000000000000', // 2,000 CAKE
      firstTradeAt: now,
      lastTradeAt: now,
      tradeCount: 1
    });

    // Mock CAKE price at $2.00, confidence = 90
    await db.insert(tokenPrices).values({
      tokenAddress: CAKE_ADDRESS,
      priceUsd: 2.0,
      vwap1m: 2.0,
      vwap15m: 2.0,
      vwap1h: 2.0,
      observationCount1h: 15,
      liquidityUsd: 150000,
      routeType: 'DIRECT_STABLE',
      priceState: 'FRESH',
      priceConfidence: 90,
      manipulationFlag: false,
      updatedAt: now
    });

    PriceService.clearCache();

    const result3 = await service.refresh(now);
    
    // Total Portfolio = 5,000 USDT + (2,000 * 2) = 9,000 USD
    assert(result3.snapshot.portfolioUsd === 9000, `Portfolio USD is 9000 (got ${result3.snapshot.portfolioUsd})`);
    assert(result3.snapshot.stablecoinUsd === 5000, `Stablecoin USD is 5000 (got ${result3.snapshot.stablecoinUsd})`);
    assert(result3.snapshot.tokenExposureUsd === 4000, `Token Exposure USD is 4000 (got ${result3.snapshot.tokenExposureUsd})`);
    assert(result3.snapshot.openPositions === 1, `Open positions is 1 (CAKE, got ${result3.snapshot.openPositions})`);
    // cashReservePct = round(5000/9000 * 100, 2) = 55.56
    // totalExposurePct = round(4000/9000 * 100, 2) = 44.44  (sum = 100% ✓)
    assert(result3.snapshot.cashReservePct === 55.56, `Cash reserve pct is 55.56% of current $9000 portfolio (got ${result3.snapshot.cashReservePct})`);
    assert(result3.snapshot.totalExposurePct === 44.44, `Total exposure pct is 44.44% of current $9000 portfolio (got ${result3.snapshot.totalExposurePct})`);
    
    // Weighted confidence:
    // USDT: 5000 * 100 = 500000
    // CAKE: 4000 * 90 = 360000
    // Total = 860000 / 9000 = 95.56
    assert(result3.snapshot.valuationConfidence === 95.56, `Valuation confidence weighted average is 95.56 (got ${result3.snapshot.valuationConfidence})`);

    // ── SCENARIO 4: Portfolio with Unpriced / Unresolvable Tokens ────────────
    console.log('\n── Scenario 4: Portfolio with Unpriced / Unresolvable Tokens ───');
    
    // Insert 100,000 SHIT positions
    await db.insert(walletPositions).values({
      wallet: AGENT_WALLET,
      tokenAddress: SHIT_ADDRESS,
      tokenSymbol: 'SHIT',
      tokenDecimals: 18,
      netAmount: '100000000000000000000000', // 100,000 SHIT
      firstTradeAt: now,
      lastTradeAt: now,
      tradeCount: 1
    });

    // Mock SHIT price as UNRESOLVABLE
    await db.insert(tokenPrices).values({
      tokenAddress: SHIT_ADDRESS,
      priceUsd: 0.0,
      vwap1m: 0.0,
      vwap15m: 0.0,
      vwap1h: 0.0,
      observationCount1h: 0,
      liquidityUsd: 0,
      routeType: 'WBNB_ROUTE',
      priceState: 'UNRESOLVABLE',
      priceConfidence: 0,
      manipulationFlag: false,
      updatedAt: now
    });

    PriceService.clearCache();

    const result4 = await service.refresh(now);
    
    // Valuation ignores SHIT since it is UNRESOLVABLE. Total should remain 9000.
    assert(result4.snapshot.portfolioUsd === 9000, `Portfolio USD ignores UNRESOLVABLE token (got ${result4.snapshot.portfolioUsd})`);
    assert(result4.snapshot.openPositions === 2, `Open positions is 2 (CAKE + SHIT, got ${result4.snapshot.openPositions})`);
    assert(result4.snapshot.unpricedPositions === 1, `Unpriced positions is 1 (SHIT, got ${result4.snapshot.unpricedPositions})`);
    assert(result4.snapshot.valuationConfidence === 63.7, `Valuation confidence excludes UNRESOLVABLE token from weights (got ${result4.snapshot.valuationConfidence})`);

    // ── SCENARIO 5: Restart & Peak Retention (Restart-Safety) ───────────────
    console.log('\n── Scenario 5: Restart & Peak Retention (Restart-Safety) ───────');
    
    // Simulate restart with high peak in the state table manually.
    // Let's set peak to 12,000 USD
    await db.update(portfolioState)
      .set({ peakPortfolioUsd: 12000 })
      .where(eq(portfolioState.agentWallet, AGENT_WALLET));

    // Run refresh again
    const result5 = await service.refresh(now);
    
    // The current value is 9,000, but peak should be resolved as 12,000 from DB
    assert(result5.snapshot.peakPortfolioUsd === 12000, `Peak portfolio value is restored from DB (got ${result5.snapshot.peakPortfolioUsd})`);
    
    // Drawdown = (12000 - 9000) / 12000 = 25%
    assert(result5.snapshot.drawdownPct === 25, `Drawdown correct based on stored peak (got ${result5.snapshot.drawdownPct})`);

    // ── SCENARIO 6: Rolling 24h Loss — ORDER BY Correctness ─────────────────
    console.log('\n── Scenario 6: Rolling 24h Loss (ORDER BY ASC correctness) ─────');

    // Clean snapshots to fully control the baseline.
    await db.delete(portfolioSnapshots).where(eq(portfolioSnapshots.agentWallet, AGENT_WALLET));

    // Insert multiple snapshots with DIFFERENT portfolioUsd values inside the 24h window.
    // Without ORDER BY ASC, LIMIT 1 returns an arbitrary row. With ORDER BY ASC it must
    // always return t23h (the oldest, highest value = true baseline).
    const t25h = new Date(now.getTime() - 25 * 60 * 60 * 1000); // outside window — must be ignored
    const t23h = new Date(now.getTime() - 23 * 60 * 60 * 1000); // OLDEST inside → true baseline
    const t12h = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const t6h  = new Date(now.getTime() - 6  * 60 * 60 * 1000);
    const t1h  = new Date(now.getTime() - 1  * 60 * 60 * 1000); // NEWEST, smallest value

    const insertSnap6 = async (ts: Date, portfolioUsd: number) => {
      await db.insert(portfolioSnapshots).values({
        agentWallet: AGENT_WALLET,
        snapshotAt: ts,
        portfolioUsd,
        stablecoinUsd: 5000,
        tokenExposureUsd: Math.max(0, portfolioUsd - 5000),
        openPositions: 2,
        unpricedPositions: 0,
        peakPortfolioUsd: 15000,
        drawdownPct: 0,
        rollingLossPct24h: 0,
        valuationConfidence: 100
      });
    };

    await insertSnap6(t25h, 15000); // outside 24h window — must be ignored
    await insertSnap6(t23h, 11000); // oldest inside window — true 24h baseline
    await insertSnap6(t12h, 10200); // middle
    await insertSnap6(t6h,   9800); // middle
    await insertSnap6(t1h,   9500); // newest inside window — WRONG baseline if ORDER BY missing

    // Run refresh. Oldest in 24h window: t23h (portfolioUsd = 11,000).
    // Current portfolio = 9,000 (CAKE at $2 + 5,000 USDT).
    // Correct: loss = (11,000 – 9,000) / 11,000 × 100 = 18.1818%
    // Without ORDER BY: might use t1h (9,500) → loss = 5.26%, or t12h (10,200) → 11.76%
    const result6 = await service.refresh(now);
    assert(
      result6.snapshot.rollingLossPct24h === 18.1818,
      `Rolling loss uses OLDEST 24h baseline (t23h=11000, expected 18.1818%, got ${result6.snapshot.rollingLossPct24h})`
    );

    // ── SCENARIO 7: Daily Loss & Drawdown Decay/Recovery ────────────────────
    console.log('\n── Scenario 7: Daily Loss & Drawdown Decay/Recovery ────────────');
    
    // Let's modify CAKE price to $5.00 to push portfolio to new high.
    // Portfolio will be 5,000 USDT + 2,000 * 5 = 15,000 USD
    await db.update(tokenPrices)
      .set({ priceUsd: 5.0, vwap1m: 5.0, vwap15m: 5.0, vwap1h: 5.0 })
      .where(eq(tokenPrices.tokenAddress, CAKE_ADDRESS));

    PriceService.clearCache();

    const result7 = await service.refresh(now);
    
    // Current portfolio is 15,000. Peak before was 12,000. New peak should be 15,000.
    assert(result7.snapshot.portfolioUsd === 15000, `Portfolio USD rises to 15000 (got ${result7.snapshot.portfolioUsd})`);
    assert(result7.snapshot.peakPortfolioUsd === 15000, `Peak portfolio ratchets up to 15000 (got ${result7.snapshot.peakPortfolioUsd})`);
    assert(result7.snapshot.drawdownPct === 0, `Drawdown resets to 0% at new high (got ${result7.snapshot.drawdownPct})`);

    // Rolling loss: baseline is still 11,000. Current is 15,000 (which is a gain).
    // Gain means loss = 0%
    assert(result7.snapshot.rollingLossPct24h === 0, `Rolling loss resets to 0% during gain (got ${result7.snapshot.rollingLossPct24h})`);

    // ── portfolioUsd > startingCapitalUsd bounds check ───────────────────────
    // Portfolio = $5000 USDT + 2000 CAKE@$5 = $15000 > startingCapital $10000.
    // cashReservePct  = round(5000/15000*100, 2) = 33.33
    // totalExposurePct = round(10000/15000*100, 2) = 66.67
    // With the old startingCapitalUsd denominator both would exceed 100% (150% / 100% respectively).
    assert(result7.snapshot.cashReservePct === 33.33, `Gain portfolio: cashReservePct = 33.33% of $15000 (not 50% of frozen $10000 starting capital, got ${result7.snapshot.cashReservePct})`);
    assert(result7.snapshot.totalExposurePct === 66.67, `Gain portfolio: totalExposurePct = 66.67% of $15000 (bounded ≤ 100%, got ${result7.snapshot.totalExposurePct})`);
    assert(result7.snapshot.cashReservePct <= 100, `cashReservePct bounded ≤ 100% after portfolio gain (got ${result7.snapshot.cashReservePct})`);
    assert(result7.snapshot.totalExposurePct <= 100, `totalExposurePct bounded ≤ 100% after portfolio gain (got ${result7.snapshot.totalExposurePct})`);

    // ── SCENARIO 8: Snapshot Pruning ─────────────────────────────────────────
    console.log('\n── Scenario 8: Snapshot Pruning ────────────────────────────────');
    
    // Clear snapshots scoped to test wallet only — never touches other agents' snapshot history
    await db.delete(portfolioSnapshots).where(eq(portfolioSnapshots.agentWallet, AGENT_WALLET));

    const t8d = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const t6d = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    const t2h = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const insertHelper = async (date: Date) => {
      await db.insert(portfolioSnapshots).values({
        agentWallet: AGENT_WALLET,
        snapshotAt: date,
        portfolioUsd: 10000,
        stablecoinUsd: 5000,
        tokenExposureUsd: 5000,
        openPositions: 1,
        unpricedPositions: 0,
        peakPortfolioUsd: 10000,
        drawdownPct: 0,
        rollingLossPct24h: 0,
        valuationConfidence: 100
      });
    };

    await insertHelper(t8d);
    await insertHelper(t6d);
    await insertHelper(t2h);

    // Verify 3 snapshots exist
    const countBefore = await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.agentWallet, AGENT_WALLET));
    assert(countBefore.length === 3, 'Pre-pruning snapshot count is 3');

    // Run pruning with 7 days retention
    await service.pruneSnapshots(7, now);

    // Verify snapshot from 8 days ago is pruned, others remain
    const countAfter = await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.agentWallet, AGENT_WALLET));
    assert(countAfter.length === 2, `Post-pruning snapshot count is 2 (got ${countAfter.length})`);
    
    const hasT8d = countAfter.some(s => s.snapshotAt.getTime() === t8d.getTime());
    const hasT6d = countAfter.some(s => s.snapshotAt.getTime() === t6d.getTime());
    const hasT2h = countAfter.some(s => s.snapshotAt.getTime() === t2h.getTime());

    assert(!hasT8d, 'Snapshot from 8d ago was pruned');
    assert(hasT6d, 'Snapshot from 6d ago remains');
    assert(hasT2h, 'Snapshot from 2h ago remains');

    console.log('\n================================================================');
    console.log(`Validation completed. PASS: ${passCount}, FAIL: ${failCount}`);

    if (failCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('Validation script execution crashed with error:', error);
    process.exit(1);
  }
}

runValidation();
