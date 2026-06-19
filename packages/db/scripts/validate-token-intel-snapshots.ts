import { SnapshotService } from '../src/services/snapshot-service.js';
import { SmartMoneySignalsRepository } from '../src/repositories/smart-money-signals-repository.js';
import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

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

const parseUtcDate = (val: string | Date | null | undefined): Date | undefined => {
  if (!val) return undefined;
  if (val instanceof Date) return val;
  let str = String(val).trim();
  if (!str) return undefined;
  
  let isoStr = str.replace(' ', 'T');
  if (/[+-]\d{2}$/.test(isoStr)) {
    isoStr += ':00';
  }
  const hasTimezone = isoStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(isoStr);
  if (!hasTimezone) {
    isoStr += 'Z';
  }
  
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? undefined : d;
};

const formatUtcTimestamp = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
};

async function main() {
  console.log('token_intel_snapshots & temporal intelligence validation suite');
  console.log('='.repeat(64));

  // Determine current dataset watermark — all test data is scoped to this timestamp.
  // Historical snapshots at OTHER timestamps are never touched by this test suite.
  const watermarkRow = await db.execute<{ max_ts: string | Date }>(sql`
    SELECT COALESCE(MAX(timestamp), NOW()) AS max_ts FROM trades
  `);
  const captureTs    = parseUtcDate(watermarkRow[0]!.max_ts)!;

  // Snapshot historical count so we can verify it is preserved after the test.
  const [historicalCountRow] = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) AS cnt FROM token_intel_snapshots
    WHERE snapshot_at != ${captureTs.toISOString()}
  `);
  const historicalCountBefore = parseInt(historicalCountRow!.cnt);

  // 1. Initial Capture
  section('1. Snapshot Capture: smart_money_signals -> token_intel_snapshots');
  {
    // Remove only snapshots at the current watermark (from previous test runs or stale state).
    // Snapshots at ALL other timestamps are left intact.
    await db.execute(sql`DELETE FROM token_intel_snapshots WHERE snapshot_at = ${captureTs.toISOString()}`);

    const t0 = Date.now();
    await SnapshotService.capture();
    const elapsed = Date.now() - t0;

    const snapCountAtWatermark = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) FROM token_intel_snapshots WHERE snapshot_at = ${captureTs.toISOString()}
    `);
    const signalCount = await db.execute<{ count: string }>(sql`SELECT COUNT(*) FROM smart_money_signals`);

    if (snapCountAtWatermark[0]!.count === signalCount[0]!.count && Number(snapCountAtWatermark[0]!.count) > 0) {
      pass('captured initial snapshot', `${snapCountAtWatermark[0]!.count} rows saved in ${elapsed}ms`);
    } else {
      fail('snapshot count mismatch', `snapshots=${snapCountAtWatermark[0]!.count} signals=${signalCount[0]!.count}`);
    }
  }

  // 2. Idempotency Check
  section('2. Idempotency Check: capture duplicate snapshots');
  {
    try {
      await SnapshotService.capture();
      pass('captured duplicate snapshot successfully (ON CONFLICT resolved)');
    } catch (err) {
      fail('duplicate snapshot crashed', err instanceof Error ? err.message : String(err));
    }
  }

  // 3. Dynamic Deltas with No Baseline (1 snapshot only)
  section('3. Temporal Deltas: Single Snapshot Baseline (deltas = null, trend = UNKNOWN)');
  {
    const mockToken = '0x9999999999999999999999999999999999999999';
    // Insert mock signal row
    await db.execute(sql`
      INSERT INTO smart_money_signals (
        token_address, token_symbol, meets_minimum_holders, accumulation_score, signal_tier, computed_at
      ) VALUES (
        ${mockToken}, 'MOCK_NO_BASE', true, 80, 'STRONG', NOW()
      ) ON CONFLICT (token_address) DO UPDATE SET
        meets_minimum_holders = true,
        accumulation_score = 80,
        signal_tier = 'STRONG',
        computed_at = NOW()
    `);
    
    // Also need a mock row in token_metrics so getSignal freshness join doesn't fail or return null
    await db.execute(sql`
      INSERT INTO token_metrics (
        token_address, token_symbol, token_decimals, last_updated
      ) VALUES (
        ${mockToken}, 'MOCK_NO_BASE', 18, NOW()
      ) ON CONFLICT (token_address) DO UPDATE SET
        last_updated = NOW()
    `);

    // Fetch signal with dynamic enrichment
    const s = await SmartMoneySignalsRepository.getSignal(mockToken);
    if (s) {
      if (
        s.qualityHolderChange24h === null &&
        s.trend === 'UNKNOWN'
      ) {
        pass(`single snapshot delta resolved correctly for ${s.tokenSymbol} (trend=UNKNOWN)`);
      } else {
        fail('single snapshot delta mismatch', JSON.stringify({
          change24h: s.qualityHolderChange24h,
          trend: s.trend
        }));
      }
    } else {
      fail('no signal returned to check');
    }

    // Cleanup mock signal and metrics
    await db.execute(sql`DELETE FROM smart_money_signals WHERE token_address = ${mockToken}`);
    await db.execute(sql`DELETE FROM token_metrics WHERE token_address = ${mockToken}`);
  }

  // 4. Dynamic Deltas with Mock Historical Baseline
  section('4. Temporal Deltas & Trend Classification: Mock Historical Baseline');
  {
    // Fetch a random token that meets the minimum holder count
    const targetRow = await db.execute<{ token_address: string; token_symbol: string; quality_holder_count: number; avg_quality_rank_score: string; holder_count: number; accumulation_score: string }>(sql`
      SELECT token_address, token_symbol, quality_holder_count, avg_quality_rank_score, holder_count, accumulation_score
      FROM smart_money_signals
      WHERE meets_minimum_holders = true
      LIMIT 1
    `);

    if (targetRow.length > 0) {
      const t = targetRow[0]!;
      const datasetWindow = await db.execute<{ max_ts: Date | string }>(sql`SELECT MAX(timestamp) AS max_ts FROM trades`);
      const maxTs = parseUtcDate(datasetWindow[0]!.max_ts)!;
      
      // Calculate target timestamp for T-24h
      const ts24h = new Date(maxTs.getTime() - 24 * 60 * 60 * 1000);
      const ts24hStr = formatUtcTimestamp(ts24h);

      // Delete any pre-existing snapshot at this past timestamp
      await db.execute(sql`
        DELETE FROM token_intel_snapshots 
        WHERE token_address = ${t.token_address} AND snapshot_at = ${ts24hStr}
      `);

      // Insert mock snapshot for this token dated T-24h:
      // quality holders = current - 15 (gained 15)
      // score = current - 26 (rose by 26)
      // concentration = current - 17
      const pastQh = t.quality_holder_count - 15;
      const pastScore = parseFloat(t.accumulation_score) - 26.00; // current score will be higher
      const pastConcentration = 41.00;

      await db.execute(sql`
        INSERT INTO token_intel_snapshots (
          token_address, snapshot_at, quality_holder_count, holder_count, quality_concentration_pct,
          quality_entry_count_1h, quality_entry_count_4h, quality_exit_count_1h, quality_exit_count_4h,
          net_accumulation_flow, avg_quality_rank_score, accumulation_score, signal_tier, computed_at
        ) VALUES (
          ${t.token_address}, ${ts24hStr}, ${pastQh}, ${t.holder_count}, ${pastConcentration},
          0, 0, 0, 0,
          0, ${t.avg_quality_rank_score}, ${pastScore}, 'STRONG', NOW()
        )
      `);

      // Re-fetch token signal (will query snapshots dynamically and enrich)
      const sig = await SmartMoneySignalsRepository.getSignal(t.token_address);

      if (sig) {
        const isGaining = sig.qualityHolderChange24h === 15;
        const trendMatch = sig.trend === 'INCREASING';

        if (isGaining && trendMatch) {
          pass(`gained +15 quality holders and trend classified as ${sig.trend}`);
        } else {
          fail(`mock baseline validation failed for ${t.token_symbol}`, JSON.stringify({
            expectedChangeQH: 15, actualChangeQH: sig.qualityHolderChange24h,
            expectedTrend: 'INCREASING', actualTrend: sig.trend
          }));
        }

        // Narrative verification
        if (sig.narrative.includes('gained 15 quality holders') && sig.narrative.includes('Trend remains INCREASING')) {
          pass('dynamic plain-text narrative pre-rendered correctly', sig.narrative);
        } else {
          fail('dynamic narrative format incorrect', sig.narrative);
        }
      } else {
        fail('failed to load enriched signal for target token');
      }

      // Cleanup mock snapshot row
      await db.execute(sql`
        DELETE FROM token_intel_snapshots 
        WHERE token_address = ${t.token_address} AND snapshot_at = ${ts24hStr}
      `);
    } else {
      fail('no eligible tokens found to verify baseline');
    }
  }

  // ── Cleanup & Production-Safety Verification ─────────────────────────────────
  section('5. Production Safety: historical snapshots preserved');
  {
    // Delete only the snapshots inserted at the current watermark by this test run.
    await db.execute(sql`DELETE FROM token_intel_snapshots WHERE snapshot_at = ${captureTs.toISOString()}`);

    const [afterRow] = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*) AS cnt FROM token_intel_snapshots
      WHERE snapshot_at != ${captureTs.toISOString()}
    `);
    const historicalCountAfter = parseInt(afterRow!.cnt);

    if (historicalCountAfter === historicalCountBefore) {
      pass('Historical snapshot count unchanged after test cleanup', `before=${historicalCountBefore} after=${historicalCountAfter}`);
    } else {
      fail('Historical snapshots were inadvertently modified', `before=${historicalCountBefore} after=${historicalCountAfter}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(64));
  console.log(`Result: ${passCount} PASS  ${failCount} FAIL  (${totalChecks} checks)`);

  await queryClient.end();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
