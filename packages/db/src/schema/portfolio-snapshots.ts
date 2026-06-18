import {
  pgTable,
  serial,
  varchar,
  doublePrecision,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * portfolio_snapshots — time-series portfolio valuations.
 *
 * Written every 5 minutes by PortfolioStateService.refresh().
 * Retained for 7 days (competition window).
 *
 * Primary consumers:
 *   - rollingLossPct24h: query the earliest snapshot in the last 24h
 *   - Peak equity audit / competition PnL replay
 *   - drawdownPct history
 */
export const portfolioSnapshots = pgTable('portfolio_snapshots', {
  id:                  serial('id').primaryKey(),

  agentWallet:         varchar('agent_wallet', { length: 42 }).notNull(),
  snapshotAt:          timestamp('snapshot_at').notNull(),

  // Portfolio breakdown at snapshot time
  portfolioUsd:        doublePrecision('portfolio_usd').notNull(),
  stablecoinUsd:       doublePrecision('stablecoin_usd').notNull(),
  tokenExposureUsd:    doublePrecision('token_exposure_usd').notNull(),
  openPositions:       integer('open_positions').notNull(),
  unpricedPositions:   integer('unpriced_positions').default(0).notNull(),

  // Risk metrics at snapshot time
  peakPortfolioUsd:    doublePrecision('peak_portfolio_usd').notNull(),
  drawdownPct:         doublePrecision('drawdown_pct').notNull(),
  rollingLossPct24h:   doublePrecision('rolling_loss_pct_24h').notNull(),

  // Valuation trustworthiness (value-weighted average price confidence)
  valuationConfidence: doublePrecision('valuation_confidence').default(100).notNull(),

  createdAt:           timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  snapshotAtIdx:           index('portfolio_snapshots_snapshot_at_idx').on(table.snapshotAt),
  walletSnapshotIdx:       index('portfolio_snapshots_wallet_snapshot_idx').on(table.agentWallet, table.snapshotAt),
}));

export type PortfolioSnapshot    = typeof portfolioSnapshots.$inferSelect;
export type InsertPortfolioSnapshot = typeof portfolioSnapshots.$inferInsert;
