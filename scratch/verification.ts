import {
  db,
  queryClient,
  analyticsRuns,
  walletScores,
  tokenMetrics,
  smartMoneySignals,
  indexerState,
  sql,
} from '../packages/db/src/client.js';

async function verify() {
  console.log("=== Phase 8A.5 Live Verification ===\n");

  // Step 1 & 2: Analytics Runs
  console.log("1. Analytics Run Stability:");
  const runs = await db.execute<{
    id: string;
    started_at: string;
    finished_at: string;
    duration_ms: number;
    status: string;
  }>(sql`
    SELECT id, started_at, finished_at, duration_ms, status
    FROM analytics_runs
    ORDER BY started_at DESC
    LIMIT 10;
  `);
  
  runs.forEach(r => {
    console.log(`Run #${r.id} | Started: ${new Date(r.started_at).toISOString()} | Finished: ${r.finished_at ? new Date(r.finished_at).toISOString() : 'N/A'} | Duration: ${r.duration_ms}ms | Status: ${r.status}`);
  });

  // Step 3: Signal Freshness
  const [signalFreshness] = await db.execute<{ max_time: string }>(sql`
    SELECT MAX(computed_at) as max_time FROM smart_money_signals;
  `);
  const maxSignalTime = new Date(signalFreshness.max_time).getTime();
  const lagMs = Date.now() - maxSignalTime;
  console.log(`\n3. Signal Freshness:`);
  console.log(`Latest computed_at: ${new Date(maxSignalTime).toISOString()}`);
  console.log(`Lag: ${Math.round(lagMs / 1000)} seconds`);

  // Step 4: Wallet Score Freshness
  const [walletFreshness] = await db.execute<{ max_time: string }>(sql`
    SELECT MAX(computed_at) as max_time FROM wallet_scores;
  `);
  console.log(`\n4. Wallet Score Freshness:`);
  console.log(`Latest computed_at: ${new Date(walletFreshness.max_time).toISOString()}`);

  // Step 5: Token Metrics Freshness
  const [tokenFreshness] = await db.execute<{ max_time: string }>(sql`
    SELECT MAX(computed_at) as max_time FROM token_metrics;
  `);
  console.log(`\n5. Token Metrics Freshness:`);
  console.log(`Latest computed_at: ${new Date(tokenFreshness.max_time).toISOString()}`);

  // Step 8: Indexer Health
  const [indexer] = await db.execute<{ last_block: number, last_time: string }>(sql`
    SELECT last_processed_block as last_block, updated_at as last_time FROM indexer_state WHERE chain = 'bsc' LIMIT 1;
  `);
  console.log(`\n8. Indexer Health:`);
  console.log(`Latest Indexed Block: ${indexer?.last_block}`);
  console.log(`Latest Indexed Time: ${indexer?.last_time ? new Date(indexer.last_time).toISOString() : 'N/A'}`);

  await queryClient.end();
}

verify().catch(console.error);
