import {
  pgTable,
  varchar,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * token_metrics — denormalized token intelligence layer.
 *
 * One row per token.  All fields are derived from `trades`, `wallet_positions`,
 * and `wallet_scores`.  This table is rebuilt in a single batch SQL pass and is
 * NOT updated incrementally per block.  Call TokenMetricsRepository.rebuildAll()
 * after a full backfill or on schedule (e.g., hourly).
 *
 * All token addresses are stored lowercase (enforced by repository layer).
 *
 * Dependency ordering for a correct full refresh:
 *   1. PositionRepository.rebuildAll()
 *   2. WalletMetricsRepository.rebuildAll()
 *   3. WalletScoresRepository.rebuildAll()
 *   4. TokenMetricsRepository.rebuildAll()  ← this table
 *
 * Field rationale
 * ───────────────
 * token_address   — natural primary key; one row per unique token contract.
 *                   Sourced from both sides of every trade (token_in and token_out).
 *
 * token_symbol    — preferred from the `tokens` table (authoritative, verified).
 *                   Falls back to the trade-embedded symbol (tokenOutSymbol /
 *                   tokenInSymbol).  'UNKNOWN' if no symbol was ever observed.
 *
 * token_decimals  — preferred from `tokens` table.  Falls back to trade-embedded
 *                   decimals.  Defaults to 18.
 *
 * trade_count     — COUNT(*) of all trade appearances (both as tokenIn and tokenOut).
 *                   A token that is swapped for/from 500 times has trade_count=500.
 *                   Powers "most traded tokens" rankings.
 *
 * buy_trades      — COUNT where this token appears as tokenOut (received by the wallet).
 *                   Measures buy-side trade volume.
 *
 * sell_trades     — COUNT where this token appears as tokenIn (spent by the wallet).
 *                   Measures sell-side trade volume.
 *                   Invariant: buy_trades + sell_trades = trade_count.
 *
 * unique_traders  — COUNT(DISTINCT wallet) across both sides of all trades involving
 *                   this token.  Powers "broadest participation" rankings.
 *
 * unique_buyers   — COUNT(DISTINCT wallet) where this token was the tokenOut.
 *                   How many distinct wallets have ever bought this token.
 *
 * unique_sellers  — COUNT(DISTINCT wallet) where this token was the tokenIn.
 *                   How many distinct wallets have ever sold this token.
 *
 * holder_count    — COUNT of wallet_positions rows where net_amount > 0 for this
 *                   token.  Represents the number of wallets that currently hold a
 *                   net-long position.  Requires wallet_positions to be up-to-date.
 *
 * quality_holder_count — Subset of holder_count restricted to wallets with
 *                   wallet_scores.rank_score >= 80 (top 4.5% of wallets by
 *                   behavioral quality).  The threshold 80 was chosen after probing
 *                   the live score distribution: 80 selects 1,056 / 23,605 wallets
 *                   (4.47%), each with high activity, conviction, and breadth scores.
 *                   This is the primary smart-money signal in token_metrics: which
 *                   tokens are attracting the most high-quality traders?
 *
 * active_wallet_count — COUNT(DISTINCT wallet) that traded this token within the
 *                   most recent 24-hour window of the indexed dataset
 *                   (NOT relative to NOW()).  This is a recency signal: tokens
 *                   actively traded in the latest ingested data score higher.
 *                   NOTE: with only a single day of indexed data this equals
 *                   unique_traders for all tokens.  The metric becomes meaningful
 *                   once the dataset spans multiple days.
 *
 * net_holders     — unique_buyers - unique_sellers.  Measures net buy-side breadth:
 *                   how many more distinct wallets bought this token than sold it.
 *                   Positive = buy pressure exceeds sell pressure at wallet level.
 *                   Can be negative (more distinct sellers than buyers).
 *                   NOTE: this is a wallet-breadth metric, not a volume metric.
 *                   High net_holders with low trade_count = narrow but directional
 *                   accumulation.  Complements holder_count (position-based).
 *
 * first_seen      — MIN(timestamp) across all trades involving this token.
 *                   Indicates when the token first appeared in the indexed range.
 *
 * last_seen       — MAX(timestamp) across all trades.  Primary recency signal.
 *                   Powers "most recently active tokens" queries.
 *
 * last_updated    — Wall-clock time this row was last rebuilt.  Allows detecting
 *                   stale token_metrics rows before querying downstream systems.
 *
 * Quality holder threshold — rank_score >= 80
 * ────────────────────────────────────────────
 * Probed live distribution (23,605 wallets, 2026-06-18):
 *   rank_score >= 80 → 1,056 wallets (4.47%)  — CHOSEN
 *   rank_score >= 70 → 2,691 wallets (11.4%)
 *   rank_score >= 60 → 4,603 wallets (19.5%)
 *   rank_score >  15 → 10,619 wallets (45.0%)  — "above retail floor"
 *
 * rank_score = 80 was chosen because:
 *   - It naturally excludes the entire "retail" cohort (score ≈ 15)
 *   - It selects wallets with strong activity AND conviction dimensions
 *   - The resulting 1,056 wallets collectively hold 5,800 open positions —
 *     a rich signal set without being diluted by noise
 *
 * Export QUALITY_HOLDER_THRESHOLD so callers can inspect and document it
 * without re-reading SQL strings.
 */

export const QUALITY_HOLDER_THRESHOLD = 80;

export const tokenMetrics = pgTable('token_metrics', {
  tokenAddress: varchar('token_address', { length: 42 }).primaryKey(),

  tokenSymbol:   varchar('token_symbol',   { length: 50  }).default('UNKNOWN').notNull(),
  tokenDecimals: integer('token_decimals').default(18).notNull(),

  // Trade volume
  tradeCount:   integer('trade_count').default(0).notNull(),
  buyTrades:    integer('buy_trades').default(0).notNull(),
  sellTrades:   integer('sell_trades').default(0).notNull(),

  // Trader breadth
  uniqueTraders:  integer('unique_traders').default(0).notNull(),
  uniqueBuyers:   integer('unique_buyers').default(0).notNull(),
  uniqueSellers:  integer('unique_sellers').default(0).notNull(),

  // Holder intelligence
  holderCount:         integer('holder_count').default(0).notNull(),
  qualityHolderCount:  integer('quality_holder_count').default(0).notNull(),
  activeWalletCount:   integer('active_wallet_count').default(0).notNull(),

  // Buy/sell wallet pressure
  netHolders: integer('net_holders').default(0).notNull(),

  // Temporal
  firstSeen:   timestamp('first_seen'),
  lastSeen:    timestamp('last_seen'),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
}, (table) => ({
  lastSeenIdx:           index('token_metrics_last_seen_idx').on(table.lastSeen),
  uniqueTradersIdx:      index('token_metrics_unique_traders_idx').on(table.uniqueTraders),
  qualityHolderCountIdx: index('token_metrics_quality_holder_count_idx').on(table.qualityHolderCount),
  tradeCountIdx:         index('token_metrics_trade_count_idx').on(table.tradeCount),
}));

export type TokenMetric       = typeof tokenMetrics.$inferSelect;
export type InsertTokenMetric = typeof tokenMetrics.$inferInsert;
