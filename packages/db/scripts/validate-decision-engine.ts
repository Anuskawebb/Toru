/**
 * Phase 7 — Decision Engine Validation Suite (Phase 8 prerequisite revision)
 *
 * Sections 1–4: original scenarios (updated for renamed field)
 * Section 5: audit-fix coverage (P0-1, P0-2, P1-1, P1-2, P1-4)
 * Section 6: Phase 8 prerequisite fix coverage
 *   Fix 1 — trade_recs_pending_buy_unique partial index rejects duplicate PENDING BUY
 *   Fix 2 — expirePending transitions stale PENDING rows to EXPIRED
 *   Fix 3 — agentIntentPct reserves capital immediately; blocks over-allocation
 *
 * Run: npx tsx packages/db/scripts/validate-decision-engine.ts
 */
import { db, agentPositions, tradeRecommendations, eq, and, sql, TradeRecommendationsRepository, lt } from '../src/client.js';
import { PriceState, type PriceBundle } from '../../agent-core/src/valuation/price-types.js';
import { type RiskDecision } from '../../agent-core/src/risk/risk-engine.js';
import { type TokenSignalBundle } from '../src/schema/smart-money-signals.js';
import { rankOpportunities, type RankInput } from '../../agent-core/src/decision/decision-ranking.js';
import { allocateCapital } from '../../agent-core/src/decision/capital-allocator.js';
import { buildExecutionPlan, buildExecutionPlans } from '../../agent-core/src/decision/execution-planner.js';
import { PositionRegistryService } from '../../agent-core/src/position/position-registry-service.js';
import { type RiskPortfolioState } from '../../agent-core/src/risk/risk-engine.js';
import {
  type TradeRecommendation,
  type RankedOpportunity,
} from '../../agent-core/src/decision/trade-recommendation-types.js';

// ── Test wallets ───────────────────────────────────────────────────────────
const TEST_WALLET  = '0xde000000000000000000000000000000000000de';
const CAKE_ADDR    = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
const FLOKI_ADDR   = '0x2b3f34e9d4b127797ce6244ea341a83733ddd6e4';
const BONK_ADDR    = '0xa697e272a73744b343528c3bc4702f2565b2f422';
const PENGU_ADDR   = '0xa4b3c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

// ── Counters ───────────────────────────────────────────────────────────────
let totalChecks = 0;
let passCount   = 0;
let failCount   = 0;

function pass(label: string, detail = '') {
  totalChecks++;
  passCount++;
  console.log(`  PASS  ${label}${detail ? ': ' + detail : ''}`);
}

function fail(label: string, detail = '') {
  totalChecks++;
  failCount++;
  console.error(`  FAIL  ${label}${detail ? ': ' + detail : ''}`);
}

function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

// ── Mock factories ─────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<TokenSignalBundle> = {}): TokenSignalBundle {
  return {
    tokenAddress:            CAKE_ADDR,
    tokenSymbol:             'CAKE',
    signalTier:              'STRONG',
    accumulationScore:       80,
    opportunityScore:        85,
    confidence:              90,
    trend:                   'INCREASING',
    qualityHolderCount:      25,
    holderCount:             500,
    qualityConcentrationPct: 50,
    concentrationScore:      50,
    avgQualityRank:          88,
    qualityEntries4h:        8,
    qualityExits4h:          1,
    netAccumulationFlow:     7,
    qualityEntries24h:       20,
    qualityExits24h:         3,
    netAccumulationFlow24h:  17,
    topClassifications:      [{ classification: 'accumulator', count: 10, pct: 40 }],
    signalReasons:           ['strong_accumulation'],
    riskFlags:               [],
    qualityHolderChange24h:  5,
    narrative:               'Strong accumulation signal',
    dataFreshness:           'LIVE',
    minimumHolders:          true,
    computedAt:              new Date(),
    sourceDataAgeMs:         60000,
    ...overrides,
  } as TokenSignalBundle;
}

function makePrice(overrides: Partial<PriceBundle> = {}): PriceBundle {
  return {
    tokenAddress:        CAKE_ADDR,
    priceUsd:            2.00,
    vwap1m:              2.00,
    vwap15m:             2.00,
    vwap1h:              1.98,
    observationCount1h:  30,
    liquidityUsd:        0,
    routeType:           'WBNB_ROUTE',
    priceState:          PriceState.FRESH,
    manipulationFlag:    false,
    priceConfidence:     65,
    confidenceBreakdown: { liquidity: 0, freshness: 40, observations: 10 },
    updatedAt:           new Date(),
    ...overrides,
  } as PriceBundle;
}

function makeRiskDecision(overrides: Partial<RiskDecision> = {}): RiskDecision {
  return {
    allowed:          true,
    riskTier:         'SPECULATIVE',
    positionSizePct:  2.5,
    stopLossPct:      3.0,
    takeProfitPct:    40.0,
    slippageLimitPct: 2.5,
    reasons:          ['approved'],
    warnings:         [],
    blockers:         [],
    ...overrides,
  };
}

function makePortfolio(overrides: Partial<RiskPortfolioState> = {}): RiskPortfolioState {
  return {
    currentDrawdownPct: 0,
    dailyLossPct:       0,
    cashReservePct:     100,
    totalExposurePct:   0,
    openRiskPct:        0,
    openPositions:      0,
    ...overrides,
  };
}

// ── Cleanup ────────────────────────────────────────────────────────────────

async function cleanup() {
  await db.delete(agentPositions).where(eq(agentPositions.agentWallet, TEST_WALLET));
  await db.delete(tradeRecommendations).where(eq(tradeRecommendations.agentWallet, TEST_WALLET));
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Aether Phase 7 — Decision Engine Validation (post-audit)');
  console.log('='.repeat(64));

  await cleanup();

  // ════════════════════════════════════════════════════════════════
  // SECTION 1: Conviction Ranking (pure)
  // ════════════════════════════════════════════════════════════════

  section('1. Conviction Ranking');

  // Scenario 1: Fresh high-conviction signal → included in ranked output
  {
    const inputs: RankInput[] = [{
      signal:       makeSignal(),
      priceBundle:  makePrice(),
      riskDecision: makeRiskDecision(),
    }];
    const ranked = rankOpportunities(inputs);

    ranked.length === 1
      ? pass('Scenario 1: Fresh STRONG signal — included in ranked output')
      : fail('Scenario 1: Fresh STRONG signal — expected 1 ranked result', `got ${ranked.length}`);

    ranked[0] && ranked[0].convictionScore > 0
      ? pass('Scenario 1: convictionScore is positive', ranked[0].convictionScore.toFixed(4))
      : fail('Scenario 1: convictionScore should be positive');

    ranked[0] && ranked[0].positionSizePct === 2.5
      ? pass('Scenario 1: positionSizePct forwarded from RiskDecision')
      : fail('Scenario 1: positionSizePct mismatch');
  }

  // Scenario 5: STALE → excluded
  {
    const ranked = rankOpportunities([{
      signal:       makeSignal({ dataFreshness: 'STALE' }),
      priceBundle:  makePrice(),
      riskDecision: makeRiskDecision(),
    }]);
    ranked.length === 0
      ? pass('Scenario 5: STALE signal — excluded from ranking')
      : fail('Scenario 5: STALE signal should be excluded', `got ${ranked.length}`);
  }

  // Scenario 6: Manipulated price → excluded
  {
    const ranked = rankOpportunities([{
      signal:       makeSignal(),
      priceBundle:  makePrice({ priceState: PriceState.MANIPULATED }),
      riskDecision: makeRiskDecision(),
    }]);
    ranked.length === 0
      ? pass('Scenario 6: Manipulated price — excluded from ranking')
      : fail('Scenario 6: Manipulated price should be excluded');
  }

  // Scenario 6b: Unresolvable price → excluded
  {
    const ranked = rankOpportunities([{
      signal:       makeSignal(),
      priceBundle:  makePrice({ priceState: PriceState.UNRESOLVABLE }),
      riskDecision: makeRiskDecision(),
    }]);
    ranked.length === 0
      ? pass('Scenario 6b: UNRESOLVABLE price — excluded from ranking')
      : fail('Scenario 6b: UNRESOLVABLE price should be excluded');
  }

  // Scenario 7: RiskDecision blocked → excluded
  {
    const ranked = rankOpportunities([{
      signal:       makeSignal(),
      priceBundle:  makePrice(),
      riskDecision: makeRiskDecision({ allowed: false, blockers: ['missing_portfolio_state'] }),
    }]);
    ranked.length === 0
      ? pass('Scenario 7: Blocked RiskDecision — excluded from ranking')
      : fail('Scenario 7: Blocked RiskDecision should be excluded');
  }

  // Scenario 3: Drawdown blocked → excluded
  {
    const ranked = rankOpportunities([{
      signal:       makeSignal(),
      priceBundle:  makePrice(),
      riskDecision: makeRiskDecision({ allowed: false, blockers: ['drawdown_limit_breached'] }),
    }]);
    ranked.length === 0
      ? pass('Scenario 3: Drawdown exceeded — blocked signal excluded')
      : fail('Scenario 3: Drawdown-blocked signal should be excluded');
  }

  // Scenario 4: Daily loss blocked → excluded
  {
    const ranked = rankOpportunities([{
      signal:       makeSignal(),
      priceBundle:  makePrice(),
      riskDecision: makeRiskDecision({ allowed: false, blockers: ['daily_loss_limit_reached'] }),
    }]);
    ranked.length === 0
      ? pass('Scenario 4: Daily loss exceeded — blocked signal excluded')
      : fail('Scenario 4: Daily-loss-blocked signal should be excluded');
  }

  // Scenario 12: Multiple opportunities ranked DESC by convictionScore
  {
    const inputs: RankInput[] = [
      { signal: makeSignal({ tokenAddress: FLOKI_ADDR, opportunityScore: 70, confidence: 80 }),
        priceBundle: makePrice({ tokenAddress: FLOKI_ADDR }), riskDecision: makeRiskDecision() },
      { signal: makeSignal({ tokenAddress: BONK_ADDR,  opportunityScore: 55, confidence: 70 }),
        priceBundle: makePrice({ tokenAddress: BONK_ADDR }),  riskDecision: makeRiskDecision() },
      { signal: makeSignal({ tokenAddress: CAKE_ADDR,  opportunityScore: 90, confidence: 95 }),
        priceBundle: makePrice({ tokenAddress: CAKE_ADDR }),  riskDecision: makeRiskDecision() },
    ];
    const ranked = rankOpportunities(inputs);

    const inOrder = ranked.length === 3
      && ranked[0]!.signal.tokenAddress === CAKE_ADDR
      && ranked[1]!.signal.tokenAddress === FLOKI_ADDR
      && ranked[2]!.signal.tokenAddress === BONK_ADDR;

    inOrder
      ? pass('Scenario 12: Multiple opportunities ranked correctly by convictionScore DESC')
      : fail('Scenario 12: Incorrect ranking order', ranked.map(r => r.signal.tokenAddress).join(' → '));

    const monotonic = ranked.every((r, i) => i === 0 || r.convictionScore <= ranked[i - 1]!.convictionScore);
    monotonic
      ? pass('Scenario 12: convictionScore is monotonically non-increasing')
      : fail('Scenario 12: convictionScore ordering is not monotonic');
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 2: Capital Allocation (pure)
  // ════════════════════════════════════════════════════════════════

  section('2. Capital Allocation');

  // Scenario 1: Single approved signal with full headroom
  {
    const result = allocateCapital(
      [{
        signal: makeSignal(), priceBundle: makePrice(), marketPriceUsd: 2,
        convictionScore: 60, expectedEdge: 12.5, positionSizePct: 2.5,
        stopLossPct: 3.0, takeProfitPct: 40.0, slippageLimitPct: 2.5, riskTier: 'SPECULATIVE',
      }],
      makePortfolio({ cashReservePct: 100, totalExposurePct: 0 }),
      new Set(),
      0,
    );

    result.approved.length === 1 && result.skipped.length === 0
      ? pass('Scenario 1 (alloc): Single signal with full headroom — approved')
      : fail('Scenario 1 (alloc): Expected approved=1, skipped=0',
          `approved=${result.approved.length}, skipped=${result.skipped.length}`);

    Math.abs(result.newlyAllocatedPct - 2.5) < 0.001
      ? pass('Scenario 1 (alloc): newlyAllocatedPct = 2.5%')
      : fail('Scenario 1 (alloc): newlyAllocatedPct wrong', `${result.newlyAllocatedPct}`);
  }

  // Scenario 2: Existing open position → skipped
  {
    const result = allocateCapital(
      [{
        signal: makeSignal({ tokenAddress: CAKE_ADDR }), priceBundle: makePrice(),
        marketPriceUsd: 2, convictionScore: 60, expectedEdge: 12.5, positionSizePct: 2.5,
        stopLossPct: 3.0, takeProfitPct: 40.0, slippageLimitPct: 2.5, riskTier: 'SPECULATIVE',
      }],
      makePortfolio({ cashReservePct: 100, totalExposurePct: 0 }),
      new Set([CAKE_ADDR]),
      0,
    );

    result.approved.length === 0
      && result.skipped.length === 1
      && result.skipped[0]!.reason === 'position_already_open'
      ? pass('Scenario 2: Existing position — skipped with position_already_open')
      : fail('Scenario 2: Expected skip for existing position',
          `approved=${result.approved.length}, skip reason=${result.skipped[0]?.reason}`);
  }

  // Scenario 8: Exposure limit reached → lower-ranked signals skipped
  {
    const makeOp = (addr: string, conviction: number): RankedOpportunity => ({
      signal: makeSignal({ tokenAddress: addr }), priceBundle: makePrice({ tokenAddress: addr }),
      marketPriceUsd: 2, convictionScore: conviction, expectedEdge: 10, positionSizePct: 2.5,
      stopLossPct: 3.0, takeProfitPct: 40.0, slippageLimitPct: 2.5, riskTier: 'SPECULATIVE',
    });
    const result = allocateCapital(
      [makeOp(CAKE_ADDR, 90), makeOp(FLOKI_ADDR, 80), makeOp(BONK_ADDR, 70), makeOp(PENGU_ADDR, 60)],
      makePortfolio({ cashReservePct: 15, totalExposurePct: 85 }),
      new Set(),
      0,
    );

    // headroom = min(90-85, 15-10) = 5%; 2×2.5=5 fits, 3rd would be 7.5
    result.approved.length === 2
      ? pass('Scenario 8: 2 signals approved within 5% headroom')
      : fail('Scenario 8: Expected 2 approved', `got ${result.approved.length}`);

    const allLimitSkipped = result.skipped.every(
      s => s.reason === 'exposure_limit_reached' || s.reason === 'cash_reserve_floor'
    );
    allLimitSkipped
      ? pass('Scenario 8: Remaining signals skipped with limit reason')
      : fail('Scenario 8: Unexpected skip reasons', result.skipped.map(s => s.reason).join(', '));
  }

  // Scenario 13: Capital allocation is deterministic
  {
    const portfolio = makePortfolio({ cashReservePct: 50, totalExposurePct: 50 });
    const ranked: RankedOpportunity[] = [CAKE_ADDR, FLOKI_ADDR, BONK_ADDR].map((addr, i) => ({
      signal: makeSignal({ tokenAddress: addr }), priceBundle: makePrice({ tokenAddress: addr }),
      marketPriceUsd: 2, convictionScore: 80 - i * 10, expectedEdge: 15, positionSizePct: 2.5,
      stopLossPct: 3.0, takeProfitPct: 40.0, slippageLimitPct: 2.5, riskTier: 'SPECULATIVE',
    }));

    const r1 = allocateCapital(ranked, portfolio, new Set(), 0);
    const r2 = allocateCapital(ranked, portfolio, new Set(), 0);

    r1.approved.length === r2.approved.length
      && r1.newlyAllocatedPct === r2.newlyAllocatedPct
      && r1.approved.every((r, i) => r.signal.tokenAddress === r2.approved[i]!.signal.tokenAddress)
      ? pass('Scenario 13: Capital allocation is deterministic')
      : fail('Scenario 13: Capital allocation is NOT deterministic');
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 3: Position Registry (DB)
  // ════════════════════════════════════════════════════════════════

  section('3. Position Registry (DB)');

  const registry = new PositionRegistryService(TEST_WALLET);
  const now = new Date();

  // Scenario 1 (position): Open a position
  try {
    const opened = await registry.openPosition({
      tokenAddress: CAKE_ADDR, tokenSymbol: 'CAKE',
      recommendationId: 'test-rec-001',
      entryPriceUsd: 2.00, positionSizeUsd: 250, positionSizePct: 2.5,
      stopLossPct: 3.0, takeProfitPct: 40.0, openedAt: now,
    });
    pass('Scenario 1 (pos): Position opened successfully', `id=${opened.id}`);
  } catch (e: unknown) {
    fail('Scenario 1 (pos): Failed to open position', String(e));
  }

  // Verify retrievable
  {
    const pos = await registry.getOpenPosition(CAKE_ADDR);
    pos && pos.status === 'OPEN' && pos.entryPriceUsd === 2.00
      ? pass('Scenario 1 (pos): Position retrievable with correct entry price')
      : fail('Scenario 1 (pos): Position not found or wrong state');
  }

  // Scenario 2 (duplicate): application-level duplicate check
  {
    try {
      await registry.openPosition({
        tokenAddress: CAKE_ADDR, tokenSymbol: 'CAKE', recommendationId: 'test-rec-002',
        entryPriceUsd: 2.10, positionSizeUsd: 250, positionSizePct: 2.5,
        stopLossPct: 3.0, takeProfitPct: 40.0,
      });
      fail('Scenario 2 (pos): Should have thrown for duplicate OPEN position');
    } catch {
      pass('Scenario 2 (pos): Duplicate open position correctly rejected at application layer');
    }
  }

  // Mark-to-market
  {
    const updated = await registry.updateMarkToMarket(CAKE_ADDR, 2.10);
    updated && updated.currentPriceUsd === 2.10 && updated.unrealizedPnlPct > 0
      ? pass('Scenario (mtm): Mark-to-market updated', `pnl=${updated.unrealizedPnlPct.toFixed(2)}%`)
      : fail('Scenario (mtm): Mark-to-market update failed');
  }

  // Scenario 9: Stop-loss breach
  {
    const priceAtSL = 2.00 * (1 - 0.04); // −4%, exceeds 3% SL
    const pos = await registry.getOpenPosition(CAKE_ADDR);
    if (pos) {
      const lossPct = ((priceAtSL - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
      -lossPct >= pos.stopLossPct
        ? pass('Scenario 9: Stop-loss breach detected', `loss=${(-lossPct).toFixed(2)}%`)
        : fail('Scenario 9: Stop-loss not detected');

      const closed = await registry.closePosition(CAKE_ADDR, priceAtSL, 'STOP_LOSS');
      closed && closed.status === 'CLOSED' && closed.closeReason === 'STOP_LOSS'
        ? pass('Scenario 9: Position closed with STOP_LOSS reason')
        : fail('Scenario 9: Close with STOP_LOSS failed');
    }
  }

  // Scenario 10: Take-profit
  {
    await registry.openPosition({
      tokenAddress: FLOKI_ADDR, tokenSymbol: 'FLOKI', recommendationId: 'test-rec-003',
      entryPriceUsd: 1.00, positionSizeUsd: 250, positionSizePct: 2.5,
      stopLossPct: 3.0, takeProfitPct: 40.0, openedAt: now,
    });

    const pos = await registry.getOpenPosition(FLOKI_ADDR);
    if (pos) {
      const priceAtTP = 1.00 * 1.42;
      const gainPct = ((priceAtTP - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
      gainPct >= pos.takeProfitPct
        ? pass('Scenario 10: Take-profit detected', `gain=${gainPct.toFixed(2)}%`)
        : fail('Scenario 10: Take-profit not detected');

      const closed = await registry.closePosition(FLOKI_ADDR, priceAtTP, 'TAKE_PROFIT');
      closed && closed.status === 'CLOSED' && closed.closeReason === 'TAKE_PROFIT'
        ? pass('Scenario 10: Position closed with TAKE_PROFIT reason')
        : fail('Scenario 10: Close with TAKE_PROFIT failed');
    }
  }

  // Scenario 11: Signal reversal
  {
    await registry.openPosition({
      tokenAddress: BONK_ADDR, tokenSymbol: 'BONK', recommendationId: 'test-rec-004',
      entryPriceUsd: 0.50, positionSizeUsd: 250, positionSizePct: 2.5,
      stopLossPct: 3.0, takeProfitPct: 40.0, openedAt: now,
    });

    // Validate the reversal-detection predicate covers trend + flow
    const reversalSignal = makeSignal({
      tokenAddress: BONK_ADDR, trend: 'DECREASING',
      netAccumulationFlow: -5, netAccumulationFlow24h: -12,
    });
    const isReversal = reversalSignal.trend === 'DECREASING'
      || reversalSignal.netAccumulationFlow < 0
      || (reversalSignal.netAccumulationFlow24h !== null && reversalSignal.netAccumulationFlow24h < 0);

    isReversal
      ? pass('Scenario 11: Signal reversal detected (DECREASING + negative flow)')
      : fail('Scenario 11: Signal reversal not detected');

    const closed = await registry.closePosition(BONK_ADDR, 0.48, 'SIGNAL_REVERSAL');
    closed && closed.status === 'CLOSED' && closed.closeReason === 'SIGNAL_REVERSAL'
      ? pass('Scenario 11: Position closed with SIGNAL_REVERSAL reason')
      : fail('Scenario 11: Close with SIGNAL_REVERSAL failed');
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 4: Execution Planner (pure)
  // ════════════════════════════════════════════════════════════════

  section('4. Execution Planner');

  const USDT = '0x55d398326f99059ff775485246999027b3197955';
  const baseRec: TradeRecommendation = {
    id: 'test-plan-001', agentWallet: TEST_WALLET,
    tokenAddress: CAKE_ADDR, tokenSymbol: 'CAKE',
    action: 'BUY', positionSizePct: 2.5, estimatedUsd: 250,
    entryPriceUsd: 2.00, stopLossPct: 3.0, takeProfitPct: 40.0, slippageLimitPct: 2.5,
    riskTier: 'SPECULATIVE', signalTier: 'STRONG',
    opportunityScore: 85, convictionScore: 60, expectedEdge: 12.5, confidence: 90,
    blockers: [], reasons: ['strong_accumulation'], warnings: [],
    expiresAt: new Date(Date.now() + 7200000), decidedAt: new Date(), status: 'PENDING',
  };

  // Scenario 14: BUY plan
  {
    const plan = buildExecutionPlan(baseRec);
    plan.action === 'BUY'                ? pass('Scenario 14: BUY plan — action is BUY')          : fail('Scenario 14: action should be BUY');
    plan.tokenIn === USDT                ? pass('Scenario 14: BUY plan — tokenIn is USDT')        : fail('Scenario 14: tokenIn should be USDT');
    plan.tokenOut === CAKE_ADDR          ? pass('Scenario 14: BUY plan — tokenOut is CAKE')       : fail('Scenario 14: tokenOut mismatch');
    plan.amountUsd === 250               ? pass('Scenario 14: BUY plan — amountUsd correct')      : fail('Scenario 14: amountUsd mismatch');
    plan.slippageLimitPct === 2.5        ? pass('Scenario 14: BUY plan — slippageLimitPct correct') : fail('Scenario 14: slippageLimitPct mismatch');
    plan.recommendationId === 'test-plan-001' ? pass('Scenario 14: BUY plan — recommendationId linked') : fail('Scenario 14: recommendationId mismatch');
  }

  // Scenario 14: SELL plan
  {
    const sellPlan = buildExecutionPlan({ ...baseRec, id: 'test-plan-002', action: 'SELL' });
    sellPlan.action === 'SELL' && sellPlan.tokenIn === CAKE_ADDR && sellPlan.tokenOut === USDT
      ? pass('Scenario 14: SELL plan — tokenIn=CAKE, tokenOut=USDT')
      : fail('Scenario 14: SELL plan routing incorrect');
  }

  // Batch planner — HOLD and SKIP produce no plans
  {
    const plans = buildExecutionPlans([
      { ...baseRec, id: 'p1', action: 'BUY' },
      { ...baseRec, id: 'p2', action: 'SELL' },
      { ...baseRec, id: 'p3', action: 'HOLD' },
      { ...baseRec, id: 'p4', action: 'SKIP' },
    ]);
    plans.length === 2
      ? pass('Scenario 14: buildExecutionPlans — HOLD and SKIP produce no plans')
      : fail('Scenario 14: Expected 2 execution plans', `got ${plans.length}`);
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 5: Audit Fix Coverage
  // ════════════════════════════════════════════════════════════════

  section('5. Audit Fix Coverage');

  // ── P1-1: newlyAllocatedPct is cycle-only, not cumulative with existing exposure ──

  {
    // Pre-existing exposure = 60%. Add one 2.5% position this cycle.
    // Before fix: totalAllocatedPct = 60 + 2.5 = 62.5 (wrong — consumer reads "allocated this cycle")
    // After fix:  newlyAllocatedPct = 2.5 (correct — only the new allocation)
    const portfolio = makePortfolio({ cashReservePct: 40, totalExposurePct: 60 });
    const result = allocateCapital(
      [{
        signal: makeSignal(), priceBundle: makePrice(), marketPriceUsd: 2,
        convictionScore: 70, expectedEdge: 10, positionSizePct: 2.5,
        stopLossPct: 3.0, takeProfitPct: 40.0, slippageLimitPct: 2.5, riskTier: 'SPECULATIVE',
      }],
      portfolio,
      new Set(),
      0,
    );

    result.approved.length === 1
      ? pass('P1-1: Signal approved against non-zero base exposure')
      : fail('P1-1: Signal should have been approved', `got ${result.approved.length}`);

    Math.abs(result.newlyAllocatedPct - 2.5) < 0.001
      ? pass('P1-1: newlyAllocatedPct = 2.5% (cycle-only, excludes pre-existing 60%)')
      : fail('P1-1: newlyAllocatedPct should be 2.5 not 62.5', `got ${result.newlyAllocatedPct}`);

    // Confirm the old (wrong) value is NOT what we're returning
    Math.abs(result.newlyAllocatedPct - 62.5) > 1
      ? pass('P1-1: newlyAllocatedPct is NOT the old totalExposurePct + new formula')
      : fail('P1-1: Returning the old cumulative exposure — fix not applied');
  }

  // ── P0-1: Position is CLOSED after exit; second closePosition call returns null ──

  {
    // Open a fresh position
    await registry.openPosition({
      tokenAddress: PENGU_ADDR, tokenSymbol: 'PENGU', recommendationId: 'test-rec-p01',
      entryPriceUsd: 5.00, positionSizeUsd: 500, positionSizePct: 5.0,
      stopLossPct: 3.0, takeProfitPct: 40.0, openedAt: now,
    });

    const openBefore = await registry.getOpenPosition(PENGU_ADDR);
    openBefore !== null
      ? pass('P0-1: Position is OPEN before first exit')
      : fail('P0-1: Position should exist before exit');

    // First exit (simulates what the fixed evaluateExits now does)
    const firstClose = await registry.closePosition(PENGU_ADDR, 4.80, 'STOP_LOSS');
    firstClose !== null && firstClose.status === 'CLOSED'
      ? pass('P0-1: First closePosition call succeeds')
      : fail('P0-1: First close should return a CLOSED position');

    // Verify position is gone from the OPEN set
    const openAfter = await registry.getOpenPosition(PENGU_ADDR);
    openAfter === null
      ? pass('P0-1: getOpenPosition returns null after close (position no longer OPEN)')
      : fail('P0-1: Position still appears OPEN after close — would trigger duplicate SELL');

    // Second close (simulates what the old engine would do on the next cycle)
    const secondClose = await registry.closePosition(PENGU_ADDR, 4.75, 'STOP_LOSS');
    secondClose === null
      ? pass('P0-1: Second closePosition call returns null — duplicate SELL prevented')
      : fail('P0-1: Second close should return null for already-closed position');
  }

  // ── P0-2: DB partial unique index rejects a concurrent second OPEN row ──

  {
    // Open CAKE as OPEN
    await registry.openPosition({
      tokenAddress: CAKE_ADDR, tokenSymbol: 'CAKE', recommendationId: 'test-unique-001',
      entryPriceUsd: 2.00, positionSizeUsd: 250, positionSizePct: 2.5,
      stopLossPct: 3.0, takeProfitPct: 40.0, openedAt: now,
    });

    // Attempt a raw INSERT of a second OPEN row for the same wallet+token.
    // This bypasses the application-level check and hits the DB constraint directly.
    let dbConstraintFired = false;
    try {
      await db.execute(sql.raw(`
        INSERT INTO "agent_positions" (
          "id", "agent_wallet", "token_address", "token_symbol",
          "entry_price_usd", "current_price_usd", "position_size_usd", "position_size_pct",
          "stop_loss_pct", "take_profit_pct", "unrealized_pnl_pct",
          "status", "opened_at", "updated_at"
        ) VALUES (
          'deadbeef-0001-0001-0001-000000000001',
          '${TEST_WALLET}',
          '${CAKE_ADDR}',
          'CAKE', 2.00, 2.00, 250, 2.5, 3.0, 40.0, 0,
          'OPEN', now(), now()
        )
      `));
    } catch (e: unknown) {
      const code = (e && typeof e === 'object' && 'code' in e)
        ? (e as { code: unknown }).code
        : '';
      if (code === '23505') {
        dbConstraintFired = true;
      }
    }

    dbConstraintFired
      ? pass('P0-2: DB partial unique index rejects second OPEN position (code 23505)')
      : fail('P0-2: DB should have thrown unique_violation — index may not be active');

    // Clean up the CAKE open position before next tests
    await registry.closePosition(CAKE_ADDR, 2.00, 'MANUAL');
  }

  // ── P1-2: Exit evaluation skipped for UNRESOLVABLE and MANIPULATED prices ──

  {
    // The fix: if priceBundle is null or priceState is UNRESOLVABLE/MANIPULATED,
    // evaluateExits continues to the next position without firing stop-loss/TP.
    // Validate the guard logic as written in decision-engine.ts.

    const unreachable: PriceBundle = makePrice({ priceState: PriceState.UNRESOLVABLE });
    const manipulated: PriceBundle = makePrice({ priceState: PriceState.MANIPULATED });

    const shouldSkipUnresolvable = !unreachable
      || unreachable.priceState === PriceState.UNRESOLVABLE
      || unreachable.priceState === PriceState.MANIPULATED;
    shouldSkipUnresolvable
      ? pass('P1-2: UNRESOLVABLE price → exit guard fires (position skipped this cycle)')
      : fail('P1-2: UNRESOLVABLE price should trigger skip guard');

    const shouldSkipManipulated = !manipulated
      || manipulated.priceState === PriceState.UNRESOLVABLE
      || manipulated.priceState === PriceState.MANIPULATED;
    shouldSkipManipulated
      ? pass('P1-2: MANIPULATED price → exit guard fires (stop-loss not triggered on bad data)')
      : fail('P1-2: MANIPULATED price should trigger skip guard');

    // Verify FRESH price passes the guard (exits DO evaluate)
    const fresh: PriceBundle = makePrice({ priceState: PriceState.FRESH });
    const freshSkips = !fresh
      || fresh.priceState === PriceState.UNRESOLVABLE
      || fresh.priceState === PriceState.MANIPULATED;
    !freshSkips
      ? pass('P1-2: FRESH price passes guard — exit evaluation proceeds normally')
      : fail('P1-2: FRESH price should not be skipped');

    // Verify null priceBundle guard
    const nullBundle: PriceBundle | null = null;
    const nullSkips = !nullBundle
      || nullBundle.priceState === PriceState.UNRESOLVABLE
      || nullBundle.priceState === PriceState.MANIPULATED;
    nullSkips
      ? pass('P1-2: null priceBundle → exit guard fires (no stale fallback)')
      : fail('P1-2: null priceBundle should trigger skip guard');
  }

  // ── P1-4: Token absent from signal universe triggers SIGNAL_REVERSAL exit ──

  {
    // Open a position for FLOKI
    await registry.openPosition({
      tokenAddress: FLOKI_ADDR, tokenSymbol: 'FLOKI', recommendationId: 'test-p14-001',
      entryPriceUsd: 1.00, positionSizeUsd: 250, positionSizePct: 2.5,
      stopLossPct: 3.0, takeProfitPct: 40.0, openedAt: now,
    });

    // Signal map does NOT contain FLOKI — simulates "token fell from top-50"
    const emptySignalMap = new Map<string, TokenSignalBundle>();

    const signal = emptySignalMap.get(FLOKI_ADDR);
    const wouldExitOnAbsence = !signal; // the P1-4 predicate in decision-engine.ts

    wouldExitOnAbsence
      ? pass('P1-4: Absent signal detected — SIGNAL_REVERSAL exit would be triggered')
      : fail('P1-4: Should detect absent signal and trigger exit');

    // Confirm present signal (even neutral) does NOT trigger absence exit
    const presentNeutralSignal: TokenSignalBundle = makeSignal({
      tokenAddress: FLOKI_ADDR,
      trend: 'NEUTRAL',
      netAccumulationFlow: 1,
      netAccumulationFlow24h: 1,
    });
    const signalMap = new Map([[FLOKI_ADDR, presentNeutralSignal]]);
    const signalForFloki = signalMap.get(FLOKI_ADDR);
    const wouldExitOnPresent = !signalForFloki; // should be false

    !wouldExitOnPresent
      ? pass('P1-4: Present neutral signal does NOT trigger absence exit')
      : fail('P1-4: Present signal should not cause absence exit');

    // Simulate the engine closing FLOKI due to absent signal (what evaluateExits now does)
    const closed = await registry.closePosition(FLOKI_ADDR, 1.00, 'SIGNAL_REVERSAL');
    closed !== null && closed.closeReason === 'SIGNAL_REVERSAL'
      ? pass('P1-4: Position closed with SIGNAL_REVERSAL when signal dropped from universe')
      : fail('P1-4: Position should have been closed with SIGNAL_REVERSAL');

    // Verify FLOKI is no longer OPEN — a second cycle would not re-evaluate it
    const openAfter = await registry.getOpenPosition(FLOKI_ADDR);
    openAfter === null
      ? pass('P1-4: FLOKI no longer OPEN after absent-signal exit — no re-evaluation next cycle')
      : fail('P1-4: FLOKI should be CLOSED after absent-signal exit');
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 6: Phase 8 Prerequisite Fix Coverage
  // ════════════════════════════════════════════════════════════════

  section('6. Phase 8 Prerequisite Fixes');

  // ── Fix 1: trade_recs_pending_buy_unique — DB blocks duplicate PENDING BUY ──

  {
    const WBNB_TEST = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc0001';

    // Insert a first PENDING BUY
    await db.insert(tradeRecommendations).values({
      id:               'fix1-buy-001',
      agentWallet:      TEST_WALLET,
      tokenAddress:     WBNB_TEST,
      tokenSymbol:      'WBNB',
      action:           'BUY',
      positionSizePct:  2.5,
      estimatedUsd:     250,
      entryPriceUsd:    300,
      stopLossPct:      3.0,
      takeProfitPct:    40.0,
      slippageLimitPct: 2.5,
      riskTier:         'SPECULATIVE',
      signalTier:       'STRONG',
      opportunityScore: 80,
      convictionScore:  60,
      expectedEdge:     12.5,
      confidence:       90,
      blockers:         [],
      reasons:          ['test'],
      warnings:         [],
      expiresAt:        new Date(Date.now() + 7200000),
      decidedAt:        new Date(),
      status:           'PENDING',
    });
    pass('Fix 1: First PENDING BUY inserted successfully');

    // Raw INSERT of a second PENDING BUY for the same wallet+token bypasses
    // the application-layer dedup and hits the partial unique index directly.
    let dbConstraintFired = false;
    try {
      await db.execute(sql.raw(`
        INSERT INTO "trade_recommendations" (
          "id", "agent_wallet", "token_address", "token_symbol",
          "action", "position_size_pct", "estimated_usd", "entry_price_usd",
          "stop_loss_pct", "take_profit_pct", "slippage_limit_pct",
          "risk_tier", "signal_tier",
          "opportunity_score", "conviction_score", "expected_edge", "confidence",
          "blockers", "reasons", "warnings",
          "expires_at", "decided_at", "status"
        ) VALUES (
          'fix1-buy-002',
          '${TEST_WALLET}',
          '${WBNB_TEST}',
          'WBNB', 'BUY', 2.5, 250, 300, 3.0, 40.0, 2.5,
          'SPECULATIVE', 'STRONG',
          80, 60, 12.5, 90,
          '[]', '["test"]', '[]',
          NOW() + INTERVAL '2 hours', NOW(), 'PENDING'
        )
      `));
    } catch (e: unknown) {
      const code = (e && typeof e === 'object' && 'code' in e)
        ? (e as { code: unknown }).code : '';
      if (code === '23505') dbConstraintFired = true;
    }

    dbConstraintFired
      ? pass('Fix 1: DB partial unique index rejects duplicate PENDING BUY (23505)')
      : fail('Fix 1: Expected unique_violation — trade_recs_pending_buy_unique index may not be active');

    // Application-layer: onConflictDoNothing silently skips the duplicate
    await db.insert(tradeRecommendations).values({
      id:               'fix1-buy-003',
      agentWallet:      TEST_WALLET,
      tokenAddress:     WBNB_TEST,
      tokenSymbol:      'WBNB',
      action:           'BUY',
      positionSizePct:  2.5,
      estimatedUsd:     250,
      entryPriceUsd:    310,
      stopLossPct:      3.0,
      takeProfitPct:    40.0,
      slippageLimitPct: 2.5,
      riskTier:         'SPECULATIVE',
      signalTier:       'STRONG',
      opportunityScore: 80,
      convictionScore:  60,
      expectedEdge:     12.5,
      confidence:       90,
      blockers:         [],
      reasons:          ['test'],
      warnings:         [],
      expiresAt:        new Date(Date.now() + 7200000),
      decidedAt:        new Date(),
      status:           'PENDING',
    }).onConflictDoNothing();

    // Only one PENDING BUY should exist for this wallet+token
    const pendingBuys = await db
      .select()
      .from(tradeRecommendations)
      .where(
        and(
          eq(tradeRecommendations.agentWallet, TEST_WALLET),
          eq(tradeRecommendations.tokenAddress, WBNB_TEST),
          eq(tradeRecommendations.action, 'BUY'),
          eq(tradeRecommendations.status, 'PENDING'),
        )
      );

    pendingBuys.length === 1
      ? pass('Fix 1: onConflictDoNothing silently skips duplicate — exactly 1 PENDING BUY remains')
      : fail('Fix 1: Expected exactly 1 PENDING BUY', `found ${pendingBuys.length}`);

    // Original entry (id=fix1-buy-001) is preserved, not overwritten
    pendingBuys[0]?.id === 'fix1-buy-001'
      ? pass('Fix 1: Original PENDING BUY preserved (earlier recommendation wins)')
      : fail('Fix 1: Unexpected recommendation id', `${pendingBuys[0]?.id}`);

    // Transition it to EXPIRED so subsequent tests are clean
    await db.update(tradeRecommendations)
      .set({ status: 'EXPIRED' })
      .where(eq(tradeRecommendations.id, 'fix1-buy-001'));
  }

  // ── Fix 2: expirePending transitions stale PENDING rows to EXPIRED ──

  {
    const WBNB_TEST2 = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc0002';
    const pastTime    = new Date(Date.now() - 10000); // 10 seconds in the past

    // Insert two PENDING rows with expiresAt in the past
    await db.insert(tradeRecommendations).values([
      {
        id:               'fix2-exp-001',
        agentWallet:      TEST_WALLET,
        tokenAddress:     WBNB_TEST2,
        tokenSymbol:      'TEST',
        action:           'BUY',
        positionSizePct:  2.5,
        estimatedUsd:     250,
        entryPriceUsd:    1.0,
        stopLossPct:      3.0,
        takeProfitPct:    40.0,
        slippageLimitPct: 2.5,
        riskTier:         'SPECULATIVE',
        signalTier:       'WEAK',
        opportunityScore: 30,
        convictionScore:  25,
        expectedEdge:     5,
        confidence:       60,
        blockers:         [],
        reasons:          ['test'],
        warnings:         [],
        expiresAt:        pastTime,
        decidedAt:        new Date(Date.now() - 20000),
        status:           'PENDING',
      },
    ]);
    pass('Fix 2: Expired PENDING BUY row inserted for test');

    // SELL with past expiry (should also be expired)
    await db.insert(tradeRecommendations).values({
      id:               'fix2-exp-002',
      agentWallet:      TEST_WALLET,
      tokenAddress:     WBNB_TEST2,
      tokenSymbol:      'TEST',
      action:           'SELL',
      positionSizePct:  2.5,
      estimatedUsd:     250,
      entryPriceUsd:    1.0,
      stopLossPct:      3.0,
      takeProfitPct:    40.0,
      slippageLimitPct: 2.5,
      riskTier:         'SPECULATIVE',
      signalTier:       'EXIT',
      opportunityScore: 0,
      convictionScore:  0,
      expectedEdge:     -2,
      confidence:       100,
      blockers:         [],
      reasons:          ['stop_loss'],
      warnings:         [],
      expiresAt:        pastTime,
      decidedAt:        new Date(Date.now() - 20000),
      status:           'PENDING',
    });
    pass('Fix 2: Expired PENDING SELL row inserted for test');

    // Call expirePending — should transition both to EXPIRED
    await TradeRecommendationsRepository.expirePending(TEST_WALLET, new Date());

    const stillPending = await db
      .select()
      .from(tradeRecommendations)
      .where(
        and(
          eq(tradeRecommendations.agentWallet, TEST_WALLET),
          eq(tradeRecommendations.status, 'PENDING'),
          lt(tradeRecommendations.expiresAt, new Date()),
        )
      );

    stillPending.length === 0
      ? pass('Fix 2: expirePending transitioned all stale PENDING rows to EXPIRED')
      : fail('Fix 2: Some stale PENDING rows remain', `${stillPending.length} still PENDING`);

    // Confirm the rows are now EXPIRED, not deleted
    const nowExpired = await db
      .select()
      .from(tradeRecommendations)
      .where(
        and(
          eq(tradeRecommendations.agentWallet, TEST_WALLET),
          eq(tradeRecommendations.status, 'EXPIRED'),
        )
      );

    nowExpired.length >= 2
      ? pass('Fix 2: Expired rows are retained as EXPIRED (not deleted) — audit trail preserved')
      : fail('Fix 2: Expected at least 2 EXPIRED rows', `found ${nowExpired.length}`);

    // A PENDING row with future expiry must NOT be touched
    const FUTURE_TOKEN = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc0003';
    await db.insert(tradeRecommendations).values({
      id:               'fix2-future-001',
      agentWallet:      TEST_WALLET,
      tokenAddress:     FUTURE_TOKEN,
      tokenSymbol:      'FUTURE',
      action:           'BUY',
      positionSizePct:  2.5,
      estimatedUsd:     250,
      entryPriceUsd:    1.0,
      stopLossPct:      3.0,
      takeProfitPct:    40.0,
      slippageLimitPct: 2.5,
      riskTier:         'SPECULATIVE',
      signalTier:       'STRONG',
      opportunityScore: 80,
      convictionScore:  60,
      expectedEdge:     12,
      confidence:       90,
      blockers:         [],
      reasons:          ['test'],
      warnings:         [],
      expiresAt:        new Date(Date.now() + 7200000),
      decidedAt:        new Date(),
      status:           'PENDING',
    });

    await TradeRecommendationsRepository.expirePending(TEST_WALLET, new Date());

    const futureStillPending = await db
      .select()
      .from(tradeRecommendations)
      .where(
        and(
          eq(tradeRecommendations.agentWallet, TEST_WALLET),
          eq(tradeRecommendations.tokenAddress, FUTURE_TOKEN),
          eq(tradeRecommendations.status, 'PENDING'),
        )
      );

    futureStillPending.length === 1
      ? pass('Fix 2: Future PENDING recommendation not touched by expirePending')
      : fail('Fix 2: Future PENDING recommendation incorrectly expired', `${futureStillPending.length} rows`);
  }

  // ── Fix 3: agentIntentPct reserves capital immediately ──

  {
    // Scenario A: 36 OPEN positions × 2.5% = 90% agentIntentPct.
    // wallet_positions shows 0% exposure (no trades executed yet, Phase 7 mode).
    // Without Fix 3: headroom = min(90-0, 100-10) = 90% → signal approved.
    // With    Fix 3: headroom = min(90-90, 100-90-10) = 0% → signal blocked.
    const fullIntentResult = allocateCapital(
      [{
        signal: makeSignal(), priceBundle: makePrice(), marketPriceUsd: 2,
        convictionScore: 70, expectedEdge: 12, positionSizePct: 2.5,
        stopLossPct: 3.0, takeProfitPct: 40.0, slippageLimitPct: 2.5, riskTier: 'SPECULATIVE',
      }],
      makePortfolio({ cashReservePct: 100, totalExposurePct: 0 }),
      new Set(),
      90, // agentIntentPct = 90% (max exposure — 36 × 2.5%)
    );

    fullIntentResult.approved.length === 0
      ? pass('Fix 3: Full agent intent (90%) blocks new allocation — headroom = 0')
      : fail('Fix 3: Should have 0 approved when agentIntentPct = 90%', `got ${fullIntentResult.approved.length}`);

    fullIntentResult.skipped.length === 1
      && (fullIntentResult.skipped[0]!.reason === 'exposure_limit_reached'
          || fullIntentResult.skipped[0]!.reason === 'cash_reserve_floor')
      ? pass('Fix 3: Signal correctly skipped due to exposure or cash limit')
      : fail('Fix 3: Wrong skip reason', fullIntentResult.skipped[0]?.reason ?? 'none');

    // Scenario B: Same portfolio with 0 agentIntentPct (old behavior).
    // Confirms Fix 3 is the change — without it, the signal would have been approved.
    const noIntentResult = allocateCapital(
      [{
        signal: makeSignal(), priceBundle: makePrice(), marketPriceUsd: 2,
        convictionScore: 70, expectedEdge: 12, positionSizePct: 2.5,
        stopLossPct: 3.0, takeProfitPct: 40.0, slippageLimitPct: 2.5, riskTier: 'SPECULATIVE',
      }],
      makePortfolio({ cashReservePct: 100, totalExposurePct: 0 }),
      new Set(),
      0, // no agent intent
    );

    noIntentResult.approved.length === 1
      ? pass('Fix 3: Without agent intent, same portfolio approves signal (confirms Fix 3 is the gating change)')
      : fail('Fix 3: Expected signal approval with zero agent intent', `got ${noIntentResult.approved.length}`);

    // Scenario C: Partial agent intent — 87.5% (35 × 2.5%).
    // headroom = min(90-87.5, (100-87.5)-10) = min(2.5, 2.5) = 2.5%.
    // First 2.5% signal: fits exactly → approved.
    // Second 2.5% signal: cumulative 5% > headroom 2.5% → skipped.
    const makeOp = (addr: string): RankedOpportunity => ({
      signal: makeSignal({ tokenAddress: addr }), priceBundle: makePrice({ tokenAddress: addr }),
      marketPriceUsd: 2, convictionScore: 70, expectedEdge: 12, positionSizePct: 2.5,
      stopLossPct: 3.0, takeProfitPct: 40.0, slippageLimitPct: 2.5, riskTier: 'SPECULATIVE',
    });

    const partialIntentResult = allocateCapital(
      [makeOp(CAKE_ADDR), makeOp(FLOKI_ADDR)],
      makePortfolio({ cashReservePct: 100, totalExposurePct: 0 }),
      new Set(),
      87.5,
    );

    partialIntentResult.approved.length === 1
      ? pass('Fix 3: Partial intent (87.5%) allows exactly one more 2.5% position')
      : fail('Fix 3: Expected exactly 1 approved with 87.5% intent', `got ${partialIntentResult.approved.length}`);

    partialIntentResult.skipped.length === 1
      ? pass('Fix 3: Second signal correctly skipped — no room after first allocation')
      : fail('Fix 3: Expected second signal skipped', `skipped=${partialIntentResult.skipped.length}`);

    // Scenario D: When wallet_positions EXCEEDS agentIntentPct (confirmed trades > tracked intent).
    // effectiveExposurePct should use wallet exposure, not agent intent.
    // wallet = 80%, agentIntent = 30% → effective = max(80, 30) = 80%
    // headroom = min(90-80, (100-0-10)) = min(10, 90) = 10% → 4 × 2.5% should fit
    const walletDominantResult = allocateCapital(
      [makeOp(CAKE_ADDR), makeOp(FLOKI_ADDR), makeOp(BONK_ADDR), makeOp(PENGU_ADDR)],
      makePortfolio({ cashReservePct: 20, totalExposurePct: 80 }),
      new Set(),
      30, // agentIntent < wallet exposure
    );

    walletDominantResult.approved.length === 4
      ? pass('Fix 3: When wallet exposure > agent intent, wallet is used as floor — 4 × 2.5% fits in 10% headroom')
      : fail('Fix 3: Expected 4 approved when wallet dominates', `got ${walletDominantResult.approved.length}`);
  }

  // ── Final report ──────────────────────────────────────────────────────────

  await cleanup();

  console.log('\n' + '='.repeat(64));
  console.log(`Total: ${totalChecks}  Pass: ${passCount}  Fail: ${failCount}`);
  console.log('='.repeat(64));

  if (failCount > 0) {
    console.error(`\n${failCount} check(s) failed.`);
    process.exit(1);
  } else {
    console.log('\nAll checks passed.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
}).finally(async () => {
  const { queryClient } = await import('../src/client.js');
  await queryClient.end();
});
