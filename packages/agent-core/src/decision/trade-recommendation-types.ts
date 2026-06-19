import { type TokenSignalBundle } from '@aether/db';
import { type RiskTier } from '../risk/risk-engine.js';
import { type PriceBundle } from '../valuation/price-types.js';

// ── Enums ──────────────────────────────────────────────────────────────────

export type RecommendationAction = 'BUY' | 'SELL' | 'HOLD' | 'SKIP';
export type RecommendationStatus = 'PENDING' | 'EXECUTED' | 'EXPIRED' | 'CANCELLED';
export type PositionStatus       = 'OPEN' | 'CLOSED';
export type CloseReason          = 'STOP_LOSS' | 'TAKE_PROFIT' | 'SIGNAL_REVERSAL' | 'MANUAL';

// ── Core output types ──────────────────────────────────────────────────────

export interface TradeRecommendation {
  id:              string;   // UUID — permanent identifier
  agentWallet:     string;

  tokenAddress:    string;
  tokenSymbol:     string;

  action:          RecommendationAction;

  positionSizePct: number;   // % of total portfolio (0–100)
  estimatedUsd:    number;   // portfolioUsd * positionSizePct / 100
  entryPriceUsd:   number;   // market price at decision time

  stopLossPct:     number;   // distance from entry before stop fires
  takeProfitPct:   number;   // distance from entry to take profit
  slippageLimitPct: number;  // max tolerable slippage on execution

  riskTier:        RiskTier;
  signalTier:      string;

  opportunityScore: number;  // from TokenSignalBundle (0–100)
  convictionScore:  number;  // composite ranking score (0–100)
  expectedEdge:     number;  // probability-weighted expected return (%)

  confidence:      number;   // statistical validity (0–100)

  blockers:        string[];
  reasons:         string[];
  warnings:        string[];

  expiresAt:       Date;     // PENDING recommendations expire after TTL
  decidedAt:       Date;
  status:          RecommendationStatus;
}

export interface AgentPosition {
  id:               string;
  agentWallet:      string;
  tokenAddress:     string;
  tokenSymbol:      string;
  recommendationId: string | null;

  entryPriceUsd:    number;
  currentPriceUsd:  number;
  positionSizeUsd:  number;
  positionSizePct:  number;
  stopLossPct:      number;
  takeProfitPct:    number;
  unrealizedPnlPct: number;

  status:           PositionStatus;
  closeReason:      CloseReason | null;
  closePriceUsd:    number | null;

  openedAt:         Date;
  closedAt:         Date | null;
  updatedAt:        Date;
}

// ── Pipeline intermediate types ────────────────────────────────────────────

export interface RankedOpportunity {
  signal:           TokenSignalBundle;
  priceBundle:      PriceBundle;
  marketPriceUsd:   number;
  convictionScore:  number;
  expectedEdge:     number;
  positionSizePct:  number;
  stopLossPct:      number;
  takeProfitPct:    number;
  slippageLimitPct: number;
  riskTier:         RiskTier;
}

export interface SkippedSignal {
  signal: TokenSignalBundle;
  reason: string;
}

export interface CapitalAllocation {
  approved:           RankedOpportunity[];
  skipped:            SkippedSignal[];
  /** Percentage of portfolio newly allocated this cycle (does not include pre-existing exposure). */
  newlyAllocatedPct:  number;
}

export interface ExecutionPlan {
  action:            'BUY' | 'SELL';
  tokenIn:           string;
  tokenOut:          string;
  amountUsd:         number;
  slippageLimitPct:  number;
  recommendationId:  string;
}
