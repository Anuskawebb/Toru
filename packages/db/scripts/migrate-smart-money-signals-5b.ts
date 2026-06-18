import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS token_intel_snapshots (
      token_address              varchar(42) NOT NULL,
      snapshot_at                timestamp NOT NULL,
      quality_holder_count       integer NOT NULL,
      holder_count               integer NOT NULL,
      quality_concentration_pct  numeric(5, 2) NOT NULL,
      quality_entry_count_1h     integer NOT NULL,
      quality_entry_count_4h     integer NOT NULL,
      quality_exit_count_1h      integer NOT NULL,
      quality_exit_count_4h      integer NOT NULL,
      net_accumulation_flow      integer NOT NULL,
      avg_quality_rank_score     numeric(5, 2) NOT NULL,
      accumulation_score         numeric(5, 2) NOT NULL,
      signal_tier                varchar(10) NOT NULL,
      computed_at                timestamp DEFAULT now() NOT NULL,
      PRIMARY KEY (token_address, snapshot_at)
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS token_intel_snapshots_snapshot_at_idx 
    ON token_intel_snapshots USING btree (snapshot_at)
  `);

  console.log('token_intel_snapshots table and indexes created successfully');
  await queryClient.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
