import { pgTable, varchar, bigint, timestamp } from 'drizzle-orm/pg-core';

export const indexerState = pgTable('indexer_state', {
  chain: varchar('chain', { length: 50 }).primaryKey(),
  lastProcessedBlock: bigint('last_processed_block', { mode: 'bigint' }).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type IndexerState = typeof indexerState.$inferSelect;
export type InsertIndexerState = typeof indexerState.$inferInsert;
