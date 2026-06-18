import { WalletMetricsRepository } from '../src/repositories/wallet-metrics-repository.js';
import { queryClient } from '../src/client.js';

async function main() {
  console.log('Rebuilding all wallet metrics from trades + positions...');
  const t0 = Date.now();
  await WalletMetricsRepository.rebuildAll();
  const elapsed = Date.now() - t0;

  const { db } = await import('../src/client.js');
  const { sql } = await import('drizzle-orm');
  const result = await db.execute(sql`
    SELECT
      COUNT(*)                   AS wallets,
      SUM(trade_count)           AS total_trades,
      MAX(trade_count)           AS max_trades,
      AVG(trade_count)::numeric(10,1) AS avg_trades,
      SUM(unique_tokens)         AS total_unique_tokens,
      MAX(unique_tokens)         AS max_unique_tokens,
      SUM(current_open_positions) AS total_open_positions
    FROM wallet_metrics
  `);
  console.log(`Done in ${elapsed}ms`);
  console.log('Summary:', JSON.stringify(result[0], null, 2));
  await queryClient.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
