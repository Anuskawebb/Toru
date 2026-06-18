import { pgTable, varchar, integer, numeric, boolean, text, timestamp, index } from 'drizzle-orm/pg-core';

// Known BSC base/infrastructure tokens excluded from agent-facing signal rankings.
// These tokens appear in almost every trade and top raw volume rankings by structural
// necessity, not smart-money conviction. Agents should not act on their signals.
export const BSC_BASE_TOKENS = new Set([
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
  '0x55d398326f99059ff775485246999027b3197955', // USDT (BSC-native)
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC (BSC-native)
  '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
  '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', // DAI
  '0x2170ed0880ac9a755fd29b2688956bd959f933f8', // WETH (bridged)
  '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', // BTCB (wrapped BTC)
]);

export const smartMoneySignals = pgTable('smart_money_signals', {
  tokenAddress:  varchar('token_address', { length: 42 }).primaryKey(),
  tokenSymbol:   varchar('token_symbol',  { length: 50  }).default('UNKNOWN').notNull(),

  // ── Entry / exit counts ──────────────────────────────────────────────────────
  // Derived from wallet_positions.first_trade_at / last_trade_at relative to
  // the dataset's MAX(timestamp). In Phase 5A these are window-bounded, not
  // rolling from NOW() — entry counts will equal quality_holder_count while the
  // indexed data spans a single day. They become meaningful signals once the
  // dataset covers multiple days.
  qualityEntryCount1h:  integer('quality_entry_count_1h').default(0).notNull(),
  qualityEntryCount4h:  integer('quality_entry_count_4h').default(0).notNull(),
  qualityExitCount1h:   integer('quality_exit_count_1h').default(0).notNull(),
  qualityExitCount4h:   integer('quality_exit_count_4h').default(0).notNull(),

  // Entry_4h - exit_4h. Positive = net smart-money inflow; negative = outflow.
  netAccumulationFlow: integer('net_accumulation_flow').default(0).notNull(),

  // ── Current state signals (reliable at any data volume) ─────────────────────
  qualityHolderCount:      integer('quality_holder_count').default(0).notNull(),
  holderCount:             integer('holder_count').default(0).notNull(),

  // quality_holder_count / holder_count × 100. Suppressed to 0 when
  // holder_count < 10 (noise floor — see meets_minimum_holders).
  qualityConcentrationPct: numeric('quality_concentration_pct', { precision: 5, scale: 2 }).default('0').notNull(),

  // AVG(rank_score) among quality holders. Range: 80–100 (constrained by
  // quality holder threshold). Higher = more elite holder composition.
  avgQualityRankScore: numeric('avg_quality_rank_score', { precision: 5, scale: 2 }).default('0').notNull(),

  // Per-classification counts for quality holders (rank_score >= 80).
  // Used to build topClassifications in the agent bundle without a join.
  accumulatorHolderCount: integer('accumulator_holder_count').default(0).notNull(),
  degenHolderCount:       integer('degen_holder_count').default(0).notNull(),
  botHolderCount:         integer('bot_holder_count').default(0).notNull(),
  scoutHolderCount:       integer('scout_holder_count').default(0).notNull(),

  // COUNT(DISTINCT classification) among quality holders. Max 6. Saturates
  // quickly for widely-traded tokens — use accumulator_holder_count for finer signal.
  consensusDiversity: integer('consensus_diversity').default(0).notNull(),

  // ── Composite score and tier ─────────────────────────────────────────────────
  // Computed via PERCENT_RANK across all eligible tokens (must meet noise floor).
  // Weights: concentration 45%, avg_rank 30%, accumulator_count 25%.
  // Temporal entry signals are excluded from this score in Phase 5A.
  accumulationScore: numeric('accumulation_score', { precision: 5, scale: 2 }).default('0').notNull(),

  // STRONG:   score >= 75 AND quality_holder_count >= 10
  // MODERATE: score >= 50 AND quality_holder_count >= 5
  // WEAK:     score >= 25 AND quality_holder_count >= 3
  // NOISE:    does not meet noise floor (quality_holder_count < 3 OR holder_count < 10)
  signalTier: varchar('signal_tier', { length: 10 }).default('NOISE').notNull(),

  // False when quality_holder_count < 3 OR holder_count < 10.
  // Agents should not act on rows where this is false.
  meetsMinimumHolders: boolean('meets_minimum_holders').default(false).notNull(),

  // ── Plain-language narrative for agent consumption ───────────────────────────
  // Pre-generated summary combining key signal facts. Agents receive this
  // instead of raw numbers when doing LLM-based reasoning.
  narrative: text('narrative').default('').notNull(),

  // ── Temporal fields (Phase 5B — always null in Phase 5A) ────────────────────
  qualityHolderChange24h: integer('quality_holder_change_24h'),
  trendDirection: varchar('trend_direction', { length: 12 }).default('UNKNOWN').notNull(),

  computedAt: timestamp('computed_at').defaultNow().notNull(),
}, (table) => ({
  accumulationScoreIdx: index('smart_money_signals_accumulation_score_idx').on(table.accumulationScore),
  signalTierIdx: index('smart_money_signals_signal_tier_idx').on(table.signalTier),
  meetsMinimumHoldersIdx: index('smart_money_signals_meets_min_holders_idx').on(table.meetsMinimumHolders),
}));

export type SmartMoneySignal    = typeof smartMoneySignals.$inferSelect;
export type NewSmartMoneySignal = typeof smartMoneySignals.$inferInsert;

// ── Agent-consumable bundle type ─────────────────────────────────────────────
// This is the output contract for getTopSignals() and getSignal().
// Every field is pre-interpreted — agents receive this instead of raw DB rows.

export interface TokenSignalBundle {
  tokenAddress: string;
  tokenSymbol:  string;

  signalTier:       'STRONG' | 'MODERATE' | 'WEAK' | 'NEUTRAL';
  accumulationScore: number;
  opportunityScore:  number; // composite ranking score (0-100)
  confidence:        number; // statistical validity score (0-100)

  // Trend classification
  trend: 'INCREASING' | 'STABLE' | 'DECREASING' | 'UNKNOWN';

  // Current state
  qualityHolderCount:      number;
  holderCount:             number;
  qualityConcentrationPct: number;
  concentrationScore:      number; // derived concentration score
  avgQualityRank:          number;

  // Entry/exit metrics
  qualityEntries4h:       number;
  qualityExits4h:         number;
  netAccumulationFlow:    number;
  qualityEntries24h:      number;
  qualityExits24h:        number;
  netAccumulationFlow24h: number;

  // Classification breakdown, sorted by count descending, zeros omitted
  topClassifications: Array<{
    classification: string;
    count: number;
    pct:   number;
  }>;

  // Reasons & Risks
  signalReasons: string[];
  riskFlags:     string[];

  // Phase 5B / 5C compatibility changes
  qualityHolderChange24h: number | null;

  // Agent guidance
  narrative:      string;
  dataFreshness:  'LIVE' | 'STALE';
  minimumHolders: boolean;
  computedAt:     Date;
}

