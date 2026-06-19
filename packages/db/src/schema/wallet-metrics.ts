import {
  pgTable,
  varchar,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * wallet_metrics — denormalized trader intelligence summary.
 *
 * One row per wallet. Every field is derived from `trades` and
 * `wallet_positions`. Never store raw amounts here; this table answers
 * activity and exposure questions, not PnL.
 *
 * All wallet addresses are lowercase (enforced by repository layer).
 *
 * Field rationale
 * ───────────────
 * wallet                — natural primary key; enforces one row per address.
 *
 * tradeCount            — COUNT(*) from trades. The primary activity signal.
 *                         Powers "who are the most active traders?" ranking.
 *
 * buyCount              — In the current swap-only model, every swap acquires
 *                         tokenOut, so buyCount = tradeCount. Stored separately
 *                         to remain forward-compatible with limit-order or P2P
 *                         trade types where buy/sell events can diverge.
 *
 * sellCount             — Symmetric to buyCount. Every swap spends tokenIn, so
 *                         sellCount = tradeCount in the current model.
 *
 * uniqueTokens          — COUNT(DISTINCT token) across both sides of all trades
 *                         (token_in ∪ token_out). Measures breadth of market
 *                         exposure. Powers "which traders have broad exposure?"
 *
 * firstSeen             — MIN(timestamp) across all trades. Indicates when the
 *                         wallet first appeared on-chain in our indexed range.
 *                         Nullable: safe default when no trades exist yet.
 *
 * lastSeen              — MAX(timestamp). The primary recency signal. Powers
 *                         "which traders are still active?" queries.
 *
 * activeDays            — COUNT(DISTINCT DATE(timestamp)). Distinguishes daily
 *                         bots (activeDays ≈ indexedDays) from occasional traders
 *                         (activeDays = 1). Cannot be maintained incrementally
 *                         via arithmetic; always recomputed from ground truth.
 *
 * currentOpenPositions  — COUNT of wallet_positions rows where
 *                         net_amount::numeric > 0. Captures how many tokens the
 *                         wallet currently holds net-long. Powers "which traders
 *                         maintain many open positions?" Requires positions to be
 *                         up-to-date before this metric is written.
 *
 * totalBoughtTrades     — Total buy-side appearances. Equals tradeCount in the
 *                         swap model. Stored to support future aggregation
 *                         pipelines that combine multiple event tables.
 *
 * totalSoldTrades       — Symmetric to totalBoughtTrades.
 *
 * lastUpdated           — Wall-clock time this row was last written. Allows
 *                         monitoring of metric staleness.
 */
export const walletMetrics = pgTable('wallet_metrics', {
  wallet: varchar('wallet', { length: 42 }).primaryKey(),

  tradeCount:           integer('trade_count').default(0).notNull(),
  buyCount:             integer('buy_count').default(0).notNull(),
  sellCount:            integer('sell_count').default(0).notNull(),

  uniqueTokens:         integer('unique_tokens').default(0).notNull(),

  firstSeen:            timestamp('first_seen'),
  lastSeen:             timestamp('last_seen'),
  activeDays:           integer('active_days').default(0).notNull(),

  currentOpenPositions: integer('current_open_positions').default(0).notNull(),

  totalBoughtTrades:    integer('total_bought_trades').default(0).notNull(),
  totalSoldTrades:      integer('total_sold_trades').default(0).notNull(),

  lastUpdated:          timestamp('last_updated').defaultNow().notNull(),
}, (table) => ({
  lastSeenIdx:    index('wallet_metrics_last_seen_idx').on(table.lastSeen),
  tradeCountIdx:  index('wallet_metrics_trade_count_idx').on(table.tradeCount),
}));

export type WalletMetric      = typeof walletMetrics.$inferSelect;
export type InsertWalletMetric = typeof walletMetrics.$inferInsert;
