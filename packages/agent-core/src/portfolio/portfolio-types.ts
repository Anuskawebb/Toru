import { type PriceState } from '../valuation/price-types.js';
import { type RiskPortfolioState } from '../risk/risk-engine.js';

/**
 * Represents one token position after mark-to-market valuation.
 */
export interface PositionValuation {
  tokenAddress: string;
  tokenSymbol: string;
  /** Human-readable token amount (raw BigInt / 10^decimals) */
  humanAmount: number;
  priceUsd: number;
  markToMarketUsd: number;
  priceState: PriceState;
  priceConfidence: number;
  isStablecoin: boolean;
}

/**
 * Full portfolio valuation at a point in time.
 * Produced by PortfolioValuationEngine.compute() — pure, no DB.
 */
export interface PortfolioValuation {
  agentWallet: string;
  valuedAt: Date;

  /** Total mark-to-market value of all priced positions */
  portfolioUsd: number;
  /** USD value held in stablecoins (buying power) */
  stablecoinUsd: number;
  /** USD value held in non-stablecoin tokens */
  tokenExposureUsd: number;
  /** Effective buying power = stablecoinUsd */
  buyingPowerUsd: number;

  /** Count of non-stablecoin positions with netAmount > 0 */
  openPositions: number;
  /** Count of positions with UNRESOLVABLE price — excluded from MTM */
  unpricedPositions: number;

  /**
   * Value-weighted average price confidence across all priced positions (0–100).
   * Stablecoin positions contribute confidence = 100.
   * UNRESOLVABLE positions are excluded from the weighted average.
   */
  valuationConfidence: number;

  /** Full per-position breakdown */
  positions: PositionValuation[];
}

/**
 * Full portfolio state snapshot including historical risk metrics.
 * Written to portfolio_state (live) and portfolio_snapshots (time-series).
 */
export interface PortfolioStateSnapshot extends PortfolioValuation {
  /** Competition starting capital — persisted for restart safety */
  startingCapitalUsd: number;
  /** All-time high portfolio value (ratchets up, never down) */
  peakPortfolioUsd: number;

  /** currentDrawdown = (peak - current) / peak * 100 */
  drawdownPct: number;
  /** Loss since the earliest snapshot in the last 24h window */
  rollingLossPct24h: number;

  // Derived percentage metrics (0–100)
  cashReservePct: number;
  totalExposurePct: number;
  /** Phase placeholder: tokenExposurePct * 0.05 until Execution Engine exists */
  openRiskPct: number;
}

/**
 * Projects a PortfolioStateSnapshot into the RiskEngine's RiskPortfolioState interface.
 * This is the adapter between Phase 6B.2 and Phase 6A.
 */
export function toRiskPortfolioState(s: PortfolioStateSnapshot): RiskPortfolioState {
  return {
    currentDrawdownPct: s.drawdownPct,
    dailyLossPct:       s.rollingLossPct24h,
    cashReservePct:     s.cashReservePct,
    totalExposurePct:   s.totalExposurePct,
    openRiskPct:        s.openRiskPct,
    openPositions:      s.openPositions,
  };
}
