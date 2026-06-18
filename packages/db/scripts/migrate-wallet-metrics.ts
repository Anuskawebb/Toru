import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS wallet_metrics (
      wallet varchar(42) PRIMARY KEY NOT NULL,
      trade_count integer DEFAULT 0 NOT NULL,
      buy_count integer DEFAULT 0 NOT NULL,
      sell_count integer DEFAULT 0 NOT NULL,
      unique_tokens integer DEFAULT 0 NOT NULL,
      first_seen timestamp,
      last_seen timestamp,
      active_days integer DEFAULT 0 NOT NULL,
      current_open_positions integer DEFAULT 0 NOT NULL,
      total_bought_trades integer DEFAULT 0 NOT NULL,
      total_sold_trades integer DEFAULT 0 NOT NULL,
      last_updated timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS wallet_metrics_last_seen_idx
    ON wallet_metrics USING btree (last_seen)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS wallet_metrics_trade_count_idx
    ON wallet_metrics USING btree (trade_count)
  `);
  console.log('wallet_metrics table and indexes created');
  await queryClient.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
