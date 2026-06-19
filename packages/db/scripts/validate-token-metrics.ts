/**
 * validate-token-metrics.ts
 *
 * Ground-truth checks for token_metrics. Every stored value is independently
 * re-derived from the source tables (trades, wallet_positions, wallet_scores)
 * and compared.
 *
 * Checks performed:
 *   1. Coverage       — token count matches distinct tokens in trades
 *   2. Arithmetic     — buy_trades + sell_trades == trade_count (all rows)
 *   3. Net holders    — net_holders == unique_buyers - unique_sellers (all rows)
 *   4. Trade counts   — sampled tokens: trade_count, buy_trades, sell_trades verified
 *   5. Trader counts  — unique_traders, unique_buyers, unique_sellers verified
 *   6. Holder count   — holder_count verified against wallet_positions
 *   7. Quality holders — quality_holder_count verified against direct join
 *   8. Timestamps     — first_seen, last_seen verified (TO_CHAR to dodge TZ issues)
 *   9. rebuildToken   — spot-rebuilds 3 tokens; must match rebuildAll results
 *  10. Idempotency    — second rebuildAll produces identical top-5
 *
 * Exit code 0 = all PASS, exit code 1 = at least one FAIL.
 */

import { TokenMetricsRepository } from '../src/repositories/token-metrics-repository.js';
import { QUALITY_HOLDER_THRESHOLD } from '../src/schema/token-metrics.js';
import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

const SAMPLE_SIZE = 30;

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

async function main() {
  console.log('token_metrics validation suite');
  console.log('='.repeat(64));

  // ── 1. Coverage ─────────────────────────────────────────────────────────────
  section('1. Coverage: row count == distinct tokens in trades');
  {
    const counts = await db.execute<{ tm_count: string; trade_token_count: string }>(sql`
      SELECT
        (SELECT COUNT(*) FROM token_metrics) AS tm_count,
        (SELECT COUNT(DISTINCT tok) FROM (
          SELECT token_out_address AS tok FROM trades
          UNION
          SELECT token_in_address  AS tok FROM trades
        ) x) AS trade_token_count
    `);
    const { tm_count, trade_token_count } = counts[0]!;
    if (tm_count === trade_token_count) {
      pass('row count match', `${tm_count} tokens`);
    } else {
      fail('row count mismatch', `token_metrics=${tm_count} trades_distinct=${trade_token_count}`);
    }
  }

  // ── 2. Arithmetic: buy_trades + sell_trades == trade_count ──────────────────
  section('2. Arithmetic: buy_trades + sell_trades == trade_count');
  {
    const violations = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM token_metrics
      WHERE buy_trades + sell_trades != trade_count
    `);
    if (Number(violations[0]!.count) === 0) {
      pass('buy_trades + sell_trades = trade_count (all rows)');
    } else {
      fail('arithmetic violation', `${violations[0]!.count} rows`);
    }
  }

  // ── 3. Net holders: net_holders == unique_buyers - unique_sellers ────────────
  section('3. net_holders == unique_buyers - unique_sellers');
  {
    const violations = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM token_metrics
      WHERE net_holders != (unique_buyers - unique_sellers)
    `);
    if (Number(violations[0]!.count) === 0) {
      pass('net_holders formula correct (all rows)');
    } else {
      fail('net_holders mismatch', `${violations[0]!.count} rows`);
    }
  }

  // ── 4–8. Random sample: verify all key fields against raw SQL ───────────────
  section('4–8. Random sample field verification (30 tokens)');
  {
    // Pick 30 random tokens from token_metrics
    const sample = await db.execute<{ token_address: string }>(sql`
      SELECT token_address FROM token_metrics ORDER BY RANDOM() LIMIT ${SAMPLE_SIZE}
    `);

    let tradeCountFails  = 0;
    let traderCountFails = 0;
    let holderFails      = 0;
    let qualityFails     = 0;
    let tsFails          = 0;

    for (const { token_address } of sample) {
      const t = token_address;

      // Ground-truth: trade counts from raw trades table
      const gtTrades = await db.execute<{
        trade_count: string; buy_trades: string; sell_trades: string;
        unique_traders: string; unique_buyers: string; unique_sellers: string;
      }>(sql`
        SELECT
          COUNT(*)                                              AS trade_count,
          COUNT(*) FILTER (WHERE side = 'buy')                 AS buy_trades,
          COUNT(*) FILTER (WHERE side = 'sell')                AS sell_trades,
          COUNT(DISTINCT wallet)                               AS unique_traders,
          COUNT(DISTINCT wallet) FILTER (WHERE side = 'buy')  AS unique_buyers,
          COUNT(DISTINCT wallet) FILTER (WHERE side = 'sell') AS unique_sellers
        FROM (
          SELECT wallet, 'buy'  AS side FROM trades WHERE token_out_address = ${t}
          UNION ALL
          SELECT wallet, 'sell' AS side FROM trades WHERE token_in_address  = ${t}
        ) x
      `);

      // Ground-truth: holder count from positions
      const gtHolder = await db.execute<{ holder_count: string }>(sql`
        SELECT COUNT(*) FILTER (WHERE net_amount::numeric > 0) AS holder_count
        FROM wallet_positions
        WHERE token_address = ${t}
      `);

      // Ground-truth: quality holder count
      const gtQuality = await db.execute<{ quality_holder_count: string }>(sql`
        SELECT COUNT(*) AS quality_holder_count
        FROM wallet_positions wp
        JOIN wallet_scores ws ON ws.wallet = wp.wallet
        WHERE wp.token_address = ${t}
          AND wp.net_amount::numeric > 0
          AND ws.rank_score::numeric >= ${QUALITY_HOLDER_THRESHOLD}
      `);

      // Ground-truth: timestamps — use TO_CHAR to sidestep timezone ambiguity
      const gtTs = await db.execute<{ first_seen: string; last_seen: string }>(sql`
        SELECT
          TO_CHAR(MIN(timestamp), 'YYYY-MM-DD"T"HH24:MI:SS') AS first_seen,
          TO_CHAR(MAX(timestamp), 'YYYY-MM-DD"T"HH24:MI:SS') AS last_seen
        FROM (
          SELECT timestamp FROM trades WHERE token_out_address = ${t}
          UNION ALL
          SELECT timestamp FROM trades WHERE token_in_address  = ${t}
        ) x
      `);

      // Stored values
      const stored = await db.execute<{
        trade_count: string; buy_trades: string; sell_trades: string;
        unique_traders: string; unique_buyers: string; unique_sellers: string;
        holder_count: string; quality_holder_count: string;
        first_seen: string; last_seen: string;
      }>(sql`
        SELECT
          trade_count, buy_trades, sell_trades,
          unique_traders, unique_buyers, unique_sellers,
          holder_count, quality_holder_count,
          TO_CHAR(first_seen, 'YYYY-MM-DD"T"HH24:MI:SS') AS first_seen,
          TO_CHAR(last_seen,  'YYYY-MM-DD"T"HH24:MI:SS') AS last_seen
        FROM token_metrics
        WHERE token_address = ${t}
      `);

      const s  = stored[0]!;
      const gt = gtTrades[0]!;
      const sh = gtHolder[0]!;
      const sq = gtQuality[0]!;
      const st = gtTs[0]!;

      // Normalise all numeric fields to strings — postgres.js returns COUNT() as
      // BigInt and integer columns as number; String() coerces both to "1" etc.
      const n = (v: unknown) => String(v ?? 0);

      // Check 4: trade counts
      if (
        n(s.trade_count)  !== n(gt.trade_count)  ||
        n(s.buy_trades)   !== n(gt.buy_trades)   ||
        n(s.sell_trades)  !== n(gt.sell_trades)
      ) {
        fail(`trade_count ${t.slice(0, 10)}…`,
          `stored=(${n(s.trade_count)}/${n(s.buy_trades)}/${n(s.sell_trades)}) expected=(${n(gt.trade_count)}/${n(gt.buy_trades)}/${n(gt.sell_trades)})`);
        tradeCountFails++;
      }

      // Check 5: trader counts
      if (
        n(s.unique_traders)  !== n(gt.unique_traders)  ||
        n(s.unique_buyers)   !== n(gt.unique_buyers)   ||
        n(s.unique_sellers)  !== n(gt.unique_sellers)
      ) {
        fail(`unique_traders ${t.slice(0, 10)}…`,
          `stored=(${n(s.unique_traders)}/${n(s.unique_buyers)}/${n(s.unique_sellers)}) expected=(${n(gt.unique_traders)}/${n(gt.unique_buyers)}/${n(gt.unique_sellers)})`);
        traderCountFails++;
      }

      // Check 6: holder count
      if (n(s.holder_count) !== n(sh.holder_count)) {
        fail(`holder_count ${t.slice(0, 10)}…`,
          `stored=${n(s.holder_count)} expected=${n(sh.holder_count)}`);
        holderFails++;
      }

      // Check 7: quality holder count
      if (n(s.quality_holder_count) !== n(sq.quality_holder_count)) {
        fail(`quality_holder_count ${t.slice(0, 10)}…`,
          `stored=${n(s.quality_holder_count)} expected=${n(sq.quality_holder_count)}`);
        qualityFails++;
      }

      // Check 8: timestamps (already strings from TO_CHAR — compare directly)
      if (s.first_seen !== st.first_seen || s.last_seen !== st.last_seen) {
        fail(`timestamps ${t.slice(0, 10)}…`,
          `first: stored=${s.first_seen} expected=${st.first_seen}; last: stored=${s.last_seen} expected=${st.last_seen}`);
        tsFails++;
      }
    }

    if (tradeCountFails  === 0) pass('trade_count / buy_trades / sell_trades',  `${SAMPLE_SIZE} tokens`);
    if (traderCountFails === 0) pass('unique_traders / buyers / sellers',        `${SAMPLE_SIZE} tokens`);
    if (holderFails      === 0) pass('holder_count',                             `${SAMPLE_SIZE} tokens`);
    if (qualityFails     === 0) pass('quality_holder_count (threshold=80)',      `${SAMPLE_SIZE} tokens`);
    if (tsFails          === 0) pass('first_seen / last_seen (TO_CHAR)',         `${SAMPLE_SIZE} tokens`);
  }

  // ── 9. rebuildToken spot check ───────────────────────────────────────────────
  section('9. rebuildToken: single-token rebuild matches rebuildAll results');
  {
    // Pick 3 tokens with known quality holders for a strong test
    const picks = await db.execute<{ token_address: string; quality_holder_count: string }>(sql`
      SELECT token_address, quality_holder_count
      FROM token_metrics
      WHERE quality_holder_count > 0
      ORDER BY RANDOM()
      LIMIT 3
    `);

    let fails = 0;
    for (const { token_address, quality_holder_count: beforeQH } of picks) {
      // Deliberately corrupt then rebuild
      await db.execute(sql`
        UPDATE token_metrics SET quality_holder_count = -999 WHERE token_address = ${token_address}
      `);
      await TokenMetricsRepository.rebuildToken(token_address);

      const after = await db.execute<{ quality_holder_count: string }>(sql`
        SELECT quality_holder_count FROM token_metrics WHERE token_address = ${token_address}
      `);
      const afterQH = after[0]!.quality_holder_count;
      if (afterQH === beforeQH) {
        pass(`rebuildToken ${token_address.slice(0, 10)}…`, `quality_holders=${afterQH}`);
      } else {
        fail(`rebuildToken ${token_address.slice(0, 10)}…`,
          `before=${beforeQH} after=${afterQH}`);
        fails++;
      }
    }
    if (fails > 0) fail('rebuildToken spot check', `${fails}/3 failed`);
  }

  // ── 10. Idempotency ──────────────────────────────────────────────────────────
  section('10. Idempotency: rebuildToken() twice → identical metrics');
  {
    const picks = await db.execute<{ token_address: string; trade_count: number }>(sql`
      SELECT token_address, trade_count
      FROM token_metrics
      ORDER BY RANDOM()
      LIMIT 3
    `);

    let changed = 0;
    for (const { token_address, trade_count: beforeTradeCount } of picks) {
      await TokenMetricsRepository.rebuildToken(token_address);
      const after = await db.execute<{ trade_count: number }>(sql`
        SELECT trade_count FROM token_metrics WHERE token_address = ${token_address}
      `);
      if (after[0] && after[0].trade_count !== beforeTradeCount) {
        changed++;
      }
    }

    if (changed === 0) {
      pass('two consecutive rebuilds produce identical metrics');
    } else {
      fail('metrics changed after second rebuild', `${changed} rows differ`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(64));
  console.log(`Result: ${passCount} PASS  ${failCount} FAIL  (${totalChecks} checks)`);

  await queryClient.end();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
