import { pgTable, serial, varchar, bigint, timestamp, text, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const trades = pgTable('trades', {
  id: serial('id').primaryKey(),
  txHash: varchar('tx_hash', { length: 66 }).notNull(),
  blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
  timestamp: timestamp('timestamp').notNull(),
  wallet: varchar('wallet', { length: 42 }).notNull(),
  dex: varchar('dex', { length: 50 }).notNull(),
  tokenInAddress: varchar('token_in_address', { length: 42 }).notNull(),
  tokenOutAddress: varchar('token_out_address', { length: 42 }).notNull(),
  tokenInSymbol: varchar('token_in_symbol', { length: 50 }).notNull(),
  tokenOutSymbol: varchar('token_out_symbol', { length: 50 }).notNull(),
  amountIn: text('amount_in').notNull(),
  amountOut: text('amount_out').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    walletIdx: index('trades_wallet_idx').on(table.wallet),
    txHashIdx: index('trades_tx_hash_idx').on(table.txHash),
    timestampIdx: index('trades_timestamp_idx').on(table.timestamp),
    tokenInAddressIdx: index('trades_token_in_address_idx').on(table.tokenInAddress),
    tokenOutAddressIdx: index('trades_token_out_address_idx').on(table.tokenOutAddress),
    uniqueTradeIdx: uniqueIndex('trades_unique_trade_idx').on(
      table.txHash,
      table.wallet,
      table.tokenInAddress,
      table.tokenOutAddress,
      table.amountIn,
      table.amountOut,
      table.dex
    ),
  };
});

export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;
