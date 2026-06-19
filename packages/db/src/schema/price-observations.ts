import { pgTable, serial, varchar, doublePrecision, timestamp, index } from 'drizzle-orm/pg-core';

export const priceObservations = pgTable('price_observations', {
  id: serial('id').primaryKey(),
  tokenAddress: varchar('token_address', { length: 42 }).notNull(), // always lowercase
  sourcePoolAddress: varchar('source_pool_address', { length: 42 }), // nullable, always lowercase
  priceUsd: doublePrecision('price_usd').notNull(),
  volumeUsd: doublePrecision('volume_usd').notNull(),
  source: varchar('source', { length: 20 }).notNull(), // 'DEX_SWAP' | 'EXTERNAL_ORACLE'
  observedAt: timestamp('observed_at').defaultNow().notNull(),
}, (table) => ({
  tokenAddressIdx: index('price_observations_token_address_idx').on(table.tokenAddress),
  sourcePoolAddressIdx: index('price_observations_source_pool_address_idx').on(table.sourcePoolAddress),
  observedAtIdx: index('price_observations_observed_at_idx').on(table.observedAt),
}));

export type PriceObservation = typeof priceObservations.$inferSelect;
export type InsertPriceObservation = typeof priceObservations.$inferInsert;
