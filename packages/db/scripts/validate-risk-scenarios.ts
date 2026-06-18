import { RiskEngine, type RiskInput } from '../../agent-core/src/risk/risk-engine.js';
import { type TokenSignalBundle } from '../src/schema/smart-money-signals.js';

console.log('Aether Risk Engine Scenario Validation Suite');
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

// Helper mock bundle factory
function createMockBundle(overrides: Partial<TokenSignalBundle>): TokenSignalBundle {
  return {
    tokenAddress: '0x1234567890123456789012345678901234567890',
    tokenSymbol: 'TEST',
    signalTier: 'STRONG',
    accumulationScore: 80,
    opportunityScore: 85,
    confidence: 80,
    trend: 'INCREASING',
    qualityHolderCount: 25,
    holderCount: 200,
    qualityConcentrationPct: 15.0,
    concentrationScore: 15,
    avgQualityRank: 85.0,
    qualityEntries4h: 5,
    qualityExits4h: 1,
    netAccumulationFlow: 4,
    qualityEntries24h: 10,
    qualityExits24h: 2,
    netAccumulationFlow24h: 8,
    topClassifications: [],
    signalReasons: [],
    riskFlags: [],
    qualityHolderChange24h: 8,
    narrative: 'Mock narrative',
    dataFreshness: 'LIVE',
    minimumHolders: true,
    computedAt: new Date(),
    ...overrides
  };
}

// ── SCENARIO 1: Fresh Signal (Low Risk) ───────────────────────────────────────
console.log('\n── Scenario 1: Fresh Signal (Low Risk) ─────────────────────────');
const now = new Date();
const bundle1 = createMockBundle({
  opportunityScore: 95,
  confidence: 85,
  qualityHolderCount: 25,
  trend: 'INCREASING',
  computedAt: new Date(now.getTime() - 5 * 60 * 1000) // 5 minutes ago
});

const input1: RiskInput = {
  signal: bundle1,
  marketPrice: 1.05,
  smartMoneyVWAP: 1.00, // Premium = 5%
  poolLiquidityUsd: 150000,
  simulatedValueRetentionPct: 99.0, // Meets Low Risk Honeypot threshold (>=98%)
  currentTime: now
};

const decision1 = RiskEngine.evaluate(input1);
assert(decision1.allowed === true, 'Low-risk fresh signal is allowed');
assert(decision1.riskTier === 'LOW', 'Correctly classified as LOW risk');
assert(decision1.positionSizePct === 25.0, `Allocated correct max position size (Expected: 25.0, Got: ${decision1.positionSizePct})`);
assert(decision1.stopLossPct === 7.5, `Stop loss cap bounded by remaining drawdown buffer (Expected: 7.5, Got: ${decision1.stopLossPct})`);

// ── SCENARIO 2: Signal Lag Fakeout (Medium Risk / Chase) ──────────────────────
console.log('\n── Scenario 2: Signal Lag Fakeout (Medium Risk / Chase) ────────');
const bundle2 = createMockBundle({
  opportunityScore: 90,
  confidence: 75,
  qualityHolderCount: 15,
  trend: 'INCREASING',
  computedAt: new Date(now.getTime() - 10 * 60 * 1000)
});

const input2: RiskInput = {
  signal: bundle2,
  marketPrice: 1.60,
  smartMoneyVWAP: 1.00, // Premium = 60% (> Medium Cap of 25%)
  poolLiquidityUsd: 60000,
  simulatedValueRetentionPct: 96.0,
  currentTime: now
};

const decision2 = RiskEngine.evaluate(input2);
assert(decision2.allowed === false, 'Signal lag fakeout with high premium is rejected');
assert(decision2.blockers.includes('premium_above_cap'), 'Blocker lists premium_above_cap');
assert(decision2.positionSizePct === 0.0, 'Position size is scaled to 0%');

// ── SCENARIO 3: Stale Signal (Ancient) ────────────────────────────────────────
console.log('\n── Scenario 3: Stale Signal (Ancient) ──────────────────────────');
const bundle3 = createMockBundle({
  opportunityScore: 80,
  confidence: 60,
  qualityHolderCount: 4,
  trend: 'STABLE',
  computedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000) // 24 hours ago
});

const input3: RiskInput = {
  signal: bundle3,
  marketPrice: 1.00,
  smartMoneyVWAP: 1.00,
  poolLiquidityUsd: 20000,
  simulatedValueRetentionPct: 92.0,
  currentTime: now
};

const decision3 = RiskEngine.evaluate(input3);
assert(decision3.allowed === false, 'Signal computed 24h ago is rejected');
assert(decision3.blockers.includes('signal_ancient_exceeds_12h'), 'Blocker lists signal_ancient_exceeds_12h');

// ── SCENARIO 4: Insider Setup (High Concentration) ───────────────────────────
console.log('\n── Scenario 4: Insider Setup (High Concentration) ──────────────');
const bundle4 = createMockBundle({
  opportunityScore: 85,
  confidence: 70,
  qualityHolderCount: 8,
  qualityConcentrationPct: 70.0, // > 65% concentration limit
  trend: 'STABLE',
  computedAt: new Date(now.getTime() - 10 * 60 * 1000)
});

const input4: RiskInput = {
  signal: bundle4,
  marketPrice: 1.00,
  smartMoneyVWAP: 1.00,
  poolLiquidityUsd: 30000,
  simulatedValueRetentionPct: 93.0,
  currentTime: now
};

const decision4 = RiskEngine.evaluate(input4);
assert(decision4.allowed === false, 'Insider setup is rejected');
assert(decision4.blockers.includes('high_concentration'), 'Blocker lists high_concentration');

// ── SCENARIO 5: Decreasing Trend (No Reversal) ───────────────────────────────
console.log('\n── Scenario 5: Decreasing Trend (No Reversal) ──────────────────');
const bundle5 = createMockBundle({
  opportunityScore: 75,
  confidence: 65,
  qualityHolderCount: 4,
  trend: 'DECREASING',
  qualityEntries4h: 1, // Below VVR threshold of 2 entries
  qualityExits4h: 3,
  netAccumulationFlow: -2,
  netAccumulationFlow24h: -5,
  computedAt: new Date(now.getTime() - 10 * 60 * 1000)
});

const input5: RiskInput = {
  signal: bundle5,
  marketPrice: 1.00,
  smartMoneyVWAP: 1.00,
  poolLiquidityUsd: 10000, // Below VVR threshold of $25,000
  simulatedValueRetentionPct: 91.0,
  currentTime: now
};

const decision5 = RiskEngine.evaluate(input5);
assert(decision5.allowed === false, 'Decreasing trend without VVR is rejected');
assert(decision5.blockers.includes('trend_decreasing_no_reversal'), 'Blocker lists trend_decreasing_no_reversal');

// ── SCENARIO 6: Decreasing Trend (Velocity-Validated Reversal) ────────────────
console.log('\n── Scenario 6: Decreasing Trend (Velocity-Validated Reversal) ──');
const bundle6 = createMockBundle({
  opportunityScore: 85,
  confidence: 75,
  qualityHolderCount: 12,
  trend: 'DECREASING',
  qualityEntries4h: 3,
  qualityExits4h: 1, // Ratio = 3.0 >= 1.5
  netAccumulationFlow: 2,
  netAccumulationFlow24h: 5,
  computedAt: new Date(now.getTime() - 10 * 60 * 1000)
});

const input6: RiskInput = {
  signal: bundle6,
  marketPrice: 1.00,
  smartMoneyVWAP: 1.00,
  poolLiquidityUsd: 50000, // Meets $25,000 floor
  simulatedValueRetentionPct: 96.0,
  currentTime: now
};

const decision6 = RiskEngine.evaluate(input6);
assert(decision6.allowed === true, 'Decreasing trend with VVR is allowed');
assert(decision6.riskTier === 'MEDIUM', 'Classified correctly as MEDIUM risk');
assert(decision6.stopLossPct === 4.0, 'Stop loss is hard-set to 4.0% for VVR');

// ── ADDITIONAL: Drawdown buffer & Daily loss decay validations ───────────────
console.log('\n── Additional Checks: Drawdown Buffer & Daily Loss Decay ───────');
const bundleAdd = createMockBundle({
  opportunityScore: 90,
  confidence: 80,
  qualityHolderCount: 25,
  trend: 'INCREASING',
  computedAt: new Date(now.getTime() - 5 * 60 * 1000)
});

const inputAdd1: RiskInput = {
  signal: bundleAdd,
  marketPrice: 1.00,
  smartMoneyVWAP: 1.00,
  poolLiquidityUsd: 150000,
  simulatedValueRetentionPct: 99.0,
  portfolio: {
    currentDrawdownPct: 4.0, // Remaining buffer = 6%
    dailyLossPct: 1.5,      // Decays sizing by 50%
    cashReservePct: 30.2,
    totalExposurePct: 5.0,
    openRiskPct: 5.0,
    openPositions: 2
  },
  currentTime: now
};

const decisionAdd1 = RiskEngine.evaluate(inputAdd1);
// Allocation: 25% * (0.90)^2 * F_drawdown * F_trend * F_daily
// F_drawdown = (6/8)^2 = 0.5625
// F_trend = 1.2
// F_daily = 1 - 1.5/3 = 0.50
// Size = 20.25 * 0.5625 * 1.2 * 0.50 = 6.83% of portfolio.
assert(decisionAdd1.allowed === true, 'Allowed under moderate portfolio stress');
assert(decisionAdd1.positionSizePct === 6.83, `Correctly computed size under decay factors (Expected: 6.83, Got: ${decisionAdd1.positionSizePct})`);
assert(decisionAdd1.stopLossPct === 4.5, `Stop loss correctly capped by drawdown buffer B * 0.75 (Expected: 4.5, Got: ${decisionAdd1.stopLossPct})`);

const inputAdd2: RiskInput = {
  signal: bundleAdd,
  marketPrice: 1.00,
  smartMoneyVWAP: 1.00,
  poolLiquidityUsd: 150000,
  simulatedValueRetentionPct: 99.0,
  portfolio: {
    currentDrawdownPct: 4.0,
    dailyLossPct: 3.0, // Hits rolling daily loss cap
    cashReservePct: 30.2,
    totalExposurePct: 20.0,
    openRiskPct: 5.0,
    openPositions: 2
  },
  currentTime: now
};

const decisionAdd2 = RiskEngine.evaluate(inputAdd2);
assert(decisionAdd2.allowed === false, 'Rejected if rolling daily loss >= 3.0%');
assert(decisionAdd2.blockers.includes('daily_loss_limit_reached'), 'Blocker lists daily_loss_limit_reached');

// ── ADDITIONAL: Gradual Chasing premium decay ($F_{chase}$) ──────────────────
console.log('\n── Additional Checks: Gradual Chasing Premium Decay ────────────');
const inputAdd3: RiskInput = {
  signal: bundleAdd,
  marketPrice: 1.20, // Premium = 20%
  smartMoneyVWAP: 1.00,
  poolLiquidityUsd: 150000,
  simulatedValueRetentionPct: 99.0,
  currentTime: now
};

const decisionAdd3 = RiskEngine.evaluate(inputAdd3);
// Sizing: 20.25 * F_trend (1.2) * F_chase (0.75 for 20% premium) = 18.22% (capped at Low max 25%)
assert(decisionAdd3.allowed === true, '20% premium chasing is allowed but downscaled');
assert(decisionAdd3.positionSizePct === 18.22, `Correctly scaled sizing (Expected: 18.22, Got: ${decisionAdd3.positionSizePct})`);

const inputAdd4: RiskInput = {
  signal: bundleAdd,
  marketPrice: 1.30, // Premium = 30% (Meets LOW cap but decays sizing to 0.40)
  smartMoneyVWAP: 1.00,
  poolLiquidityUsd: 150000,
  simulatedValueRetentionPct: 99.0,
  currentTime: now
};

const decisionAdd4 = RiskEngine.evaluate(inputAdd4);
// Sizing: 20.25 * F_trend (1.2) * F_chase (0.40 for 30% premium) = 9.72%
assert(decisionAdd4.allowed === true, '30% premium chasing is allowed but heavily downscaled');
assert(decisionAdd4.positionSizePct === 9.72, `Correctly scaled sizing (Expected: 9.72, Got: ${decisionAdd4.positionSizePct})`);

console.log('================================================================');
console.log(`Validation Results: ${passCount} PASS  ${failCount} FAIL`);

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
