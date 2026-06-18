import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS smart_money_signals (
      token_address              varchar(42) PRIMARY KEY NOT NULL,
      token_symbol               varchar(50) DEFAULT 'UNKNOWN' NOT NULL,
      quality_entry_count_1h     integer DEFAULT 0 NOT NULL,
      quality_entry_count_4h     integer DEFAULT 0 NOT NULL,
      quality_exit_count_1h      integer DEFAULT 0 NOT NULL,
      quality_exit_count_4h      integer DEFAULT 0 NOT NULL,
      net_accumulation_flow      integer DEFAULT 0 NOT NULL,
      quality_holder_count       integer DEFAULT 0 NOT NULL,
      holder_count               integer DEFAULT 0 NOT NULL,
      quality_concentration_pct  numeric(5, 2) DEFAULT 0 NOT NULL,
      avg_quality_rank_score     numeric(5, 2) DEFAULT 0 NOT NULL,
      accumulator_holder_count   integer DEFAULT 0 NOT NULL,
      degen_holder_count         integer DEFAULT 0 NOT NULL,
      bot_holder_count           integer DEFAULT 0 NOT NULL,
      scout_holder_count         integer DEFAULT 0 NOT NULL,
      consensus_diversity        integer DEFAULT 0 NOT NULL,
      accumulation_score         numeric(5, 2) DEFAULT 0 NOT NULL,
      signal_tier                varchar(10) DEFAULT 'NOISE' NOT NULL,
      meets_minimum_holders      boolean DEFAULT false NOT NULL,
      narrative                  text DEFAULT '' NOT NULL,
      quality_holder_change_24h  integer,
      trend_direction            varchar(12) DEFAULT 'UNKNOWN' NOT NULL,
      computed_at                timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS smart_money_signals_accumulation_score_idx  ON smart_money_signals USING btree (accumulation_score)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS smart_money_signals_signal_tier_idx          ON smart_money_signals USING btree (signal_tier)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS smart_money_signals_meets_min_holders_idx    ON smart_money_signals USING btree (meets_minimum_holders)`);
  console.log('smart_money_signals table and indexes created');
  await queryClient.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
