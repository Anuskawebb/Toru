import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  const tables = [
    'trades',
    'wallet_positions',
    'wallet_metrics',
    'wallet_scores',
    'token_metrics',
    'smart_money_signals',
    'token_prices'
  ];
  for (const table of tables) {
    try {
      const res = await db.execute(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`));
      console.log(`${table}: ${(res[0] as any).n}`);
    } catch (e: any) {
      console.log(`${table}: Error ${e.message}`);
    }
  }
  await queryClient.end();
}
main().catch(console.error);
