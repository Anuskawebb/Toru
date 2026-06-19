import { pgTable, varchar, integer, numeric, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

export const tokenIntelSnapshots = pgTable('token_intel_snapshots', {
  tokenAddress: varchar('token_address', { length: 42 }).notNull(),
  snapshotAt:   timestamp('snapshot_at').notNull(),

  qualityHolderCount:      integer('quality_holder_count').notNull(),
  holderCount:             integer('holder_count').notNull(),
  qualityConcentrationPct: numeric('quality_concentration_pct', { precision: 5, scale: 2 }).notNull(),

  qualityEntryCount1h:  integer('quality_entry_count_1h').notNull(),
  qualityEntryCount4h:  integer('quality_entry_count_4h').notNull(),
  qualityExitCount1h:   integer('quality_exit_count_1h').notNull(),
  qualityExitCount4h:   integer('quality_exit_count_4h').notNull(),

  netAccumulationFlow: integer('net_accumulation_flow').notNull(),

  avgQualityRankScore: numeric('avg_quality_rank_score', { precision: 5, scale: 2 }).notNull(),
  accumulationScore:   numeric('accumulation_score', { precision: 5, scale: 2 }).notNull(),
  signalTier:          varchar('signal_tier', { length: 10 }).notNull(),

  computedAt: timestamp('computed_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.tokenAddress, table.snapshotAt] }),
  snapshotAtIdx: index('token_intel_snapshots_snapshot_at_idx').on(table.snapshotAt),
}));

export type TokenIntelSnapshot    = typeof tokenIntelSnapshots.$inferSelect;
export type InsertTokenIntelSnapshot = typeof tokenIntelSnapshots.$inferInsert;
