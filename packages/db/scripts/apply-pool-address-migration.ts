// Apply source_pool_address migration using the standard @aether/db client
// which loads the correct DATABASE_URL via the multi-path dotenv chain.
import { db } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function run() {
  await db.execute(sql`ALTER TABLE price_observations ADD COLUMN IF NOT EXISTS source_pool_address varchar(42)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS price_observations_source_pool_address_idx ON price_observations USING btree (source_pool_address)`);
  console.log('source_pool_address column and index applied successfully.');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
