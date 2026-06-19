import {
  pgTable,
  varchar,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * execution_accounts — tracks agent wallet lifecycle across account types.
 *
 * V1: TWAK_AGENT — custodial wallet managed by TWAK SDK.
 * V2: SMART_ACCOUNT — delegated ERC-4337 account (non-custodial).
 * V3: WALLETCONNECT — user-signs-each-tx via WalletConnect.
 *
 * account_type drives which Executor implementation is selected at runtime.
 * Existing execution_orders.agent_wallet matches wallet_address (no FK yet — V1).
 */
export const executionAccounts = pgTable('execution_accounts', {
  id:             varchar('id', { length: 36 }).primaryKey(),

  agentId:        varchar('agent_id', { length: 50 }).notNull(),
  userId:         varchar('user_id', { length: 255 }),  // NULL for system-owned TWAK accounts

  accountType:    varchar('account_type', { length: 30 }).notNull(), // TWAK_AGENT | SMART_ACCOUNT | WALLETCONNECT
  walletAddress:  varchar('wallet_address', { length: 42 }).notNull(),

  status:         varchar('status', { length: 20 }).notNull().default('PENDING'), // PENDING | ACTIVE | SUSPENDED | REVOKED

  metadata:       jsonb('metadata'), // Type-specific: twakAgentId, sessionKey, wcTopic, etc.

  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentIdIdx:           index('exec_accounts_agent_id_idx').on(table.agentId),
  userIdIdx:            index('exec_accounts_user_id_idx').on(table.userId),
  statusIdx:            index('exec_accounts_status_idx').on(table.status),
  agentWalletUniqueIdx: uniqueIndex('exec_accounts_agent_wallet_idx').on(table.agentId, table.walletAddress),
}));

export type ExecutionAccountRow    = typeof executionAccounts.$inferSelect;
export type InsertExecutionAccount = typeof executionAccounts.$inferInsert;
export type AccountType = 'TWAK_AGENT' | 'SMART_ACCOUNT' | 'WALLETCONNECT';
export type AccountStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
