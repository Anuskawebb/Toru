import { WalletScoresRepository } from '../src/repositories/wallet-scores-repository.js';
import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Rebuilding wallet scores from wallet_metrics...');
  const t0 = Date.now();
  await WalletScoresRepository.rebuildAll();
  const elapsed = Date.now() - t0;

  const summary = await db.execute(sql`
    SELECT
      COUNT(*)                        AS total_wallets,
      COUNT(*) FILTER (WHERE classification = 'bot')         AS bots,
      COUNT(*) FILTER (WHERE classification = 'degen')       AS degens,
      COUNT(*) FILTER (WHERE classification = 'accumulator') AS accumulators,
      COUNT(*) FILTER (WHERE classification = 'scout')       AS scouts,
      COUNT(*) FILTER (WHERE classification = 'flipper')     AS flippers,
      COUNT(*) FILTER (WHERE classification = 'retail')      AS retail,
      COUNT(*) FILTER (WHERE classification = 'unknown')     AS unknown,
      ROUND(AVG(rank_score::numeric), 2)                     AS avg_rank_score,
      ROUND(MAX(rank_score::numeric), 2)                     AS max_rank_score
    FROM wallet_scores
  `);

  const top5 = await db.execute(sql`
    SELECT wallet, rank_position, rank_score, classification,
           trade_count, unique_tokens, current_open_positions
    FROM wallet_scores ORDER BY rank_position LIMIT 5
  `);

  console.log(`Done in ${elapsed}ms`);
  console.log('Summary:', JSON.stringify(summary[0], null, 2));
  console.log('Top 5 ranked:', JSON.stringify(top5, null, 2));
  await queryClient.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
