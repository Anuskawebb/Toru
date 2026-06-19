import { type TokenSignalBundle } from '@aether/db';
import { PriceState, type PriceBundle } from '../valuation/price-types.js';
import { type RiskDecision } from '../risk/risk-engine.js';
import { type RankedOpportunity } from './trade-recommendation-types.js';

// ── Conviction Score ───────────────────────────────────────────────────────
//
// convictionScore = opportunityScore × confidenceFactor × freshnessFactor × liquidityFactor
//
// All factors are in [0, 1]. Result is scaled to [0, 100].

function computeConvictionScore(
  signal: TokenSignalBundle,
  priceBundle: PriceBundle,
): number {
  const opportunityFactor  = signal.opportunityScore / 100;
  const confidenceFactor   = signal.confidence / 100;
  const freshnessFactor    = signal.dataFreshness === 'LIVE' ? 1.0 : 0.0;

  // Liquidity factor: derived from priceConfidence and priceState freshness.
  // FRESH = up to 1.0 (scaled by confidence / 80 since 80 is the practical max
  // without on-chain liquidity data). STALE = capped at 0.5.
  const liquidityFactor = priceBundle.priceState === PriceState.FRESH
    ? Math.min(1.0, priceBundle.priceConfidence / 80)
    : 0.5;

  const raw = opportunityFactor * confidenceFactor * freshnessFactor * liquidityFactor * 100;
  return Math.round(raw * 100) / 100;
}

// ── Expected Edge ──────────────────────────────────────────────────────────
//
// A probability-weighted return estimate using the risk engine's stop/profit levels:
//   edge = P(win) × takeProfitPct  −  P(loss) × stopLossPct
//
// P(win) is approximated by opportunityScore / 100.

function computeExpectedEdge(
  signal: TokenSignalBundle,
  riskDecision: RiskDecision,
): number {
  const pWin = signal.opportunityScore / 100;
  const edge = pWin * riskDecision.takeProfitPct - (1 - pWin) * riskDecision.stopLossPct;
  return Math.round(edge * 100) / 100;
}

// ── Input / Output ─────────────────────────────────────────────────────────

export interface RankInput {
  signal:       TokenSignalBundle;
  priceBundle:  PriceBundle;
  riskDecision: RiskDecision;
}

/**
 * Converts a list of evaluated signals into ranked opportunities.
 *
 * Filtering rules applied here (before capital allocation):
 *   - Blocked RiskDecision (allowed = false) → excluded
 *   - Stale signal (dataFreshness = STALE)   → excluded
 *   - Manipulated price                       → excluded
 *   - Unresolvable price                      → excluded
 *
 * Sort: convictionScore DESC, tokenAddress ASC (deterministic tie-break).
 */
export function rankOpportunities(inputs: RankInput[]): RankedOpportunity[] {
  const ranked: RankedOpportunity[] = [];

  for (const { signal, priceBundle, riskDecision } of inputs) {
    if (!riskDecision.allowed)                               continue;
    if (signal.dataFreshness === 'STALE')                   continue;
    if (priceBundle.priceState === PriceState.MANIPULATED)  continue;
    if (priceBundle.priceState === PriceState.UNRESOLVABLE) continue;

    ranked.push({
      signal,
      priceBundle,
      marketPriceUsd:   priceBundle.priceUsd,
      convictionScore:  computeConvictionScore(signal, priceBundle),
      expectedEdge:     computeExpectedEdge(signal, riskDecision),
      positionSizePct:  riskDecision.positionSizePct,
      stopLossPct:      riskDecision.stopLossPct,
      takeProfitPct:    riskDecision.takeProfitPct,
      slippageLimitPct: riskDecision.slippageLimitPct,
      riskTier:         riskDecision.riskTier,
    });
  }

  ranked.sort((a, b) => {
    const diff = b.convictionScore - a.convictionScore;
    if (diff !== 0) return diff;
    // Lexicographic on address guarantees identical output for identical inputs
    return a.signal.tokenAddress.localeCompare(b.signal.tokenAddress);
  });

  return ranked;
}
