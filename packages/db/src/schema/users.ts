import { pgTable, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * users — identity layer for Toru operators.
 *
 * V1: system-only. The single default row represents the solo operator.
 * V2 (post-auth): privy_id is populated when Privy is wired in.
 *   privy_user_id → users.privyId → users.id
 *   No schema rewrite needed — just fill the column.
 *
 * walletAddress is the *user's* custodial wallet for login / identity,
 * NOT the agent execution wallet (which lives in execution_accounts).
 */
export const users = pgTable('users', {
  id:            varchar('id', { length: 36 }).primaryKey(), // UUID

  email:         varchar('email', { length: 255 }),
  walletAddress: varchar('wallet_address', { length: 42 }),
  displayName:   varchar('display_name', { length: 100 }),

  // Reserved for future Privy integration — no schema change needed then
  privyId:       varchar('privy_id', { length: 255 }),

  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  emailUniqueIdx:     uniqueIndex('users_email_idx').on(table.email),
  walletUniqueIdx:    uniqueIndex('users_wallet_idx').on(table.walletAddress),
  privyUniqueIdx:     uniqueIndex('users_privy_id_idx').on(table.privyId),
}));

export type UserRow    = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
