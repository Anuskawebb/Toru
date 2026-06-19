import { db, queryClient, sql } from '../src/client.js';

async function main() {
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS "agent_positions_open_unique"
      ON "agent_positions" ("agent_wallet", "token_address")
      WHERE status = 'OPEN'
  `));
  console.log('Migration 0009: agent_positions_open_unique index applied.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => queryClient.end());
