import { type TradeRecommendation, type ExecutionPlan } from './trade-recommendation-types.js';

// Default tokens used for routing
const USDT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';

/**
 * Converts a BUY or SELL recommendation into an execution-ready plan.
 *
 * Phase 7 scope: produces the plan struct only.
 * Phase 8 scope: submits the plan to the execution router for on-chain swap.
 *
 * Routing logic:
 *   BUY:  stablecoin → target token
 *   SELL: target token → stablecoin
 *
 * For stablecoin-to-stablecoin swaps (e.g. buying a stable): tokenIn = tokenOut = stable.
 * This should not happen in practice since BSC_STABLES are excluded from signals.
 */
export function buildExecutionPlan(recommendation: TradeRecommendation): ExecutionPlan {
  if (recommendation.action === 'BUY') {
    return {
      action:           'BUY',
      tokenIn:          USDT_ADDRESS,
      tokenOut:         recommendation.tokenAddress,
      amountUsd:        recommendation.estimatedUsd,
      slippageLimitPct: recommendation.slippageLimitPct,
      recommendationId: recommendation.id,
    };
  }

  if (recommendation.action === 'SELL') {
    return {
      action:           'SELL',
      tokenIn:          recommendation.tokenAddress,
      tokenOut:         USDT_ADDRESS,
      amountUsd:        recommendation.estimatedUsd,
      slippageLimitPct: recommendation.slippageLimitPct,
      recommendationId: recommendation.id,
    };
  }

  throw new Error(`Cannot build execution plan for action: ${recommendation.action}`);
}

/**
 * Batch-converts an array of approved recommendations into execution plans.
 * Only BUY and SELL actions produce plans — HOLD and SKIP are ignored.
 */
export function buildExecutionPlans(recommendations: TradeRecommendation[]): ExecutionPlan[] {
  return recommendations
    .filter(r => r.action === 'BUY' || r.action === 'SELL')
    .map(r => buildExecutionPlan(r));
}
