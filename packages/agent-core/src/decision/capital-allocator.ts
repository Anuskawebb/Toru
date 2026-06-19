import { type RiskPortfolioState } from '../risk/risk-engine.js';
import { type RankedOpportunity, type CapitalAllocation } from './trade-recommendation-types.js';

// Agent must never deploy more than this % of portfolio into tokens
const MAX_TOTAL_EXPOSURE_PCT = 90.0;

// At least this % of portfolio must remain in stablecoins at all times
const MIN_CASH_RESERVE_PCT = 10.0;

/**
 * Allocates capital across ranked opportunities under portfolio constraints.
 *
 * Process:
 *   1. Compute effective exposure: max(wallet_positions exposure, agent intent from OPEN agent_positions)
 *   2. Compute available headroom from effective exposure and effective cash
 *   3. Iterate ranked opportunities (highest conviction first)
 *   4. Skip tokens with an existing open position (Exit Engine handles those)
 *   5. Skip if adding this position would breach exposure or cash reserve limits
 *   6. Approve and accumulate; stop when headroom exhausted
 *
 * agentIntentPct — sum of positionSizePct across all OPEN agent_positions.
 * This captures capital committed by the agent but not yet confirmed on-chain
 * (the execution lag window). It is used as a floor for the effective exposure
 * calculation, preventing double-allocation during that window and in Phase 7
 * (where wallet_positions never reflects agent trades).
 *
 * Deterministic: same inputs always produce same output (no randomness, no I/O).
 */
export function allocateCapital(
  ranked:              RankedOpportunity[],
  portfolio:           RiskPortfolioState,
  openPositionTokens:  Set<string>,
  agentIntentPct:      number,
): CapitalAllocation {
  const approved: RankedOpportunity[] = [];
  const skipped:  CapitalAllocation['skipped'] = [];

  // Agent intent takes precedence when it exceeds on-chain confirmed exposure.
  // This covers the execution lag window (submitted but unconfirmed) and Phase 7
  // (no execution — wallet_positions never shows agent trades).
  const effectiveExposurePct = Math.max(portfolio.totalExposurePct, agentIntentPct);

  // Capital committed by agent but not yet reflected in wallet_positions.
  // Subtract from the blockchain-reported cash reserve so we don't double-spend it.
  const uncommittedPct    = Math.max(0, agentIntentPct - portfolio.totalExposurePct);
  const effectiveCashPct  = portfolio.cashReservePct - uncommittedPct;

  // Available headroom: how much MORE exposure we can add without breaching limits
  const headroomByExposure = Math.max(0, MAX_TOTAL_EXPOSURE_PCT - effectiveExposurePct);
  const headroomByCash     = Math.max(0, effectiveCashPct - MIN_CASH_RESERVE_PCT);
  const availablePct       = Math.min(headroomByExposure, headroomByCash);

  let cumulativeNewPct = 0;

  for (const opportunity of ranked) {
    const tokenAddr = opportunity.signal.tokenAddress;

    // Existing open positions are managed by the Exit Engine — skip new entries
    if (openPositionTokens.has(tokenAddr)) {
      skipped.push({ signal: opportunity.signal, reason: 'position_already_open' });
      continue;
    }

    // Cumulative exposure check
    if (cumulativeNewPct + opportunity.positionSizePct > availablePct) {
      skipped.push({ signal: opportunity.signal, reason: 'exposure_limit_reached' });
      continue;
    }

    // Projected cash reserve floor check (against effective cash, not raw blockchain cash)
    const projectedCashPct = effectiveCashPct - cumulativeNewPct - opportunity.positionSizePct;
    if (projectedCashPct < MIN_CASH_RESERVE_PCT) {
      skipped.push({ signal: opportunity.signal, reason: 'cash_reserve_floor' });
      continue;
    }

    approved.push(opportunity);
    cumulativeNewPct += opportunity.positionSizePct;
  }

  return {
    approved,
    skipped,
    newlyAllocatedPct: cumulativeNewPct,
  };
}
