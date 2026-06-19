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

  const mockToken = '0x1111111111111111111111111111111111111111';
  const mockToken2 = '0x2222222222222222222222222222222222222222';
  const mockWallets = Array.from({ length: 10 }, (_, i) => `0x${String(i + 1).padStart(40, '0')}`);

  try {
    // Inject mock token_metrics
    await db.execute(sql`
      INSERT INTO token_metrics (
        token_address, token_symbol, token_decimals, trade_count, buy_trades, sell_trades,
        unique_traders, unique_buyers, unique_sellers, holder_count, quality_holder_count,
        active_wallet_count, net_holders, first_seen, last_seen, last_updated
      ) VALUES (
        ${mockToken}, 'TKN_A', 18, 20, 10, 10, 10, 10, 10, 100, 10, 10, 10, NOW(), NOW(), NOW()
      ) ON CONFLICT (token_address) DO UPDATE SET
        holder_count = 100,
        quality_holder_count = 10,
        last_updated = NOW()
    `);

    await db.execute(sql`
      INSERT INTO token_metrics (
        token_address, token_symbol, token_decimals, trade_count, buy_trades, sell_trades,
        unique_traders, unique_buyers, unique_sellers, holder_count, quality_holder_count,
        active_wallet_count, net_holders, first_seen, last_seen, last_updated
      ) VALUES (
        ${mockToken2}, 'TKN_B', 18, 6, 3, 3, 3, 3, 3, 50, 3, 3, 3, NOW(), NOW(), NOW()
      ) ON CONFLICT (token_address) DO UPDATE SET
        holder_count = 50,
        quality_holder_count = 3,
        last_updated = NOW()
    `);

    for (let idx = 0; idx < mockWallets.length; idx++) {
      const w = mockWallets[idx];
      await db.execute(sql`
        INSERT INTO wallet_scores (
          wallet, activity_score, conviction_score, breadth_score, consistency_score,
          rank_score, rank_position, classification, trade_count, unique_tokens,
          current_open_positions, active_days, last_updated
        ) VALUES (
          ${w}, 50, 50, 50, 50, 90, 1, 'accumulator', 5, 2, 2, 2, NOW()
        ) ON CONFLICT (wallet) DO UPDATE SET
          rank_score = 90,
          classification = 'accumulator',
          last_updated = NOW()
      `);

      // All 10 hold TKN_A
      await db.execute(sql`
        INSERT INTO wallet_positions (
          wallet, token_address, token_symbol, token_decimals, total_bought, total_sold,
          net_amount, first_trade_at, last_trade_at, trade_count, updated_at
        ) VALUES (
          ${w}, ${mockToken}, 'TKN_A', 18, '1000', '0', '1000', NOW(), NOW(), 1, NOW()
        ) ON CONFLICT (wallet, token_address) DO UPDATE SET
          net_amount = '1000',
          updated_at = NOW()
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
      SELECT token_address, token_symbol FROM smart_money_signals
      WHERE token_address NOT IN (${mockToken}, ${mockToken2})
      ORDER BY RANDOM() LIMIT ${SAMPLE_SIZE}
    `);

    let fieldFails = 0;

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
          AND wp.first_trade_at > (SELECT MAX(timestamp) FROM trades) - INTERVAL '4 hours'
      `);

      const gtExit = await db.execute<{ count: string }>(sql`
        SELECT COUNT(DISTINCT wp.wallet) AS count
        FROM wallet_positions wp
        JOIN wallet_scores ws ON ws.wallet = wp.wallet
        WHERE wp.token_address = ${token_address}
          AND wp.net_amount::numeric <= 0
          AND ws.rank_score >= 80
          AND wp.last_trade_at > (SELECT MAX(timestamp) FROM trades) - INTERVAL '4 hours'
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

  // 8. Signal freshness transitions (LIVE / STALE)
  section('8. Signal freshness transitions (dataFreshness LIVE ↔ STALE)');
  {
    const topSignals = await SmartMoneySignalsRepository.getTopSignals({ limit: 1 });

    if (topSignals.length > 0) {
      const s = topSignals[0]!;

      // 1. Make all dependencies fresh
      await db.execute(sql`
        UPDATE wallet_positions SET updated_at = NOW() WHERE LOWER(token_address) = LOWER(${s.tokenAddress})
      `);
      await db.execute(sql`
        UPDATE token_metrics SET last_updated = NOW() WHERE LOWER(token_address) = LOWER(${s.tokenAddress})
      `);
      await db.execute(sql`
        UPDATE wallet_scores SET last_updated = NOW()
        WHERE LOWER(wallet) IN (
          SELECT LOWER(wallet) FROM wallet_positions WHERE LOWER(token_address) = LOWER(${s.tokenAddress})
        )
      `);
      await db.execute(sql`
        UPDATE smart_money_signals SET computed_at = NOW() WHERE LOWER(token_address) = LOWER(${s.tokenAddress})
      `);

      // Re-fetch signal
      const signalFresh = await SmartMoneySignalsRepository.getSignal(s.tokenAddress);
      if (signalFresh?.dataFreshness === 'LIVE') {
        pass('fresh rebuild + fresh dependencies => LIVE');
      } else {
        fail('fresh rebuild + fresh dependencies did not report LIVE', `got=${signalFresh?.dataFreshness}`);
      }

      // 2. Make one dependency stale (token_metrics)
      await db.execute(sql`
        UPDATE token_metrics SET last_updated = NOW() - INTERVAL '3 hours' WHERE token_address = ${s.tokenAddress}
      `);

      const signalStaleMetrics = await SmartMoneySignalsRepository.getSignal(s.tokenAddress);
      if (signalStaleMetrics?.dataFreshness === 'STALE') {
        pass('fresh rebuild + stale token_metrics => STALE');
      } else {
        fail('fresh rebuild + stale token_metrics did not report STALE', `got=${signalStaleMetrics?.dataFreshness}`);
      }

      // Reset dependency freshness to fresh
      await db.execute(sql`
        UPDATE token_metrics SET last_updated = NOW() WHERE token_address = ${s.tokenAddress}
      `);

      // 3. Make wallet_positions stale
      await db.execute(sql`
        UPDATE wallet_positions SET updated_at = NOW() - INTERVAL '3 hours' WHERE token_address = ${s.tokenAddress}
      `);

      const signalStalePositions = await SmartMoneySignalsRepository.getSignal(s.tokenAddress);
      if (signalStalePositions?.dataFreshness === 'STALE') {
        pass('fresh rebuild + stale wallet_positions => STALE');
      } else {
        fail('fresh rebuild + stale wallet_positions did not report STALE', `got=${signalStalePositions?.dataFreshness}`);
      }

      // Reset
      await db.execute(sql`
        UPDATE wallet_positions SET updated_at = NOW() WHERE token_address = ${s.tokenAddress}
      `);

      // 4. Make wallet_scores stale
      await db.execute(sql`
        UPDATE wallet_scores SET last_updated = NOW() - INTERVAL '3 hours'
        WHERE wallet IN (
          SELECT wallet FROM wallet_positions WHERE token_address = ${s.tokenAddress} AND net_amount::numeric > 0
        )
      `);

      const signalStaleScores = await SmartMoneySignalsRepository.getSignal(s.tokenAddress);
      if (signalStaleScores?.dataFreshness === 'STALE') {
        pass('fresh rebuild + stale wallet_scores => STALE');
      } else {
        fail('fresh rebuild + stale wallet_scores did not report STALE', `got=${signalStaleScores?.dataFreshness}`);
      }

      // Reset all back to fresh
      await db.execute(sql`
        UPDATE wallet_scores SET last_updated = NOW()
        WHERE wallet IN (
          SELECT wallet FROM wallet_positions WHERE token_address = ${s.tokenAddress}
        )
      `);
    } else {
      fail('No signals available to test freshness transitions');
    }
  }

  // Summary
  console.log('\n' + '='.repeat(64));
  console.log(`Result: ${passCount} PASS  ${failCount} FAIL  (${totalChecks} checks)`);

  // Cleanup mock data
  await db.execute(sql`DELETE FROM wallet_positions WHERE token_address IN (${mockToken}, ${mockToken2})`);
  await db.execute(sql`DELETE FROM token_metrics WHERE token_address IN (${mockToken}, ${mockToken2})`);
  await db.execute(sql`DELETE FROM wallet_scores WHERE wallet IN (${sql.join(mockWallets, sql`, `)})`);
  await db.execute(sql`DELETE FROM smart_money_signals WHERE token_address IN (${mockToken}, ${mockToken2})`);

  await queryClient.end();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
