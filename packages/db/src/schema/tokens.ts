import { pgTable, varchar, integer, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const tokens = pgTable('tokens', {
  address: varchar('address', { length: 42 }).primaryKey(), // Canonical address
  symbol: varchar('symbol', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  decimals: integer('decimals').notNull(),
  imageUrl: text('image_url'),
  coingeckoId: varchar('coingecko_id', { length: 100 }),
  verified: boolean('verified').default(false).notNull(),
  firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Token = typeof tokens.$inferSelect;
export type InsertToken = typeof tokens.$inferInsert;
