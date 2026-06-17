import { pgTable, varchar, integer, timestamp, boolean } from 'drizzle-orm/pg-core';

export const tokenDiscoveryQueue = pgTable('token_discovery_queue', {
  address: varchar('address', { length: 42 }).primaryKey(),
  firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lastAttemptedAt: timestamp('last_attempted_at'),
  resolved: boolean('resolved').default(false).notNull(),
});

export type TokenDiscoveryQueue = typeof tokenDiscoveryQueue.$inferSelect;
export type InsertTokenDiscoveryQueue = typeof tokenDiscoveryQueue.$inferInsert;
