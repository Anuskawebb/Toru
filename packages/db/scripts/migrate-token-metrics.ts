import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS token_metrics (
      token_address          varchar(42) PRIMARY KEY NOT NULL,
      token_symbol           varchar(50) DEFAULT 'UNKNOWN' NOT NULL,
      token_decimals         integer DEFAULT 18 NOT NULL,
      trade_count            integer DEFAULT 0 NOT NULL,
      buy_trades             integer DEFAULT 0 NOT NULL,
      sell_trades            integer DEFAULT 0 NOT NULL,
      unique_traders         integer DEFAULT 0 NOT NULL,
      unique_buyers          integer DEFAULT 0 NOT NULL,
      unique_sellers         integer DEFAULT 0 NOT NULL,
      holder_count           integer DEFAULT 0 NOT NULL,
      quality_holder_count   integer DEFAULT 0 NOT NULL,
      active_wallet_count    integer DEFAULT 0 NOT NULL,
      net_holders            integer DEFAULT 0 NOT NULL,
      first_seen             timestamp,
      last_seen              timestamp,
      last_updated           timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS token_metrics_last_seen_idx            ON token_metrics USING btree (last_seen)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS token_metrics_unique_traders_idx       ON token_metrics USING btree (unique_traders)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS token_metrics_quality_holder_count_idx ON token_metrics USING btree (quality_holder_count)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS token_metrics_trade_count_idx          ON token_metrics USING btree (trade_count)`);
  console.log('token_metrics table and indexes created');
  await queryClient.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
