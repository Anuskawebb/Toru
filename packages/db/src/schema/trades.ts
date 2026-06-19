import { pgTable, serial, varchar, bigint, integer, timestamp, text, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const trades = pgTable('trades', {
  id: serial('id').primaryKey(),
  txHash: varchar('tx_hash', { length: 66 }).notNull(),
  blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
  logIndex: integer('log_index'),                              // Swap event position in receipt (nullable: pre-migration rows)
  timestamp: timestamp('timestamp').notNull(),
  wallet: varchar('wallet', { length: 42 }).notNull(),         // always lowercase
  dex: varchar('dex', { length: 50 }).notNull(),
  pairAddress: varchar('pair_address', { length: 42 }),        // pool/pair contract; always lowercase
  tokenInAddress: varchar('token_in_address', { length: 42 }).notNull(),
  tokenOutAddress: varchar('token_out_address', { length: 42 }).notNull(),
  tokenInSymbol: varchar('token_in_symbol', { length: 50 }).notNull(),
  tokenOutSymbol: varchar('token_out_symbol', { length: 50 }).notNull(),
  tokenInDecimals: integer('token_in_decimals').notNull().default(18),
  tokenOutDecimals: integer('token_out_decimals').notNull().default(18),
  amountIn: text('amount_in').notNull(),                       // raw BigInt as decimal string
  amountOut: text('amount_out').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    walletIdx: index('trades_wallet_idx').on(table.wallet),
    txHashIdx: index('trades_tx_hash_idx').on(table.txHash),
    blockNumberIdx: index('trades_block_number_idx').on(table.blockNumber),
    timestampIdx: index('trades_timestamp_idx').on(table.timestamp),
    walletBlockIdx: index('trades_wallet_block_idx').on(table.wallet, table.blockNumber),
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
