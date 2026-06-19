import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('Resetting database tables...');
  
  // Drop all old prisma tables and drizzle schemas
  await db.execute(sql`
    -- Drop old prisma tables
    DROP TABLE IF EXISTS vaults CASCADE;
    DROP TABLE IF EXISTS user_vaults CASCADE;
    DROP TABLE IF EXISTS positions CASCADE;
    DROP TABLE IF EXISTS follows CASCADE;
    DROP TABLE IF EXISTS leader_swaps CASCADE;
    DROP TABLE IF EXISTS notifications CASCADE;
    DROP TABLE IF EXISTS follower_profiles CASCADE;
    DROP TABLE IF EXISTS paper_trades CASCADE;
    DROP TABLE IF EXISTS token_prices CASCADE;
    DROP TABLE IF EXISTS trade_explanations CASCADE;
    DROP TABLE IF EXISTS _prisma_migrations CASCADE;

    -- Drop drizzle tables and schemas
    DROP TABLE IF EXISTS trades CASCADE;
    DROP TABLE IF EXISTS tokens CASCADE;
    DROP TABLE IF EXISTS indexer_state CASCADE;
    DROP TABLE IF EXISTS token_discovery_queue CASCADE;
    DROP TABLE IF EXISTS wallet_positions CASCADE;
    DROP TABLE IF EXISTS wallet_metrics CASCADE;
    DROP TABLE IF EXISTS wallet_scores CASCADE;
    DROP TABLE IF EXISTS token_metrics CASCADE;
    DROP TABLE IF EXISTS smart_money_signals CASCADE;
    DROP TABLE IF EXISTS token_intel_snapshots CASCADE;
    DROP TABLE IF EXISTS price_observations CASCADE;
    DROP TABLE IF EXISTS token_prices CASCADE;
    DROP TABLE IF EXISTS portfolio_snapshots CASCADE;
    DROP TABLE IF EXISTS portfolio_state CASCADE;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
  `);
  
  console.log('Tables dropped successfully.');

  console.log('Re-running migrations...');
  const migrationsFolder = path.resolve(__dirname, '../drizzle');
  await migrate(db, { migrationsFolder });
  
  console.log('Database successfully reset and aligned with schema.');
  await queryClient.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Database reset failed:', err);
  process.exit(1);
});
