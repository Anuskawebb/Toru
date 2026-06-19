import {
  pgTable,
  varchar,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * agent_positions — mutable position registry for the autonomous agent.
 *
 * Distinct from wallet_positions (raw blockchain accounting).
 * Tracks the agent's INTENDED positions with entry parameters, stop-loss,
 * take-profit, and lifecycle state.
 *
 * Invariant: at most one OPEN row per (agent_wallet, token_address).
 * Enforced at the application level in PositionRegistryService.openPosition().
 *
 * Primary consumers:
 *   - DecisionEngine: exit evaluation (stop-loss, take-profit, reversal)
 *   - PortfolioStateService: open risk accounting
 *   - ExecutionEngine (Phase 8): executes SELL plans
 */
export const agentPositions = pgTable('agent_positions', {
  id:               varchar('id', { length: 36 }).primaryKey(), // UUID

  agentWallet:      varchar('agent_wallet', { length: 42 }).notNull(),
  tokenAddress:     varchar('token_address', { length: 42 }).notNull(),
  tokenSymbol:      varchar('token_symbol', { length: 50 }).notNull(),

  // Links back to the BUY recommendation that opened this position
  recommendationId: varchar('recommendation_id', { length: 36 }),

  // Entry parameters (immutable after open)
  entryPriceUsd:    doublePrecision('entry_price_usd').notNull(),
  positionSizeUsd:  doublePrecision('position_size_usd').notNull(),
  positionSizePct:  doublePrecision('position_size_pct').notNull(),
  stopLossPct:      doublePrecision('stop_loss_pct').notNull(),
  takeProfitPct:    doublePrecision('take_profit_pct').notNull(),

  // Mark-to-market (updated each cycle)
  currentPriceUsd:  doublePrecision('current_price_usd').notNull(),
  unrealizedPnlPct: doublePrecision('unrealized_pnl_pct').notNull(),

  // Lifecycle
  status:           varchar('status', { length: 8 }).notNull(),  // 'OPEN' | 'CLOSED'
  closeReason:      varchar('close_reason', { length: 20 }),      // 'STOP_LOSS' | 'TAKE_PROFIT' | 'SIGNAL_REVERSAL' | 'MANUAL'
  closePriceUsd:    doublePrecision('close_price_usd'),

  openedAt:         timestamp('opened_at').notNull(),
  closedAt:         timestamp('closed_at'),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  walletIdx:       index('agent_positions_wallet_idx').on(table.agentWallet),
  tokenIdx:        index('agent_positions_token_idx').on(table.tokenAddress),
  statusIdx:       index('agent_positions_status_idx').on(table.status),
  walletTokenIdx:  index('agent_positions_wallet_token_idx').on(table.agentWallet, table.tokenAddress),
  // Partial unique index: at most one OPEN position per (wallet, token).
  // Allows unlimited CLOSED rows for the same pair (full history preserved).
  openUniqueIdx:   uniqueIndex('agent_positions_open_unique')
    .on(table.agentWallet, table.tokenAddress)
    .where(sql`${table.status} = 'OPEN'`),
}));

export type AgentPositionRow    = typeof agentPositions.$inferSelect;
export type InsertAgentPosition = typeof agentPositions.$inferInsert;
