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
  let str = '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return undefined;
    const pad = (n: number) => String(n).padStart(2, '0');
    str = `${val.getUTCFullYear()}-${pad(val.getUTCMonth() + 1)}-${pad(val.getUTCDate())} ${pad(val.getUTCHours())}:${pad(val.getUTCMinutes())}:${pad(val.getUTCSeconds())}`;
  } else {
    str = String(val).trim();
  }
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
  console.log('Phase 5C — Signal Consumption & Agent Interface Validation');
  console.log('='.repeat(64));

  // Clean and Capture initial state
  await db.execute(sql`DELETE FROM token_intel_snapshots`);
  await SnapshotService.capture();

  // Find a target token meeting minimum holders
  const targetRow = await db.execute<{ token_address: string; token_symbol: string; quality_holder_count: number; avg_quality_rank_score: string; holder_count: number; accumulation_score: string; consensus_diversity: number; quality_concentration_pct: string }>(sql`
    SELECT token_address, token_symbol, quality_holder_count, avg_quality_rank_score, holder_count, accumulation_score, consensus_diversity, quality_concentration_pct
    FROM smart_money_signals
    WHERE meets_minimum_holders = true
    LIMIT 1
  `);


  if (targetRow.length === 0) {
    fail('No tokens found meeting minimum holders to run validation.');
    process.exit(1);
  }

  const t = targetRow[0]!;
  const tokenAddr = t.token_address;
  const symbol = t.token_symbol;
  console.log(`Using target token for testing: ${symbol} (${tokenAddr})`);

  const datasetWindow = await db.execute<{ max_ts: Date | string }>(sql`SELECT MAX(timestamp) AS max_ts FROM trades`);
  const maxTs = parseUtcDate(datasetWindow[0]!.max_ts)!;

  // 1. Dynamic Derivation of 24h Entries/Exits from Snapshots
  section('1. Dynamic Derivation of 24h entry/exits');
  {
    // Insert mock snapshots over the last 24h
    // We will place them at T-20h, T-16h, T-12h, T-8h, T-4h
    const tsPast = (hours: number) => new Date(maxTs.getTime() - hours * 60 * 60 * 1000);

    const mockSnaps = [
      { ts: tsPast(20), entries: 2, exits: 1 },
      { ts: tsPast(16), entries: 1, exits: 0 },
      { ts: tsPast(12), entries: 3, exits: 2 },
      { ts: tsPast(8),  entries: 0, exits: 1 },
      { ts: tsPast(4),  entries: 1, exits: 1 },
    ];

    for (const s of mockSnaps) {
      const tsStr = formatUtcTimestamp(s.ts);
      await db.execute(sql`
        INSERT INTO token_intel_snapshots (
          token_address, snapshot_at, quality_holder_count, holder_count, quality_concentration_pct,
          quality_entry_count_1h, quality_entry_count_4h, quality_exit_count_1h, quality_exit_count_4h,
          net_accumulation_flow, avg_quality_rank_score, accumulation_score, signal_tier, computed_at
        ) VALUES (
          ${tokenAddr}, ${tsStr}, ${t.quality_holder_count}, ${t.holder_count}, ${t.quality_concentration_pct},
          0, ${s.entries}, 0, ${s.exits},
          0, ${t.avg_quality_rank_score}, ${t.accumulation_score}, 'STRONG', NOW()
        )
      `);
    }

    // Capture at T (current state)
    await SnapshotService.capture();

    const sig = await SmartMoneySignalsRepository.getSignal(tokenAddr);

    if (sig) {
      // Current 4h entry count from smart_money_signals table is added if snapshot exists at T.
      // Total sum: 2 + 1 + 3 + 0 + 1 + current4h
      const expectedEntries = 2 + 1 + 3 + 0 + 1 + sig.qualityEntries4h;
      const expectedExits = 1 + 0 + 2 + 1 + 1 + sig.qualityExits4h;
      const expectedFlow = expectedEntries - expectedExits;

      if (sig.qualityEntries24h === expectedEntries && sig.qualityExits24h === expectedExits && sig.netAccumulationFlow24h === expectedFlow) {
        pass('Dynamic rolling 24h entry/exits matches expectations from snapshot summation', 
          `entries=${sig.qualityEntries24h} exits=${sig.qualityExits24h} netFlow=${sig.netAccumulationFlow24h}`);
      } else {
        fail('Dynamic rolling 24h entry/exits mismatch', 
          `Expected: entries=${expectedEntries} exits=${expectedExits} netFlow=${expectedFlow}. Got: entries=${sig.qualityEntries24h} exits=${sig.qualityExits24h} netFlow=${sig.netAccumulationFlow24h}`);
      }
    } else {
      fail('Could not load enriched signal bundle for target token');
    }

    // Clean up mock snapshots
    await db.execute(sql`
      DELETE FROM token_intel_snapshots 
      WHERE token_address = ${tokenAddr} AND snapshot_at < ${formatUtcTimestamp(maxTs)}
    `);
  }

  // 2. Confidence Score math validation (logarithmic scaling)
  section('2. Logarithmic Confidence Score math');
  {
    const qhCount = t.quality_holder_count;
    const div = t.consensus_diversity;
    const total = t.holder_count;

    // Manual Calculation of Confidence Score components
    const expectedC_qh = Math.min(50, 10 * Math.log(1 + qhCount));
    const expectedC_div = Math.min(1.0, div / 3) * 20;
    
    let expectedC_size = 5;
    if (total >= 20) expectedC_size = 20;
    else if (total >= 10) expectedC_size = 10;

    const expectedC_trend = 0; // Trend is UNKNOWN with single snapshot baseline

    const expectedConfidence = parseFloat((expectedC_qh + expectedC_div + expectedC_size + expectedC_trend).toFixed(2));

    const sig = await SmartMoneySignalsRepository.getSignal(tokenAddr);

    if (sig) {
      if (Math.abs(sig.confidence - expectedConfidence) < 0.01) {
        pass('Logarithmic Confidence Score matches mathematical expectation', `Calculated: ${sig.confidence}% (Expected: ${expectedConfidence}%)`);
      } else {
        fail('Logarithmic Confidence Score mismatch', `Expected: ${expectedConfidence}%. Got: ${sig.confidence}%`);
      }
    } else {
      fail('Failed to load enriched signal for confidence check');
    }
  }

  // 3. Opportunity Score ( composite ranking ) math validation
  section('3. Composite Opportunity Score math');
  {
    const sig = await SmartMoneySignalsRepository.getSignal(tokenAddr);

    if (sig) {
      // Formula: S_opp = S_acc * 0.40 + S_growth * 0.30 + S_trend * 0.15 + S_conf * 0.15
      // With single snapshot baseline:
      // S_acc = sig.accumulationScore
      // S_growth = 0 (since qualityHolderChange24h is null/no history)
      // S_trend = 25 (since trend is UNKNOWN)
      // S_conf = sig.confidence
      const expectedOppScore = parseFloat((sig.accumulationScore * 0.40 + 0 * 0.30 + 25 * 0.15 + sig.confidence * 0.15).toFixed(2));

      if (Math.abs(sig.opportunityScore - expectedOppScore) < 0.01) {
        pass('Composite Opportunity Score matches mathematical expectation', `Calculated: ${sig.opportunityScore} (Expected: ${expectedOppScore})`);
      } else {
        fail('Opportunity Score mismatch', `Expected: ${expectedOppScore}. Got: ${sig.opportunityScore}`);
      }
    } else {
      fail('Failed to load enriched signal for opportunity score check');
    }
  }

  // 4. Reasons & Risks rule engines validation
  section('4. Reasons and Risks rule engines');
  {
    // Modify database or snapshot to trigger reasons/risks
    const sig = await SmartMoneySignalsRepository.getSignal(tokenAddr);
    if (sig) {
      console.log(`Signal reasons for ${symbol}:`, sig.signalReasons);
      console.log(`Risk flags for ${symbol}:`, sig.riskFlags);

      // Verify accumulator rules
      if (sig.accumulationScore >= 75) {
        if (sig.signalReasons.includes('high_accumulation')) {
          pass('Correctly assigned high_accumulation signal reason');
        } else {
          fail('Missed high_accumulation signal reason');
        }
      }

      if (sig.qualityHolderCount < 5) {
        if (sig.riskFlags.includes('low_holder_count')) {
          pass('Correctly flagged low_holder_count risk');
        } else {
          fail('Missed low_holder_count risk flag');
        }
      } else {
        if (!sig.riskFlags.includes('low_holder_count')) {
          pass('Correctly omitted low_holder_count risk for robust token');
        } else {
          fail('Falsely flagged low_holder_count risk');
        }
      }
    } else {
      fail('Failed to load enriched signal for reasons/risks check');
    }
  }

  // 5. Emerging Signals validation (first-class alpha)
  section('5. Emerging Signals & Repository read APIs');
  {
    // Clean snapshots and populate mock signals to test getEmergingSignals
    await db.execute(sql`DELETE FROM token_intel_snapshots`);

    // Let's create an emerging token scenario:
    // A token with low holder count (< 15) and positive growth.
    // Let's find one row from smart_money_signals with qualityHolderCount < 15 and meetsMinimumHolders = true.
    const emergingCandidate = await db.execute<{ token_address: string; token_symbol: string; quality_holder_count: number }>(sql`
      SELECT token_address, token_symbol, quality_holder_count
      FROM smart_money_signals
      WHERE meets_minimum_holders = true AND quality_holder_count < 15
      LIMIT 1
    `);

    if (emergingCandidate.length > 0) {
      const ec = emergingCandidate[0]!;
      const ts24h = new Date(maxTs.getTime() - 24 * 60 * 60 * 1000);
      const ts24hStr = formatUtcTimestamp(ts24h);

      // Mock snapshot representing past state with lower quality holders (so positive growth)
      const pastQh = Math.max(3, ec.quality_holder_count - 2); // growth of +2
      await db.execute(sql`
        INSERT INTO token_intel_snapshots (
          token_address, snapshot_at, quality_holder_count, holder_count, quality_concentration_pct,
          quality_entry_count_1h, quality_entry_count_4h, quality_exit_count_1h, quality_exit_count_4h,
          net_accumulation_flow, avg_quality_rank_score, accumulation_score, signal_tier, computed_at
        ) VALUES (
          ${ec.token_address}, ${ts24hStr}, ${pastQh}, 10, '30.00',
          0, 0, 0, 0,
          0, '90.00', '40.00', 'WEAK', NOW()
        )
      `);

      const emerging = await SmartMoneySignalsRepository.getEmergingSignals();
      const match = emerging.find(s => s.tokenAddress === ec.token_address);

      if (match) {
        pass(`Emerging Signals API successfully returned high-alpha emerging token ${ec.token_symbol} with positive growth`, 
          `currentQualityHolders=${match.qualityHolderCount} 24hChange=${match.qualityHolderChange24h}`);
      } else {
        fail(`Emerging Signals API did not return target emerging token ${ec.token_symbol}`);
      }

      // Cleanup
      await db.execute(sql`
        DELETE FROM token_intel_snapshots 
        WHERE token_address = ${ec.token_address} AND snapshot_at = ${ts24hStr}
      `);
    } else {
      console.log('  INFO  No qualityHolderCount < 15 tokens found in current dataset, skipping emerging check');
    }

    // Verify getTopSignals ordering
    const top = await SmartMoneySignalsRepository.getTopSignals({ limit: 5 });
    if (top.length > 0) {
      let sorted = true;
      for (let i = 0; i < top.length - 1; i++) {
        if (top[i]!.opportunityScore < top[i+1]!.opportunityScore) {
          sorted = false;
        }
      }
      if (sorted) {
        pass('getTopSignals properly sorts outputs by opportunityScore DESC', 
          top.map(t => `${t.tokenSymbol}: opp=${t.opportunityScore} conf=${t.confidence}%`).join(' | '));
      } else {
        fail('getTopSignals sorting is incorrect', JSON.stringify(top.map(t => t.opportunityScore)));
      }
    }
  }

  // 6. Narrative outputs verification
  section('6. Narrative output validation');
  {
    const sig = await SmartMoneySignalsRepository.getSignal(tokenAddr);
    if (sig) {
      const containsOppScore = sig.narrative.includes(`Opportunity Score: ${sig.opportunityScore}`);
      const containsConfidence = sig.narrative.includes(`(Confidence: ${sig.confidence}%)`);
      const containsTier = sig.narrative.toLowerCase().includes(sig.signalTier.toLowerCase());

      if (containsOppScore && containsConfidence && containsTier) {
        pass('Plain-text narrative dynamically rendered correctly containing Phase 5C metrics', sig.narrative);
      } else {
        fail('Plain-text narrative is formatted incorrectly or missing metrics', sig.narrative);
      }
    } else {
      fail('Failed to load enriched signal for narrative check');
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(64));
  console.log(`Result: ${passCount} PASS  ${failCount} FAIL  (${totalChecks} checks)`);

  await queryClient.end();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
