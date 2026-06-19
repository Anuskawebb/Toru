import { pgTable, serial, varchar, integer, timestamp, text, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const walletPositions = pgTable('wallet_positions', {
  id: serial('id').primaryKey(),
  wallet: varchar('wallet', { length: 42 }).notNull(),         // always lowercase
  tokenAddress: varchar('token_address', { length: 42 }).notNull(), // always lowercase
  tokenSymbol: varchar('token_symbol', { length: 50 }).notNull(),
  tokenDecimals: integer('token_decimals').notNull(),
  totalBought: text('total_bought').default('0').notNull(),    // raw BigInt as decimal string
  totalSold: text('total_sold').default('0').notNull(),        // raw BigInt as decimal string
  netAmount: text('net_amount').default('0').notNull(),        // totalBought - totalSold
  firstTradeAt: timestamp('first_trade_at').notNull(),
  lastTradeAt: timestamp('last_trade_at').notNull(),
  tradeCount: integer('trade_count').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    walletIdx: index('wallet_positions_wallet_idx').on(table.wallet),
    tokenAddressIdx: index('wallet_positions_token_address_idx').on(table.tokenAddress),
    uniqueWalletTokenIdx: uniqueIndex('wallet_positions_wallet_token_idx').on(table.wallet, table.tokenAddress),
  };
});

export type WalletPosition = typeof walletPositions.$inferSelect;
export type InsertWalletPosition = typeof walletPositions.$inferInsert;
