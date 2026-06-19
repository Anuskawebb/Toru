import { randomUUID } from 'crypto';
import {
  db,
  tradeRecommendations,
  SmartMoneySignalsRepository,
  TradeRecommendationsRepository,
  type TokenSignalBundle,
} from '@aether/db';
import { PriceService } from '../valuation/price-service.js';
import { PriceState } from '../valuation/price-types.js';
import { RiskEngine, type RiskInput } from '../risk/risk-engine.js';
import { PortfolioStateService, type PortfolioStateConfig } from '../portfolio/portfolio-state-service.js';
import { type PortfolioStateSnapshot } from '../portfolio/portfolio-types.js';
import { PositionRegistryService } from '../position/position-registry-service.js';
import { rankOpportunities, type RankInput } from './decision-ranking.js';
import { allocateCapital } from './capital-allocator.js';
import { buildExecutionPlans } from './execution-planner.js';
import {
  type TradeRecommendation,
  type AgentPosition,
  type RankedOpportunity,
  type ExecutionPlan,
} from './trade-recommendation-types.js';

// Signal STALE threshold matches PriceObservationService (2h)
const RECOMMENDATION_TTL_MS = 2 * 60 * 60 * 1000;

// Exit recommendations expire quickly — stale exit plans are dangerous
const EXIT_RECOMMENDATION_TTL_MS = 5 * 60 * 1000;

// Default slippage for SELL orders
const DEFAULT_SELL_SLIPPAGE_PCT = 2.0;

// Honeypot retention assumption when no on-chain data is available (passes SPECULATIVE tier)
const DEFAULT_VALUE_RETENTION_PCT = 97.5;

export interface DecisionEngineConfig extends PortfolioStateConfig {
  maxSignalsPerCycle?: number;
}

export interface DecisionCycleResult {
  cycleAt:         Date;
  recommendations: TradeRecommendation[];
  executionPlans:  ExecutionPlan[];
  portfolioSnapshot: PortfolioStateSnapshot;
  skipped:         number;
  blocked:         number;
}

/**
 * DecisionEngine — orchestrates the full autonomous decision cycle.
 *
 * Flow per cycle:
 *   1. Refresh portfolio state (MTM + drawdown + rolling loss)
 *   2. Load top smart-money signals
 *   3. Fetch live price bundles
 *   4. Evaluate each signal through the Risk Engine
 *   5. Rank approved signals by conviction score
 *   6. Allocate capital across ranked opportunities (exposure-aware)
 *   7. Generate BUY recommendations for approved allocations
 *   8. Evaluate open positions for exit conditions (stop-loss / take-profit / reversal)
 *   9. Persist all recommendations to trade_recommendations
 *  10. Build and return execution plans
 *
 * Phase 7: No on-chain execution. Plans are produced but not submitted.
 */
export class DecisionEngine {
  private readonly agentWallet:      string;
  private readonly portfolioService: PortfolioStateService;
  private readonly positionRegistry: PositionRegistryService;
  private readonly maxSignals:       number;

  constructor(config: DecisionEngineConfig) {
    this.agentWallet      = config.agentWalletAddress.toLowerCase();
    this.portfolioService = new PortfolioStateService(config);
    this.positionRegistry = new PositionRegistryService(config.agentWalletAddress);
    this.maxSignals       = config.maxSignalsPerCycle ?? 50;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  public async run(now: Date = new Date()): Promise<DecisionCycleResult> {
    // 0. Expire stale PENDING recommendations before evaluating this cycle.
    //    Must run first so expired BUY slots are freed before new ones are generated.
    await TradeRecommendationsRepository.expirePending(this.agentWallet, now);

    // 1. Refresh portfolio
    const { snapshot: portfolioSnapshot, riskState } = await this.portfolioService.refresh(now);

    // 2. Load signals and evaluate each through Risk Engine
    const signals = await SmartMoneySignalsRepository.getTopSignals({
      limit:    this.maxSignals,
      minScore: 25,
      tiers:    ['STRONG', 'MODERATE', 'WEAK'],
    });

    // Build a map for O(1) lookup during exit evaluation
    const signalsByToken = new Map<string, TokenSignalBundle>(
      signals.map(s => [s.tokenAddress, s])
    );

    const rankInputs:    RankInput[] = [];
    let blockedCount = 0;

    for (const signal of signals) {
      if (signal.dataFreshness === 'STALE') {
        blockedCount++;
        continue;
      }

      const priceBundle = await PriceService.getPriceBundle(signal.tokenAddress);
      if (!priceBundle
        || priceBundle.priceState === PriceState.UNRESOLVABLE
        || priceBundle.priceState === PriceState.MANIPULATED) {
        blockedCount++;
        continue;
      }

      const riskInput: RiskInput = {
        signal,
        portfolio:                  riskState,
        marketPrice:                priceBundle.priceUsd,
        smartMoneyVWAP:             priceBundle.vwap1h > 0 ? priceBundle.vwap1h : priceBundle.priceUsd,
        poolLiquidityUsd:           priceBundle.liquidityUsd,
        simulatedValueRetentionPct: DEFAULT_VALUE_RETENTION_PCT,
        currentTime:                now,
      };

      const riskDecision = RiskEngine.evaluate(riskInput);
      rankInputs.push({ signal, priceBundle, riskDecision });
      if (!riskDecision.allowed) blockedCount++;
    }

    // 3. Rank approved opportunities
    const ranked = rankOpportunities(rankInputs);

    // 4. Load open positions for capital allocator + exit evaluation
    const openPositions  = await this.positionRegistry.getAllOpenPositions();
    const openTokens     = new Set(openPositions.map(p => p.tokenAddress));

    // Sum of positionSizePct across all OPEN agent_positions.
    // Used as the floor for effective exposure — covers the execution lag window
    // (submitted but not yet confirmed on-chain) and Phase 7 (no execution at all).
    const agentIntentPct = openPositions.reduce((sum, p) => sum + p.positionSizePct, 0);

    // 5. Allocate capital
    const allocation = allocateCapital(ranked, riskState, openTokens, agentIntentPct);

    const skippedCount = (signals.length - ranked.length) + allocation.skipped.length;

    // 6. Generate BUY recommendations
    const recommendations: TradeRecommendation[] = [];

    for (const opportunity of allocation.approved) {
      recommendations.push(
        this.buildBuyRecommendation(opportunity, portfolioSnapshot, now)
      );
    }

    // 7. Exit Engine: evaluate open positions for stop-loss, take-profit, reversal
    const sellRecs = await this.evaluateExits(openPositions, signalsByToken, now);
    recommendations.push(...sellRecs);

    // 8. Persist all recommendations
    if (recommendations.length > 0) {
      await this.persistRecommendations(recommendations);
    }

    // 9. Build execution plans
    const executionPlans = buildExecutionPlans(recommendations);

    return {
      cycleAt:           now,
      recommendations,
      executionPlans,
      portfolioSnapshot,
      skipped:           skippedCount,
      blocked:           blockedCount,
    };
  }

  // ── Exit Engine ────────────────────────────────────────────────────────────

  private async evaluateExits(
    openPositions:  AgentPosition[],
    signalsByToken: Map<string, TokenSignalBundle>,
    now:            Date,
  ): Promise<TradeRecommendation[]> {
    const sellRecs: TradeRecommendation[] = [];

    for (const position of openPositions) {
      const priceBundle = await PriceService.getPriceBundle(position.tokenAddress);

      // P1-2: No reliable price → skip exit evaluation this cycle.
      // Stop-loss and take-profit must not fire against stale or manipulated data.
      if (
        !priceBundle
        || priceBundle.priceState === PriceState.UNRESOLVABLE
        || priceBundle.priceState === PriceState.MANIPULATED
      ) {
        continue;
      }

      const currentPrice = priceBundle.priceUsd;
      const gainPct = ((currentPrice - position.entryPriceUsd) / position.entryPriceUsd) * 100;
      const lossPct = -gainPct;

      let closeReason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'SIGNAL_REVERSAL' | null = null;
      let exitReasonDetail = '';

      if (lossPct >= position.stopLossPct) {
        closeReason    = 'STOP_LOSS';
        exitReasonDetail = 'stop_loss';
      } else if (gainPct >= position.takeProfitPct) {
        closeReason    = 'TAKE_PROFIT';
        exitReasonDetail = 'take_profit';
      } else {
        const signal = signalsByToken.get(position.tokenAddress);
        if (!signal) {
          // P1-4: Token no longer in signal universe — conviction basis is gone.
          closeReason      = 'SIGNAL_REVERSAL';
          exitReasonDetail = 'signal_dropped_from_universe';
        } else if (this.isSignalReversal(signal)) {
          closeReason      = 'SIGNAL_REVERSAL';
          exitReasonDetail = 'signal_reversal';
        }
      }

      if (closeReason) {
        // P0-1: Close the position in the registry immediately.
        // Without this, the next cycle re-evaluates the same open position
        // and generates another SELL recommendation — duplicating the exit indefinitely.
        await this.positionRegistry.closePosition(position.tokenAddress, currentPrice, closeReason, now);
        sellRecs.push(this.buildSellRecommendation(position, currentPrice, exitReasonDetail, now));
      }
    }

    return sellRecs;
  }

  private isSignalReversal(signal: TokenSignalBundle): boolean {
    if (signal.trend === 'DECREASING')                                      return true;
    if (signal.netAccumulationFlow < 0)                                     return true;
    if (signal.netAccumulationFlow24h !== null && signal.netAccumulationFlow24h < 0) return true;
    return false;
  }

  // ── Recommendation builders ────────────────────────────────────────────────

  private buildBuyRecommendation(
    opportunity:       RankedOpportunity,
    portfolio:         PortfolioStateSnapshot,
    decidedAt:         Date,
  ): TradeRecommendation {
    const { signal, marketPriceUsd, convictionScore, expectedEdge,
            positionSizePct, stopLossPct, takeProfitPct, slippageLimitPct, riskTier } = opportunity;

    const estimatedUsd = Math.round((portfolio.portfolioUsd * positionSizePct / 100) * 100) / 100;

    return {
      id:               randomUUID(),
      agentWallet:      this.agentWallet,
      tokenAddress:     signal.tokenAddress,
      tokenSymbol:      signal.tokenSymbol,
      action:           'BUY',
      positionSizePct,
      estimatedUsd,
      entryPriceUsd:    marketPriceUsd,
      stopLossPct,
      takeProfitPct,
      slippageLimitPct,
      riskTier,
      signalTier:       signal.signalTier,
      opportunityScore: signal.opportunityScore,
      convictionScore,
      expectedEdge,
      confidence:       signal.confidence,
      blockers:         [],
      reasons:          signal.signalReasons,
      warnings:         signal.riskFlags,
      expiresAt:        new Date(decidedAt.getTime() + RECOMMENDATION_TTL_MS),
      decidedAt,
      status:           'PENDING',
    };
  }

  private buildSellRecommendation(
    position:         AgentPosition,
    currentPriceUsd:  number,
    exitReasonDetail: string,
    decidedAt:        Date,
  ): TradeRecommendation {
    const pnlPct = ((currentPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;
    const currentValueUsd = Math.round(
      position.positionSizeUsd * (currentPriceUsd / position.entryPriceUsd) * 100
    ) / 100;

    return {
      id:               randomUUID(),
      agentWallet:      this.agentWallet,
      tokenAddress:     position.tokenAddress,
      tokenSymbol:      position.tokenSymbol,
      action:           'SELL',
      positionSizePct:  position.positionSizePct,
      estimatedUsd:     currentValueUsd,
      entryPriceUsd:    currentPriceUsd,
      stopLossPct:      position.stopLossPct,
      takeProfitPct:    position.takeProfitPct,
      slippageLimitPct: DEFAULT_SELL_SLIPPAGE_PCT,
      riskTier:         'SPECULATIVE',
      signalTier:       'EXIT',
      opportunityScore: 0,
      convictionScore:  0,
      expectedEdge:     Math.round(pnlPct * 100) / 100,
      confidence:       100,
      blockers:         [],
      reasons:          [exitReasonDetail],
      warnings:         [],
      expiresAt:        new Date(decidedAt.getTime() + EXIT_RECOMMENDATION_TTL_MS),
      decidedAt,
      status:           'PENDING',
    };
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private async persistRecommendations(recs: TradeRecommendation[]): Promise<void> {
    const toRow = (r: TradeRecommendation) => ({
      id:               r.id,
      agentWallet:      r.agentWallet,
      tokenAddress:     r.tokenAddress,
      tokenSymbol:      r.tokenSymbol,
      action:           r.action,
      positionSizePct:  r.positionSizePct,
      estimatedUsd:     r.estimatedUsd,
      entryPriceUsd:    r.entryPriceUsd,
      stopLossPct:      r.stopLossPct,
      takeProfitPct:    r.takeProfitPct,
      slippageLimitPct: r.slippageLimitPct,
      riskTier:         r.riskTier,
      signalTier:       r.signalTier,
      opportunityScore: r.opportunityScore,
      convictionScore:  r.convictionScore,
      expectedEdge:     r.expectedEdge,
      confidence:       r.confidence,
      blockers:         r.blockers,
      reasons:          r.reasons,
      warnings:         r.warnings,
      expiresAt:        r.expiresAt,
      decidedAt:        r.decidedAt,
      status:           r.status,
    });

    // BUY recommendations: silently skip if a PENDING BUY already exists for this
    // (wallet, token) pair — enforced by the trade_recs_pending_buy_unique index.
    // The existing recommendation is still valid; do not overwrite it.
    const buyRecs   = recs.filter(r => r.action === 'BUY');
    const otherRecs = recs.filter(r => r.action !== 'BUY');

    if (buyRecs.length > 0) {
      await db.insert(tradeRecommendations)
        .values(buyRecs.map(toRow))
        .onConflictDoNothing();
    }
    if (otherRecs.length > 0) {
      await db.insert(tradeRecommendations).values(otherRecs.map(toRow));
    }
  }
}
