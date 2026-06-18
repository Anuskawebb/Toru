import {
  pgTable,
  varchar,
  doublePrecision,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * portfolio_state — single-row live portfolio state per agent wallet.
 *
 * Upserted on every PortfolioStateService.refresh() call.
 * Primary key is agentWallet — one row per agent, always reflects current state.
 *
 * This is the table the Risk Engine and Decision Engine read.
 * All fields map directly to RiskPortfolioState or extend it with additional context.
 *
 * Survives restarts:
 *   - startingCapitalUsd persisted here prevents loss of competition baseline
 *   - peakPortfolioUsd persisted here prevents drawdown reset on restart
 */
export const portfolioState = pgTable('portfolio_state', {
  agentWallet:         varchar('agent_wallet', { length: 42 }).primaryKey(),

  // Capital breakdown
  portfolioUsd:        doublePrecision('portfolio_usd').notNull(),
  stablecoinUsd:       doublePrecision('stablecoin_usd').notNull(),
  tokenExposureUsd:    doublePrecision('token_exposure_usd').notNull(),
  buyingPowerUsd:      doublePrecision('buying_power_usd').notNull(),

  // Competition baseline (persisted for restart safety)
  startingCapitalUsd:  doublePrecision('starting_capital_usd').notNull(),
  peakPortfolioUsd:    doublePrecision('peak_portfolio_usd').notNull(),

  // Risk metrics (directly maps to RiskPortfolioState)
  drawdownPct:         doublePrecision('drawdown_pct').notNull(),
  rollingLossPct24h:   doublePrecision('rolling_loss_pct_24h').notNull(),
  cashReservePct:      doublePrecision('cash_reserve_pct').notNull(),
  totalExposurePct:    doublePrecision('total_exposure_pct').notNull(),
  openRiskPct:         doublePrecision('open_risk_pct').notNull(),

  // Position summary
  openPositions:       integer('open_positions').notNull(),
  unpricedPositions:   integer('unpriced_positions').default(0).notNull(),

  // Valuation trustworthiness: value-weighted average price confidence (0–100)
  valuationConfidence: doublePrecision('valuation_confidence').default(100).notNull(),

  lastValuationAt:     timestamp('last_valuation_at').notNull(),
  updatedAt:           timestamp('updated_at').defaultNow().notNull(),
});

export type PortfolioState       = typeof portfolioState.$inferSelect;
export type InsertPortfolioState = typeof portfolioState.$inferInsert;
