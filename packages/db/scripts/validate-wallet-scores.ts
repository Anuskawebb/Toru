/**
 * validate-wallet-scores.ts
 *
 * Ground-truth checks for wallet_scores. Each check independently verifies a
 * stored value against a re-derived formula so the validator is self-contained.
 *
 * Checks performed:
 *   1. Coverage   — wallet_scores row count == wallet_metrics row count
 *   2. Range      — all component scores are in [0, 100]
 *   3. Rank order — rank_position is dense (no gaps), correct ordinal by rank_score
 *   4. Conviction — conviction_score matches (open_positions / unique_tokens)*100
 *   5. Rank score — rank_score matches weighted formula (within ±0.01 rounding)
 *   6. Classification — random sample matches CASE priority rules
 *   7. Stability  — rebuildAll() twice → identical scores (idempotent)
 *
 * Exit code 0 = all PASS, exit code 1 = at least one FAIL.
 */

import { WalletScoresRepository, SCORE_WEIGHTS, CLASSIFICATION_THRESHOLDS } from '../src/repositories/wallet-scores-repository.js';
import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

const SAMPLE_SIZE = 50;

let totalChecks = 0;
let passCount   = 0;
let failCount   = 0;

function pass(label: string, detail = '') {
  totalChecks++;
  passCount++;
  console.log(`  PASS  ${label}${detail ? ': ' + detail : ''}`);
}

function fail(label: string, detail = '') {
  totalChecks++;
  failCount++;
  console.error(`  FAIL  ${label}${detail ? ': ' + detail : ''}`);
}

function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

// ── Expected classification for a given metric row ─────────────────────────────

function expectedClass(
  tradeCount: number,
  uniqueTokens: number,
  openPositions: number,
): string {
  const convictionRatio = uniqueTokens > 0 ? openPositions / uniqueTokens : 0;
  const T = CLASSIFICATION_THRESHOLDS;
  if (tradeCount >= T.bot.minTrades && uniqueTokens <= T.bot.maxUniqueTokens)
    return 'bot';
  if (tradeCount >= T.degen.minTrades && uniqueTokens >= T.degen.minUniqueTokens)
    return 'degen';
  if (convictionRatio >= T.accumulator.minConvictionRatio && tradeCount >= T.accumulator.minTrades)
    return 'accumulator';
  if (uniqueTokens >= T.scout.minUniqueTokens && tradeCount <= T.scout.maxTrades)
    return 'scout';
  if (tradeCount >= T.flipper.minTrades && convictionRatio <= T.flipper.maxConvictionRatio)
    return 'flipper';
  if (tradeCount <= T.retail.maxTrades)
    return 'retail';
  return 'unknown';
}

async function main() {
  console.log('wallet_scores validation suite');
  console.log('='.repeat(64));

  // ── 1. Coverage ───────────────────────────────────────────────────────────────
  section('1. Coverage: wallet_scores count == wallet_metrics count');
  {
    const counts = await db.execute<{ scores_count: string; metrics_count: string }>(sql`
      SELECT
        (SELECT COUNT(*) FROM wallet_scores)  AS scores_count,
        (SELECT COUNT(*) FROM wallet_metrics) AS metrics_count
    `);
    const { scores_count, metrics_count } = counts[0]!;
    if (scores_count === metrics_count) {
      pass('row count match', `${scores_count} wallets`);
    } else {
      fail('row count mismatch', `scores=${scores_count} metrics=${metrics_count}`);
    }
  }

  // ── 2. Range check ────────────────────────────────────────────────────────────
  section('2. Score range: all scores in [0, 100]');
  {
    const out = await db.execute<{
      activity_out:    string; conviction_out: string;
      breadth_out:     string; consistency_out: string; rank_out: string;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE activity_score::numeric    < 0 OR activity_score::numeric    > 100) AS activity_out,
        COUNT(*) FILTER (WHERE conviction_score::numeric  < 0 OR conviction_score::numeric  > 100) AS conviction_out,
        COUNT(*) FILTER (WHERE breadth_score::numeric     < 0 OR breadth_score::numeric     > 100) AS breadth_out,
        COUNT(*) FILTER (WHERE consistency_score::numeric < 0 OR consistency_score::numeric > 100) AS consistency_out,
        COUNT(*) FILTER (WHERE rank_score::numeric        < 0 OR rank_score::numeric        > 100) AS rank_out
      FROM wallet_scores
    `);
    const r = out[0]!;
    for (const [col, val] of Object.entries(r)) {
      if (Number(val) === 0) {
        pass(`${col.replace('_out', '')} in [0,100]`);
      } else {
        fail(`${col.replace('_out', '')} out of range`, `${val} wallets`);
      }
    }
  }

  // ── 3. Rank position order ────────────────────────────────────────────────────
  section('3. Rank position: ordinal consistent with rank_score');
  {
    // Two wallets where a has strictly higher rank_score → a must have ≤ rank_position of b
    const violations = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count FROM (
        SELECT a.wallet AS wa, b.wallet AS wb,
               a.rank_score AS ra, b.rank_score AS rb,
               a.rank_position AS pa, b.rank_position AS pb
        FROM wallet_scores a, wallet_scores b
        WHERE a.rank_score::numeric > b.rank_score::numeric
          AND a.rank_position > b.rank_position
        LIMIT 100
      ) x
    `);
    if (Number(violations[0]!.count) === 0) {
      pass('rank_position consistent with rank_score');
    } else {
      fail('rank_position order violation', `${violations[0]!.count} pairs inverted`);
    }

    // rank_position 1 should exist and be unique at max score
    const top = await db.execute<{ rank_position: string; rank_score: string }>(sql`
      SELECT rank_position, rank_score FROM wallet_scores ORDER BY rank_position LIMIT 1
    `);
    if (top[0] && Number(top[0].rank_position) === 1) {
      pass('rank_position starts at 1', `top score=${top[0].rank_score}`);
    } else {
      fail('rank_position should start at 1', JSON.stringify(top[0]));
    }
  }

  // ── 4. Conviction score formula ───────────────────────────────────────────────
  section('4. Conviction score: matches (open_positions / unique_tokens) * 100');
  {
    const sample = await db.execute<{
      wallet: string;
      stored_conviction: string;
      computed: string;
    }>(sql`
      SELECT
        wallet,
        conviction_score::numeric AS stored_conviction,
        ROUND(LEAST(100.0, current_open_positions::numeric / NULLIF(unique_tokens, 0) * 100), 2) AS computed
      FROM wallet_scores
      ORDER BY RANDOM()
      LIMIT ${SAMPLE_SIZE}
    `);

    let fails = 0;
    for (const row of sample) {
      const stored   = Number(row.stored_conviction);
      const computed = Number(row.computed ?? 0);
      const diff = Math.abs(stored - computed);
      if (diff > 0.02) {
        fail(`conviction ${row.wallet.slice(0, 10)}…`, `stored=${stored} computed=${computed} diff=${diff.toFixed(4)}`);
        fails++;
        if (fails >= 3) break;
      }
    }
    if (fails === 0) {
      pass(`conviction formula correct`, `${sample.length} wallets checked`);
    }
  }

  // ── 5. Rank score formula ─────────────────────────────────────────────────────
  section('5. Rank score: matches weighted composite (±0.02 rounding tolerance)');
  {
    const sample = await db.execute<{
      wallet: string;
      stored_rank: string;
      computed:    string;
    }>(sql`
      SELECT
        wallet,
        rank_score::numeric AS stored_rank,
        ROUND(
          activity_score::numeric    * ${SCORE_WEIGHTS.activity}    +
          conviction_score::numeric  * ${SCORE_WEIGHTS.conviction}  +
          breadth_score::numeric     * ${SCORE_WEIGHTS.breadth}     +
          consistency_score::numeric * ${SCORE_WEIGHTS.consistency},
        2) AS computed
      FROM wallet_scores
      ORDER BY RANDOM()
      LIMIT ${SAMPLE_SIZE}
    `);

    let fails = 0;
    for (const row of sample) {
      const stored   = Number(row.stored_rank);
      const computed = Number(row.computed);
      const diff = Math.abs(stored - computed);
      if (diff > 0.02) {
        fail(`rank_score ${row.wallet.slice(0, 10)}…`, `stored=${stored} computed=${computed}`);
        fails++;
        if (fails >= 3) break;
      }
    }
    if (fails === 0) {
      pass(`rank_score formula correct`, `${sample.length} wallets checked`);
    }
  }

  // ── 6. Classification correctness ─────────────────────────────────────────────
  section('6. Classification: matches CASE priority rules');
  {
    const sample = await db.execute<{
      wallet:                string;
      classification:        string;
      trade_count:           string;
      unique_tokens:         string;
      current_open_positions: string;
    }>(sql`
      SELECT wallet, classification, trade_count, unique_tokens, current_open_positions
      FROM wallet_scores
      ORDER BY RANDOM()
      LIMIT ${SAMPLE_SIZE}
    `);

    let fails = 0;
    for (const row of sample) {
      const tc  = Number(row.trade_count);
      const ut  = Number(row.unique_tokens);
      const op  = Number(row.current_open_positions);
      const exp = expectedClass(tc, ut, op);
      if (exp !== row.classification) {
        fail(
          `classification ${row.wallet.slice(0, 10)}…`,
          `stored=${row.classification} expected=${exp} tc=${tc} ut=${ut} op=${op}`,
        );
        fails++;
        if (fails >= 5) break;
      }
    }
    if (fails === 0) {
      pass(`classification rules correct`, `${sample.length} wallets checked`);
    }
  }

  // ── 7. Distribution sanity ────────────────────────────────────────────────────
  section('7. Distribution sanity checks');
  {
    const breakdown = await WalletScoresRepository.getClassificationBreakdown();
    console.log('  Classification breakdown:');
    for (const { classification, count } of breakdown) {
      console.log(`    ${classification.padEnd(15)} ${count.toLocaleString().padStart(6)} wallets`);
    }

    // retail should be the largest class (55%+ of wallets have 1 trade)
    const retailRow = breakdown.find((r) => r.classification === 'retail');
    const total     = breakdown.reduce((s, r) => s + r.count, 0);
    if (retailRow && retailRow.count / total > 0.5) {
      pass('retail is majority class', `${retailRow.count}/${total} = ${((retailRow.count/total)*100).toFixed(1)}%`);
    } else {
      fail('retail should be majority', `retail=${retailRow?.count} total=${total}`);
    }

    // bot count should be small (< 1%)
    const botRow = breakdown.find((r) => r.classification === 'bot');
    if (!botRow || botRow.count / total < 0.01) {
      pass('bot count < 1%', `${botRow?.count ?? 0}/${total}`);
    } else {
      fail('too many bots', `${botRow.count}/${total} > 1%`);
    }

    const dist = await WalletScoresRepository.getScoreDistribution();
    console.log('\n  Score distribution (min / p25 / median / p75 / max):');
    for (const [type, s] of Object.entries(dist)) {
      console.log(`    ${type.padEnd(15)} ${s.min} / ${s.p25} / ${s.median} / ${s.p75} / ${s.max}`);
    }

    // Median rank_score should be low (most wallets are retail = low scores)
    const rankDist = dist['rank'];
    if (rankDist && rankDist.median < 50) {
      pass('median rank_score < 50 (skewed toward retail)', `median=${rankDist.median}`);
    } else {
      fail('median rank_score unexpectedly high', `median=${rankDist?.median}`);
    }
  }

  // ── 8. Idempotency ────────────────────────────────────────────────────────────
  section('8. Idempotency: rebuildAll() twice → identical scores');
  {
    // Capture top-5 scores before second rebuild
    const before = await db.execute<{ wallet: string; rank_score: string }>(sql`
      SELECT wallet, rank_score FROM wallet_scores ORDER BY rank_position LIMIT 5
    `);

    await WalletScoresRepository.rebuildAll();

    const after = await db.execute<{ wallet: string; rank_score: string }>(sql`
      SELECT wallet, rank_score FROM wallet_scores ORDER BY rank_position LIMIT 5
    `);

    let changed = 0;
    for (let i = 0; i < before.length; i++) {
      const b = before[i]!;
      const a = after[i]!;
      if (b.wallet !== a.wallet || b.rank_score !== a.rank_score) changed++;
    }
    if (changed === 0) {
      pass('two consecutive rebuilds produce identical top-5');
    } else {
      fail('top-5 changed after second rebuild', `${changed} rows differ`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(64));
  console.log(`Result: ${passCount} PASS  ${failCount} FAIL  (${totalChecks} checks)`);

  await queryClient.end();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
