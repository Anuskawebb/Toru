import { type TokenSignalBundle } from '@aether/db';

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'SPECULATIVE';

export interface RiskPortfolioState {
  currentDrawdownPct: number;    // current drawdown in percent (e.g., 2.5 represents 2.5%)
  dailyLossPct: number;          // 24h rolling loss in percent (e.g., 1.5 represents 1.5%)
  cashReservePct: number;        // cash reserve percentage (0.0 to 100.0)
  totalExposurePct: number;      // current active exposure (0.0 to 100.0)
  openRiskPct: number;           // open risk contribution percentage
  openPositions: number;         // number of active positions
}

export interface RiskInput {
  signal: TokenSignalBundle;
  portfolio?: RiskPortfolioState;
  marketPrice: number;
  smartMoneyVWAP: number;
  poolLiquidityUsd: number;
  simulatedValueRetentionPct: number; // simulated round-trip retention percentage (0.0 to 100.0)
  currentTime?: Date;            // Optional current time for deterministic testing of F_age
}

export interface RiskDecision {
  allowed: boolean;
  riskTier: RiskTier;
  positionSizePct: number;       // Target position size (0.0 to 100.0)
  stopLossPct: number;           // Stop-loss distance from entry (e.g. 5.0 represents 5%)
  takeProfitPct: number;         // Take-profit target (e.g. 40.0 represents 40%)
  slippageLimitPct: number;      // slippage limit for execution router (e.g. 1.5 represents 1.5%)
  reasons: string[];             // audit reasons
  warnings: string[];            // non-blocking warning messages
  blockers: string[];            // blocking reason messages if allowed is false
}

export class RiskEngine {
  /**
   * Evaluates a token signal bundle under competition risk guardrails.
   * Fully deterministic, unit-testable, and type-safe.
   */
  public static evaluate(input: RiskInput): RiskDecision {
    const {
      signal,
      portfolio,
      marketPrice,
      smartMoneyVWAP,
      poolLiquidityUsd,
      simulatedValueRetentionPct,
      currentTime = new Date()
    } = input;

    const blockers: string[] = [];
    const warnings: string[] = [];
    const reasons: string[] = [];

    if (!portfolio) {
      blockers.push('missing_portfolio_state');
    }

    // 1. Determine Risk Tier
    let riskTier: RiskTier = 'SPECULATIVE';
    if (signal.qualityHolderCount >= 20 && poolLiquidityUsd >= 100000) {
      riskTier = 'LOW';
    } else if (signal.qualityHolderCount >= 10 && poolLiquidityUsd >= 50000) {
      riskTier = 'MEDIUM';
    } else if (signal.qualityHolderCount >= 5 && poolLiquidityUsd >= 25000) {
      riskTier = 'HIGH';
    }

    reasons.push(`classified_risk_tier_${riskTier.toLowerCase()}`);

    // Tier-specific parameters
    const tierParams = {
      LOW: { maxSinglePos: 25.0, stopCap: 12.0, tp: 25.0, slippage: 1.0, honeypotMin: 98.0 },
      MEDIUM: { maxSinglePos: 12.5, stopCap: 8.0, tp: 40.0, slippage: 1.5, honeypotMin: 95.0 },
      HIGH: { maxSinglePos: 6.0, stopCap: 5.0, tp: 60.0, slippage: 2.0, honeypotMin: 90.0 },
      SPECULATIVE: { maxSinglePos: 2.5, stopCap: 3.0, tp: 100.0, slippage: 2.5, honeypotMin: 90.0 }
    }[riskTier];

    // 2. Fetch Portfolio Drawdown and Rolling Daily Loss Parameters
    const D_current = portfolio?.currentDrawdownPct ?? 0.0;
    const L_rolling = portfolio?.dailyLossPct ?? 0.0;
    const B = Math.max(0.0, 10.0 - D_current);

    // 3. Evaluate Hard Circuit Breakers
    if (signal.dataFreshness === 'STALE') {
      blockers.push('stale_oracle');
    }

    if (!signal.minimumHolders) {
      blockers.push('noise_floor_violation');
    }

    if (signal.confidence < 40) {
      blockers.push('low_confidence_floor');
    }

    if (signal.qualityConcentrationPct > 65.0) {
      blockers.push('high_concentration');
    }

    // 4. Honeypot check
    if (simulatedValueRetentionPct < tierParams.honeypotMin) {
      blockers.push('honeypot_simulation_failed');
    }

    // 5. Signal Age calculations
    const timeDeltaMs = Math.max(0, currentTime.getTime() - signal.computedAt.getTime());
    const signalAgeHours = timeDeltaMs / 3600000.0;
    if (signalAgeHours >= 12.0) {
      blockers.push('signal_ancient_exceeds_12h');
    }

    const F_age = Math.exp(-Math.pow(signalAgeHours / 8.0, 2));
    if (signalAgeHours > 4.0) {
      warnings.push(`stale_signal_age_${Math.round(signalAgeHours)}h`);
    }

    // 6. Smart-Money Entry Premium Cap ($F_{chase}$)
    const rawPremium = (marketPrice - smartMoneyVWAP) / smartMoneyVWAP;
    const premium = Math.round(Math.max(0.0, rawPremium) * 1000000) / 1000000;
    
    const premiumCaps = {
      LOW: 0.30,
      MEDIUM: 0.25,
      HIGH: 0.20,
      SPECULATIVE: 0.15
    };
    const premiumCap = premiumCaps[riskTier];

    if (premium > premiumCap) {
      blockers.push('premium_above_cap');
    }

    // Sizing decay curve for F_chase
    let F_chase = 1.0;
    if (premium > 0.50) {
      F_chase = 0.0;
    } else if (premium > 0.30) {
      F_chase = 0.40 - 0.40 * ((premium - 0.30) / 0.20);
    } else if (premium >= 0.20) {
      F_chase = 0.75 - 0.35 * ((premium - 0.20) / 0.10);
    } else if (premium > 0.10) {
      F_chase = 1.0 - 0.25 * ((premium - 0.10) / 0.10);
    }
    F_chase = Math.max(0.0, Math.min(1.0, F_chase));

    // 7. Trend Rejection & Velocity-Validated Reversal (VVR) Rules
    let VVR_approved = false;
    let F_trend = 0.4; // UNKNOWN trend modifier by default

    if (signal.trend === 'INCREASING') {
      F_trend = 1.2;
    } else if (signal.trend === 'STABLE') {
      F_trend = 1.0;
    } else if (signal.trend === 'DECREASING') {
      // Check VVR rules
      const velocityRatio = signal.qualityEntries4h / Math.max(1, signal.qualityExits4h);
      const hasFlowDivergence = signal.netAccumulationFlow > 0 && signal.netAccumulationFlow24h !== null && signal.netAccumulationFlow24h > 0;
      
      VVR_approved = 
        velocityRatio >= 1.5 && 
        signal.qualityEntries4h >= 2 && 
        hasFlowDivergence && 
        poolLiquidityUsd >= 25000;

      if (VVR_approved) {
        F_trend = 0.6;
        reasons.push('velocity_validated_reversal');
      } else {
        blockers.push('trend_decreasing_no_reversal');
      }
    } else if (signal.trend === 'UNKNOWN') {
      F_trend = 0.4;
    }

    // 8. Decay Factors
    // Drawdown buffer sizing decay (F_drawdown)
    let F_drawdown = 1.0;
    if (D_current > 10.0) {
      F_drawdown = 0.0;
      blockers.push('drawdown_limit_breached');
    } else if (D_current > 2.0) {
      F_drawdown = Math.pow((10.0 - D_current) / 8.0, 2);
    }

    // Daily loss sizing decay (F_daily)
    let F_daily = Math.max(0.0, 1.0 - (L_rolling / 3.0));
    if (L_rolling >= 3.0) {
      blockers.push('daily_loss_limit_reached');
    }

    // 9. Portfolio Exposure Checks
    const maxPortfolioExposure = Math.max(0.0, Math.min(90.0, B * 4.0));
    if (portfolio) {
      if (portfolio.totalExposurePct >= maxPortfolioExposure) {
        blockers.push('portfolio_max_exposure_reached');
      }
    }

    // 10. Sizing Engine
    let positionSizePct = 0.0;
    const isAllowed = blockers.length === 0;

    if (isAllowed) {
      // Base Kelly-inspired scaling
      const baseAllocation = 25.0 * Math.pow(signal.opportunityScore / 100.0, 2);
      
      // Compute raw size from product of multipliers
      let targetSize = baseAllocation * F_drawdown * F_trend * F_daily * F_chase * F_age;

      // Cap size at tier maximum position size
      targetSize = Math.min(targetSize, tierParams.maxSinglePos);

      // Cap size by remaining portfolio headroom
      if (portfolio) {
        const remainingHeadroom = Math.max(0.0, maxPortfolioExposure - portfolio.totalExposurePct);
        targetSize = Math.min(targetSize, remainingHeadroom);
      } else {
        targetSize = Math.min(targetSize, maxPortfolioExposure);
      }

      // Check if size is too microscopic
      if (targetSize < 0.05) {
        blockers.push('insufficient_exposure_headroom');
        positionSizePct = 0.0;
      } else {
        positionSizePct = parseFloat(targetSize.toFixed(2));
      }
    }

    // 11. Stop-Loss Calculation
    let stopLossPct = 0.0;
    if (blockers.length === 0 || blockers.includes('insufficient_exposure_headroom')) {
      if (signal.trend === 'DECREASING' && VVR_approved) {
        stopLossPct = 4.0; // Hard-set for VVR
      } else {
        stopLossPct = parseFloat(Math.min(tierParams.stopCap, B * 0.75).toFixed(2));
      }

      if (stopLossPct <= 0.0) {
        blockers.push('zero_drawdown_buffer');
        stopLossPct = 0.0;
      }
    }

    // Final decision compilation
    const allowed = blockers.length === 0 && positionSizePct > 0.0;

    return {
      allowed,
      riskTier,
      positionSizePct: allowed ? positionSizePct : 0.0,
      stopLossPct: allowed ? stopLossPct : 0.0,
      takeProfitPct: tierParams.tp,
      slippageLimitPct: tierParams.slippage,
      reasons,
      warnings,
      blockers
    };
  }
}
