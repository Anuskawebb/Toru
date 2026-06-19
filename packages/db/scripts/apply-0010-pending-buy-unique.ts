import { db, queryClient, sql } from '../src/client.js';

async function main() {
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS "trade_recs_pending_buy_unique"
      ON "trade_recommendations" ("agent_wallet", "token_address")
      WHERE action = 'BUY' AND status = 'PENDING'
  `));
  console.log('Migration 0010: trade_recs_pending_buy_unique index applied.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => queryClient.end());
