import { SmartMoneySignalsRepository } from '../src/repositories/smart-money-signals-repository.js';
import { BSC_BASE_TOKENS } from '../src/schema/smart-money-signals.js';
import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

const SAMPLE_SIZE = 20;

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
  console.log('smart_money_signals validation suite');
  console.log('='.repeat(64));

  // 1. Coverage
  section('1. Coverage: smart_money_signals count == token_metrics count');
  {
    const counts = await db.execute<{ signals_count: string; metrics_count: string }>(sql`
      SELECT
        (SELECT COUNT(*) FROM smart_money_signals) AS signals_count,
        (SELECT COUNT(*) FROM token_metrics) AS metrics_count
    `);
    const { signals_count, metrics_count } = counts[0]!;
    if (signals_count === metrics_count) {
      pass('coverage count match', `${signals_count} rows`);
    } else {
      fail('coverage count mismatch', `signals=${signals_count} metrics=${metrics_count}`);
    }
  }

  // 2. Score bounds
  section('2. Score bounds check (0.00 - 100.00)');
  {
    const violations = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM smart_money_signals
      WHERE accumulation_score::numeric < 0 OR accumulation_score::numeric > 100
    `);
    if (Number(violations[0]!.count) === 0) {
      pass('all accumulation scores within [0.00, 100.00]');
    } else {
      fail('score bounds violations found', `${violations[0]!.count} rows`);
    }
  }

  // 3. Noise floor logic
  section('3. Noise floor logic validation');
  {
    const wrongMeets = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM smart_money_signals
      WHERE meets_minimum_holders = true AND (quality_holder_count < 3 OR holder_count < 10)
    `);
    const wrongNoise = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM smart_money_signals
      WHERE meets_minimum_holders = false AND (signal_tier != 'NOISE' OR accumulation_score::numeric != 0)
    `);

    if (Number(wrongMeets[0]!.count) === 0 && Number(wrongNoise[0]!.count) === 0) {
      pass('noise floor triggers correctly (meets_minimum_holders flags are consistent)');
    } else {
      fail('noise floor inconsistency', `wrongMeets=${wrongMeets[0]!.count} wrongNoise=${wrongNoise[0]!.count}`);
    }
  }

  // 4. Net flow arithmetic
  section('4. Arithmetic: net_accumulation_flow == entry_4h - exit_4h');
  {
    const violations = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM smart_money_signals
      WHERE net_accumulation_flow != (quality_entry_count_4h - quality_exit_count_4h)
    `);
    if (Number(violations[0]!.count) === 0) {
      pass('net flow equals entries minus exits (all rows)');
    } else {
      fail('net flow arithmetic violations', `${violations[0]!.count} rows`);
    }
  }

  // 5. Narratives non-empty
  section('5. Narrative verification');
  {
    const topSignals = await SmartMoneySignalsRepository.getTopSignals({ limit: SAMPLE_SIZE });
    const emptyNarratives = topSignals.filter(s => !s.narrative || s.narrative === '');
    if (emptyNarratives.length === 0 && topSignals.length > 0) {
      pass('all sample narratives are dynamically populated');
    } else {
      fail('empty dynamically generated narratives found', `${emptyNarratives.length} bundles`);
    }
  }

  // 6. Direct random sample validation
  section(`6. Random sample field verification (${SAMPLE_SIZE} tokens)`);
  {
    const sample = await db.execute<{ token_address: string; token_symbol: string }>(sql`
      SELECT token_address, token_symbol FROM smart_money_signals ORDER BY RANDOM() LIMIT ${SAMPLE_SIZE}
    `);

    let fieldFails = 0;
    const maxTsRow = await db.execute<{ max_ts: Date }>(sql`SELECT MAX(timestamp) AS max_ts FROM trades`);
    const maxTs = maxTsRow[0]!.max_ts;

    for (const { token_address, token_symbol } of sample) {
      const stored = await db.execute<{
        quality_holder_count: number;
        entry_4h: number;
        exit_4h: number;
      }>(sql`
        SELECT
          quality_holder_count,
          quality_entry_count_4h AS entry_4h,
          quality_exit_count_4h AS exit_4h
        FROM smart_money_signals
        WHERE token_address = ${token_address}
      `);

      // Ground truth calculations
      const gtHolder = await db.execute<{ count: string }>(sql`
        SELECT COUNT(DISTINCT wp.wallet) AS count
        FROM wallet_positions wp
        JOIN wallet_scores ws ON ws.wallet = wp.wallet
        WHERE wp.token_address = ${token_address}
          AND wp.net_amount::numeric > 0
          AND ws.rank_score >= 80
      `);

      const gtEntry = await db.execute<{ count: string }>(sql`
        SELECT COUNT(DISTINCT wp.wallet) AS count
        FROM wallet_positions wp
        JOIN wallet_scores ws ON ws.wallet = wp.wallet
        WHERE wp.token_address = ${token_address}
          AND wp.net_amount::numeric > 0
          AND ws.rank_score >= 80
          AND wp.first_trade_at > ${maxTs}::timestamp - INTERVAL '4 hours'
      `);

      const gtExit = await db.execute<{ count: string }>(sql`
        SELECT COUNT(DISTINCT wp.wallet) AS count
        FROM wallet_positions wp
        JOIN wallet_scores ws ON ws.wallet = wp.wallet
        WHERE wp.token_address = ${token_address}
          AND wp.net_amount::numeric <= 0
          AND ws.rank_score >= 80
          AND wp.last_trade_at > ${maxTs}::timestamp - INTERVAL '4 hours'
      `);

      const s = stored[0]!;
      const expectedHolder = Number(gtHolder[0]!.count);
      const expectedEntry = Number(gtEntry[0]!.count);
      const expectedExit = Number(gtExit[0]!.count);

      if (
        s.quality_holder_count !== expectedHolder ||
        s.entry_4h !== expectedEntry ||
        s.exit_4h !== expectedExit
      ) {
        fail(`data mismatch for ${token_symbol} (${token_address.slice(0, 10)}…)`,
          `stored=(qh:${s.quality_holder_count}, e4h:${s.entry_4h}, ex4h:${s.exit_4h}) expected=(qh:${expectedHolder}, e4h:${expectedEntry}, ex4h:${expectedExit})`);
        fieldFails++;
      }
    }

    if (fieldFails === 0) {
      pass(`all ${SAMPLE_SIZE} sample tokens match direct SQL calculations`);
    }
  }

  // 7. getTopSignals API test
  section('7. Repository API validation (getTopSignals)');
  {
    // Exclude base tokens check
    const topSignals = await SmartMoneySignalsRepository.getTopSignals({ excludeBaseTokens: true, limit: 100 });
    const containsBaseToken = topSignals.some(s => BSC_BASE_TOKENS.has(s.tokenAddress));
    if (!containsBaseToken) {
      pass('base tokens successfully excluded');
    } else {
      fail('base tokens found in getTopSignals results');
    }

    // Empty tiers array crash safeguard check
    try {
      const emptyTiers = await SmartMoneySignalsRepository.getTopSignals({ tiers: [] });
      pass(`empty tiers check did not crash (returned ${emptyTiers.length} signals)`);
    } catch (err) {
      fail('empty tiers check crashed', err instanceof Error ? err.message : String(err));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(64));
  console.log(`Result: ${passCount} PASS  ${failCount} FAIL  (${totalChecks} checks)`);

  await queryClient.end();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
