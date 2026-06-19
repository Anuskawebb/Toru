import { TokenMetricsRepository } from '../src/repositories/token-metrics-repository.js';
import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Rebuilding token metrics from trades + wallet_positions + wallet_scores...');
  const t0 = Date.now();
  await TokenMetricsRepository.rebuildAll();
  const elapsed = Date.now() - t0;

  const summary = await db.execute<{
    total_tokens: string;
    avg_trade_count: string;
    max_trade_count: string;
    avg_unique_traders: string;
    max_unique_traders: string;
    tokens_with_quality_holders: string;
    max_quality_holders: string;
    total_quality_holder_slots: string;
  }>(sql`
    SELECT
      COUNT(*)                               AS total_tokens,
      ROUND(AVG(trade_count), 1)             AS avg_trade_count,
      MAX(trade_count)                       AS max_trade_count,
      ROUND(AVG(unique_traders), 1)          AS avg_unique_traders,
      MAX(unique_traders)                    AS max_unique_traders,
      COUNT(*) FILTER (WHERE quality_holder_count > 0) AS tokens_with_quality_holders,
      MAX(quality_holder_count)              AS max_quality_holders,
      SUM(quality_holder_count)              AS total_quality_holder_slots
    FROM token_metrics
  `);
  console.log(`Done in ${elapsed}ms`);
  console.log('Summary:', JSON.stringify(summary[0], null, 2));

  const top5ByQuality = await db.execute(sql`
    SELECT token_address, token_symbol, trade_count, unique_traders,
           holder_count, quality_holder_count, net_holders
    FROM token_metrics
    ORDER BY quality_holder_count DESC
    LIMIT 5
  `);
  console.log('\nTop 5 by quality_holder_count:', JSON.stringify(top5ByQuality, null, 2));

  const top5ByTraders = await db.execute(sql`
    SELECT token_address, token_symbol, trade_count, unique_traders,
           holder_count, quality_holder_count
    FROM token_metrics
    ORDER BY unique_traders DESC
    LIMIT 5
  `);
  console.log('\nTop 5 by unique_traders:', JSON.stringify(top5ByTraders, null, 2));

  await queryClient.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
