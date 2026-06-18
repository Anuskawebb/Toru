import { pgTable, varchar, doublePrecision, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const tokenPrices = pgTable('token_prices', {
  tokenAddress: varchar('token_address', { length: 42 }).primaryKey(), // always lowercase
  priceUsd: doublePrecision('price_usd').notNull(),
  vwap1m: doublePrecision('vwap_1m').notNull(),
  vwap15m: doublePrecision('vwap_15m').notNull(),
  vwap1h: doublePrecision('vwap_1h').notNull(),
  observationCount1h: integer('observation_count_1h').default(0).notNull(),
  liquidityUsd: doublePrecision('liquidity_usd').default(0).notNull(),
  routeType: varchar('route_type', { length: 20 }).notNull(), // 'DIRECT_STABLE' | 'WBNB_ROUTE' | 'EXTERNAL'
  priceState: varchar('price_state', { length: 20 }).default('FRESH').notNull(), // 'FRESH' | 'STALE' | 'UNRESOLVABLE' | 'MANIPULATED'
  priceConfidence: doublePrecision('price_confidence').default(100.0).notNull(),
  manipulationFlag: boolean('manipulation_flag').default(false).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  priceStateIdx: index('token_prices_price_state_idx').on(table.priceState),
  priceConfidenceIdx: index('token_prices_price_confidence_idx').on(table.priceConfidence),
}));

export type TokenPrice = typeof tokenPrices.$inferSelect;
export type InsertTokenPrice = typeof tokenPrices.$inferInsert;
