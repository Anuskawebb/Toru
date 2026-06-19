import {
  pgTable,
  varchar,
  doublePrecision,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * trade_recommendations — immutable decision audit trail.
 *
 * One row per agent decision (BUY, SELL, HOLD, SKIP).
 * Append-only: rows are never updated after insert.
 * Status transitions (PENDING → EXECUTED / EXPIRED / CANCELLED) are tracked here.
 *
 * Primary consumers:
 *   - ExecutionEngine (Phase 8): reads PENDING plans and executes them
 *   - Audit / monitoring: full decision history with reasons and blockers
 */
export const tradeRecommendations = pgTable('trade_recommendations', {
  id:               varchar('id', { length: 36 }).primaryKey(), // UUID

  agentWallet:      varchar('agent_wallet', { length: 42 }).notNull(),
  tokenAddress:     varchar('token_address', { length: 42 }).notNull(),
  tokenSymbol:      varchar('token_symbol', { length: 50 }).notNull(),

  // Decision
  action:           varchar('action', { length: 8 }).notNull(), // 'BUY' | 'SELL' | 'HOLD' | 'SKIP'

  // Sizing
  positionSizePct:  doublePrecision('position_size_pct').notNull(),
  estimatedUsd:     doublePrecision('estimated_usd').notNull(),
  entryPriceUsd:    doublePrecision('entry_price_usd').notNull(),

  // Risk parameters
  stopLossPct:      doublePrecision('stop_loss_pct').notNull(),
  takeProfitPct:    doublePrecision('take_profit_pct').notNull(),
  slippageLimitPct: doublePrecision('slippage_limit_pct').notNull(),

  // Classification
  riskTier:         varchar('risk_tier', { length: 12 }).notNull(),
  signalTier:       varchar('signal_tier', { length: 10 }).notNull(),

  // Scores
  opportunityScore: doublePrecision('opportunity_score').notNull(),
  convictionScore:  doublePrecision('conviction_score').notNull(),
  expectedEdge:     doublePrecision('expected_edge').notNull(),
  confidence:       doublePrecision('confidence').notNull(),

  // Audit trail (stored as JSON arrays)
  blockers:         jsonb('blockers').$type<string[]>().default([]).notNull(),
  reasons:          jsonb('reasons').$type<string[]>().default([]).notNull(),
  warnings:         jsonb('warnings').$type<string[]>().default([]).notNull(),

  // Lifecycle
  expiresAt:        timestamp('expires_at').notNull(),
  decidedAt:        timestamp('decided_at').notNull(),
  status:           varchar('status', { length: 12 }).notNull(), // 'PENDING' | 'EXECUTED' | 'EXPIRED' | 'CANCELLED'

  createdAt:        timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  walletIdx:    index('trade_recs_wallet_idx').on(table.agentWallet),
  tokenIdx:     index('trade_recs_token_idx').on(table.tokenAddress),
  statusIdx:    index('trade_recs_status_idx').on(table.status),
  decidedAtIdx: index('trade_recs_decided_at_idx').on(table.decidedAt),
  // Partial unique index: at most one PENDING BUY per (wallet, token).
  // Allows unlimited SELL, EXECUTED, EXPIRED, CANCELLED rows for the same pair.
  // Prevents duplicate BUY recommendations from accumulating across rapid cycles.
  pendingBuyUniqueIdx: uniqueIndex('trade_recs_pending_buy_unique')
    .on(table.agentWallet, table.tokenAddress)
    .where(sql`${table.action} = 'BUY' AND ${table.status} = 'PENDING'`),
}));

export type TradeRecommendationRow    = typeof tradeRecommendations.$inferSelect;
export type InsertTradeRecommendation = typeof tradeRecommendations.$inferInsert;
