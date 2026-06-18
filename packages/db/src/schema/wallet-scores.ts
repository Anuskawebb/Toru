import {
  pgTable,
  varchar,
  numeric,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * wallet_scores — behavioral intelligence layer on top of wallet_metrics.
 *
 * One row per wallet. Scores are computed in a single batch SQL pass using
 * window functions (PERCENT_RANK) so all wallets are ranked relative to each
 * other.  The table is NOT updated incrementally per block; it is rebuilt
 * after ingesting large batches or on schedule via WalletScoresRepository.rebuildAll().
 *
 * All numeric scores are stored as NUMERIC(5,2): range 0.00 – 100.00.
 * Drizzle returns numeric columns as strings; callers should parseFloat().
 *
 * Field rationale
 * ───────────────
 * wallet               — PK; lowercase; matches wallet_metrics.wallet.
 *
 * activityScore        — PERCENT_RANK() by trade_count, scaled 0-100.
 *                        Measures trading volume relative to all wallets in
 *                        the dataset. A score of 90 means the wallet trades
 *                        more than 90% of all observed wallets.
 *
 * convictionScore      — (current_open_positions / unique_tokens) * 100.
 *                        Measures portfolio retention: what fraction of tokens
 *                        traded does the wallet currently hold net-long?
 *                        Score 100 = holds every token it ever touched;
 *                        Score 0   = nothing held (pure flipper or empty).
 *
 * breadthScore         — PERCENT_RANK() by unique_tokens, scaled 0-100.
 *                        Measures market exposure width. A score of 95 means
 *                        the wallet traded more distinct tokens than 95% of
 *                        all wallets.
 *
 * consistencyScore     — PERCENT_RANK() by (trade_count / unique_tokens),
 *                        scaled 0-100. Measures trading focus: a wallet that
 *                        trades the same tokens many times scores high (bot,
 *                        systematic); a wallet that samples each token once
 *                        scores low (explorer). Requires multi-day data to
 *                        distinguish strategic consistency from recency — use
 *                        this metric with caution when the dataset spans < 7 days.
 *
 * rankScore            — Weighted composite: activity(40%) + conviction(30%)
 *                        + breadth(20%) + consistency(10%). The weights favour
 *                        active, conviction-based traders. Adjust in
 *                        WalletScoresRepository.SCORE_WEIGHTS for different
 *                        downstream use-cases.
 *
 * rankPosition         — Ordinal rank by rankScore DESC (1 = best ranked).
 *                        Ties share the same rank (RANK(), not ROW_NUMBER()).
 *
 * classification       — Behavioral label derived from raw metric thresholds
 *                        (not scores). Labels: bot | degen | accumulator |
 *                        scout | flipper | retail | unknown.
 *                        See WalletScoresRepository.CLASSIFICATION for the
 *                        exact CASE logic and rationale.
 *
 * tradeCount           — Snapshot of wallet_metrics.trade_count at compute time.
 * uniqueTokens         — Snapshot of wallet_metrics.unique_tokens.
 * currentOpenPositions — Snapshot of wallet_metrics.current_open_positions.
 * activeDays           — Snapshot of wallet_metrics.active_days.
 *                        Snapshots allow auditing score provenance without
 *                        re-joining wallet_metrics.
 *
 * lastUpdated          — Wall-clock time this row was last computed.
 */
export const walletScores = pgTable('wallet_scores', {
  wallet: varchar('wallet', { length: 42 }).primaryKey(),

  activityScore:    numeric('activity_score',    { precision: 5, scale: 2 }).default('0').notNull(),
  convictionScore:  numeric('conviction_score',  { precision: 5, scale: 2 }).default('0').notNull(),
  breadthScore:     numeric('breadth_score',     { precision: 5, scale: 2 }).default('0').notNull(),
  consistencyScore: numeric('consistency_score', { precision: 5, scale: 2 }).default('0').notNull(),

  rankScore:    numeric('rank_score', { precision: 5, scale: 2 }).default('0').notNull(),
  rankPosition: integer('rank_position'),

  classification: varchar('classification', { length: 20 }).default('unknown').notNull(),

  // Inputs snapshot — audit trail, avoids re-join for explanation queries
  tradeCount:           integer('trade_count').default(0).notNull(),
  uniqueTokens:         integer('unique_tokens').default(0).notNull(),
  currentOpenPositions: integer('current_open_positions').default(0).notNull(),
  activeDays:           integer('active_days').default(0).notNull(),

  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
}, (table) => ({
  rankScoreIdx:      index('wallet_scores_rank_score_idx').on(table.rankScore),
  rankPositionIdx:   index('wallet_scores_rank_position_idx').on(table.rankPosition),
  classificationIdx: index('wallet_scores_classification_idx').on(table.classification),
}));

export type WalletScore       = typeof walletScores.$inferSelect;
export type InsertWalletScore = typeof walletScores.$inferInsert;
