import 'dotenv/config';
import {
  db,
  queryClient,
  WalletMetricsRepository,
  WalletScoresRepository,
  TokenMetricsRepository,
  SmartMoneySignalsRepository,
  analyticsRuns,
  sql,
  eq,
} from '@toro/db';

const POLL_INTERVAL_MS = 60 * 1000; // 60 seconds

let isCycleRunning = false;

async function runCycle() {
  if (isCycleRunning) {
    console.log('Skipping cycle: previous run is still executing.');
    return;
  }
  isCycleRunning = true;

  console.log(`\n--- Starting Analytics Cycle at ${new Date().toISOString()} ---`);
  const startedAt = new Date();

  // Insert 'running' record
  const [runRecord] = await db.insert(analyticsRuns).values({
    startedAt,
    status: 'running',
  }).returning({ id: analyticsRuns.id });

  const runId = runRecord.id;

  try {
    const t0 = Date.now();

    // 1. Wallet Metrics
    console.log('Rebuilding Wallet Metrics...');
    await WalletMetricsRepository.rebuildAll();

    // 2. Wallet Scores
    console.log('Rebuilding Wallet Scores...');
    await WalletScoresRepository.rebuildAll();

    // 3. Token Metrics
    console.log('Rebuilding Token Metrics...');
    await TokenMetricsRepository.rebuildAll();

    // 4. Smart Money Signals
    console.log('Rebuilding Smart Money Signals...');
    await SmartMoneySignalsRepository.rebuildAll();

    const durationMs = Date.now() - t0;
    const finishedAt = new Date();

    // Get metrics to update the run record
    const [counts] = await db.execute<{
      wallets: string;
      tokens: string;
      signals: string;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM wallet_metrics) AS wallets,
        (SELECT COUNT(*) FROM token_metrics) AS tokens,
        (SELECT COUNT(*) FROM smart_money_signals) AS signals
    `);

    await db.update(analyticsRuns).set({
      finishedAt,
      durationMs,
      walletsProcessed: Number(counts?.wallets || 0),
      tokensProcessed: Number(counts?.tokens || 0),
      signalsGenerated: Number(counts?.signals || 0),
      recommendationsGenerated: 0,
      status: 'completed',
    }).where(eq(analyticsRuns.id, runId));

    console.log(`Cycle completed in ${durationMs}ms`);
    console.log(`Stats: ${counts?.wallets} wallets, ${counts?.tokens} tokens, ${counts?.signals} signals`);
    isCycleRunning = false;
  } catch (error: any) {
    console.error('Cycle failed:', error);
    await db.update(analyticsRuns).set({
      finishedAt: new Date(),
      status: 'failed',
      error: error.message || String(error),
    }).where(eq(analyticsRuns.id, runId));
    isCycleRunning = false;
  }
}

async function main() {
  console.log('Starting Toru Analytics Worker...');
  console.log(`Polling interval: ${POLL_INTERVAL_MS / 1000} seconds`);

  // Run immediately on startup
  await runCycle();

  // Schedule subsequent runs
  setInterval(() => {
    runCycle().catch(e => console.error('Error triggering cycle:', e));
  }, POLL_INTERVAL_MS);

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await queryClient.end();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await queryClient.end();
    process.exit(0);
  });
}

main().catch(console.error);
