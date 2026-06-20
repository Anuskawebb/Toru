import 'dotenv/config';
import {
  db,
  queryClient,
  WalletMetricsRepository,
  WalletScoresRepository,
  TokenMetricsRepository,
  SmartMoneySignalsRepository,
  smartMoneySignals,
  analyticsRuns,
  sql,
  eq,
  inArray,
} from '@toro/db';
import { getFearAndGreed, getTrendingSymbols } from './cmc-client.js';

const POLL_INTERVAL_MS = 60 * 1000; // 60 seconds

let isCycleRunning = false;

// Latest CMC sentiment — written every cycle, read by agent runner via /api/cmc/sentiment
export let latestFearAndGreed: { value: number; classification: string; updatedAt: string } | null = null;

/**
 * Applies a CMC boost to signals whose token symbol appears in the CMC trending list.
 * Boost: +10% on accumulation_score, capped at 100.
 * Also logs the current Fear & Greed index.
 */
async function applyCmcBoost(): Promise<void> {
  if (!process.env.CMC_API_KEY) return;

  try {
    // Fear & Greed — log sentiment for observability
    const fg = await getFearAndGreed();
    if (fg) {
      latestFearAndGreed = { value: fg.value, classification: fg.classification, updatedAt: fg.updatedAt.toISOString() };
      console.log(`[cmc] Fear & Greed: ${fg.value} — ${fg.classification}`);
    }

    // Trending tokens — boost accumulation_score for tokens we track that CMC is trending
    const trendingSymbols = await getTrendingSymbols();
    if (trendingSymbols.size === 0) return;

    // Fetch all signals and find the ones that are CMC trending
    const topSignals = await SmartMoneySignalsRepository.getTopSignals({ limit: 200, minScore: 0 });
    const trendingAddresses = topSignals
      .filter(s => trendingSymbols.has(s.tokenSymbol.toUpperCase()))
      .map(s => s.tokenAddress);

    if (trendingAddresses.length === 0) {
      console.log('[cmc] No overlap between CMC trending and our signals this cycle');
      return;
    }

    const trendingSymbolNames = topSignals
      .filter(s => trendingAddresses.includes(s.tokenAddress))
      .map(s => s.tokenSymbol);

    console.log(`[cmc] Boosting ${trendingAddresses.length} CMC-trending signal(s): ${trendingSymbolNames.join(', ')}`);

    // Apply +10% boost to accumulation_score, capped at 100
    await db.update(smartMoneySignals)
      .set({
        accumulationScore: sql`LEAST(100, CAST(accumulation_score AS numeric) * 1.10)`,
        computedAt: new Date(),
      })
      .where(inArray(smartMoneySignals.tokenAddress, trendingAddresses));

  } catch (e) {
    // CMC boost is non-critical — never fail the main analytics cycle
    console.warn('[cmc] Boost step failed (non-fatal):', e instanceof Error ? e.message : e);
  }
}

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

    // 5. CMC Signal Boost — cross-reference our signals with CMC trending + Fear & Greed
    await applyCmcBoost();

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
