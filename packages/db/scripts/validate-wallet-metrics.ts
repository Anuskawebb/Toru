/**
 * validate-wallet-metrics.ts
 *
 * Verifies that wallet_metrics is consistent with ground truth derived
 * directly from the trades and wallet_positions tables.
 *
 * Strategy:
 *   1. Sample N wallets from wallet_metrics at random.
 *   2. For each wallet, independently compute expected values from trades +
 *      wallet_positions via SQL. Timestamps are compared as database-formatted
 *      strings (TO_CHAR) to avoid JS Date timezone ambiguity.
 *   3. Compare field-by-field; report mismatches.
 *   4. For 5 wallets, run rebuildWallet() and verify the row is unchanged
 *      (incremental vs full-rebuild consistency).
 *
 * Read-only during the sampling phase.
 * rebuildWallet() writes the same derived values back — net-neutral.
 *
 * Run:
 *   cd packages/db
 *   tsx scripts/validate-wallet-metrics.ts [--sample=N]   (default N=30)
 */

import { db, queryClient } from '../src/client.js';
import { walletMetrics } from '../src/schema/wallet-metrics.js';
import { WalletMetricsRepository } from '../src/repositories/wallet-metrics-repository.js';
import { sql } from 'drizzle-orm';

const SAMPLE_SIZE = parseInt(
  process.argv.find((a) => a.startsWith('--sample='))?.split('=')[1] ?? '30',
  10,
) || 30;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Snapshot {
  tradeCount:           number;
  uniqueTokens:         number;
  firstSeen:            string;   // 'YYYY-MM-DDTHH24:MI:SS' from TO_CHAR
  lastSeen:             string;
  activeDays:           number;
  currentOpenPositions: number;
}

// ── SQL helpers ───────────────────────────────────────────────────────────────

/** Read the stored wallet_metrics row as a Snapshot. */
async function readStored(wallet: string): Promise<Snapshot | null> {
  const rows = await db.execute<{
    trade_count:            string;
    unique_tokens:          string;
    first_seen:             string;
    last_seen:              string;
    active_days:            string;
    current_open_positions: string;
  }>(sql`
    SELECT
      trade_count,
      unique_tokens,
      TO_CHAR(first_seen, 'YYYY-MM-DD"T"HH24:MI:SS') AS first_seen,
      TO_CHAR(last_seen,  'YYYY-MM-DD"T"HH24:MI:SS') AS last_seen,
      active_days,
      current_open_positions
    FROM wallet_metrics
    WHERE wallet = ${wallet}
    LIMIT 1
  `);
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    tradeCount:           Number(r.trade_count),
    uniqueTokens:         Number(r.unique_tokens),
    firstSeen:            r.first_seen ?? '',
    lastSeen:             r.last_seen  ?? '',
    activeDays:           Number(r.active_days),
    currentOpenPositions: Number(r.current_open_positions),
  };
}

/** Compute ground-truth Snapshot from trades + wallet_positions. */
async function computeGroundTruth(wallet: string): Promise<Snapshot | null> {
  const rows = await db.execute<{
    trade_count:            string;
    unique_tokens:          string;
    first_seen:             string;
    last_seen:              string;
    active_days:            string;
    current_open_positions: string;
  }>(sql`
    WITH trade_stats AS (
      SELECT
        COUNT(*)                          AS trade_count,
        TO_CHAR(MIN(timestamp), 'YYYY-MM-DD"T"HH24:MI:SS') AS first_seen,
        TO_CHAR(MAX(timestamp), 'YYYY-MM-DD"T"HH24:MI:SS') AS last_seen,
        COUNT(DISTINCT DATE(timestamp))   AS active_days
      FROM trades
      WHERE wallet = ${wallet}
    ),
    token_counts AS (
      SELECT COUNT(DISTINCT token) AS unique_tokens
      FROM (
        SELECT token_in_address  AS token FROM trades WHERE wallet = ${wallet}
        UNION
        SELECT token_out_address AS token FROM trades WHERE wallet = ${wallet}
      ) t
    ),
    pos_counts AS (
      SELECT COUNT(*) AS open_positions
      FROM wallet_positions
      WHERE wallet = ${wallet}
        AND net_amount::numeric > 0
    )
    SELECT
      ts.trade_count,
      tok.unique_tokens,
      ts.first_seen,
      ts.last_seen,
      ts.active_days,
      pc.open_positions AS current_open_positions
    FROM trade_stats ts
    CROSS JOIN token_counts tok
    CROSS JOIN pos_counts   pc
  `);

  if (rows.length === 0) return null;
  const r = rows[0]!;
  if (Number(r.trade_count) === 0) return null;
  return {
    tradeCount:           Number(r.trade_count),
    uniqueTokens:         Number(r.unique_tokens),
    firstSeen:            r.first_seen ?? '',
    lastSeen:             r.last_seen  ?? '',
    activeDays:           Number(r.active_days),
    currentOpenPositions: Number(r.current_open_positions),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Wallet Metrics Validation ===\n');

  const allWallets = await db
    .select({ wallet: walletMetrics.wallet })
    .from(walletMetrics);

  if (allWallets.length === 0) {
    console.log('No wallet_metrics rows — run rebuild-wallet-metrics.ts first.');
    process.exit(1);
  }

  console.log(`Total wallets in wallet_metrics: ${allWallets.length}`);
  const sampleSize = Math.min(SAMPLE_SIZE, allWallets.length);
  const shuffled   = [...allWallets].sort(() => Math.random() - 0.5);
  const sample     = shuffled.slice(0, sampleSize).map((r) => r.wallet);

  console.log(`Validating sample of ${sampleSize} wallets...\n`);

  let checked    = 0;
  let mismatches = 0;
  let missing    = 0;

  // ── Field-by-field validation ──────────────────────────────────────────

  for (const wallet of sample) {
    const [stored, gt] = await Promise.all([
      readStored(wallet),
      computeGroundTruth(wallet),
    ]);

    if (!stored || !gt) { missing++; continue; }
    checked++;

    const checks: Array<[string, number | string, number | string]> = [
      ['tradeCount',           stored.tradeCount,           gt.tradeCount],
      ['uniqueTokens',         stored.uniqueTokens,         gt.uniqueTokens],
      ['firstSeen',            stored.firstSeen,            gt.firstSeen],
      ['lastSeen',             stored.lastSeen,             gt.lastSeen],
      ['activeDays',           stored.activeDays,           gt.activeDays],
      ['currentOpenPositions', stored.currentOpenPositions, gt.currentOpenPositions],
    ];

    const fieldFails = checks.filter(([, a, b]) => a !== b);
    if (fieldFails.length > 0) {
      mismatches++;
      console.log(`  ✗ MISMATCH: wallet=${wallet.slice(0, 10)}…`);
      fieldFails.forEach(([field, got, want]) =>
        console.log(`    ${field}: stored=${got}  expected=${want}`)
      );
    }
  }

  // ── Incremental vs rebuild comparison ─────────────────────────────────
  // rebuildWallet() re-derives from source truth; result must equal what's
  // already stored (because the data hasn't changed since the last rebuild).

  console.log('\n--- Incremental vs rebuild comparison (5 wallets) ---');

  let rebuildMismatches = 0;
  const rebuildSample   = sample.slice(0, 5);

  for (const wallet of rebuildSample) {
    const before = await readStored(wallet);
    if (!before) { console.log(`  ? ${wallet.slice(0, 10)}… not found`); continue; }

    await WalletMetricsRepository.rebuildWallet(wallet);

    const after = await readStored(wallet);
    if (!after)  { console.log(`  ? ${wallet.slice(0, 10)}… disappeared`); continue; }

    const diffs = (Object.keys(before) as Array<keyof Snapshot>)
      .filter((k) => before[k] !== after[k]);

    if (diffs.length > 0) {
      rebuildMismatches++;
      console.log(`  ✗ REBUILD DRIFT: wallet=${wallet.slice(0, 10)}…`);
      diffs.forEach((k) => console.log(`    ${k}: before=${before[k]}  after=${after[k]}`));
    } else {
      console.log(`  ✓ ${wallet.slice(0, 10)}… consistent`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────

  console.log('\n─────────────────────────────────────');
  console.log('Validation Summary');
  console.log('─────────────────────────────────────');
  console.log(`  Wallets checked    : ${checked}`);
  console.log(`  Missing rows       : ${missing}`);
  console.log(`  Field mismatches   : ${mismatches}`);
  console.log(`  Rebuild drifts     : ${rebuildMismatches}`);
  console.log('─────────────────────────────────────');

  const total = mismatches + missing + rebuildMismatches;
  if (total === 0) {
    console.log('\n✓ PASS — wallet_metrics consistent with trades + positions\n');
  } else {
    console.log(`\n✗ FAIL — ${total} issue(s) found\n`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error('Validation error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await queryClient.end();
  });
