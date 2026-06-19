/**
 * validate-live-positions.ts
 *
 * Verifies that wallet_positions (maintained by the live incremental applyTrades
 * path) is consistent with positions computed directly from the trades table.
 *
 * Strategy: read-only — does NOT call rebuildWallet or modify any data.
 * For each sampled wallet, we independently aggregate the trades table in SQL
 * and compare the result against the stored wallet_positions row.
 *
 * A mismatch means applyTrades produced a wrong delta (drift from ground truth).
 * A math failure means the stored net_amount ≠ total_bought - total_sold.
 *
 * Run:
 *   cd packages/db
 *   tsx scripts/validate-live-positions.ts [--sample N]   (default N=30)
 */

import { db, queryClient } from '../src/client.js';
import { walletPositions } from '../src/schema/wallet-positions.js';
import { sql } from 'drizzle-orm';

const SAMPLE_SIZE = parseInt(
  process.argv.find((a) => a.startsWith('--sample='))?.split('=')[1] ?? '30',
  10,
) || 30;

// ── Types ─────────────────────────────────────────────────────────────────────

interface AggregatedPosition {
  wallet:      string;
  tokenAddress: string;
  totalBought: string;
  totalSold:   string;
  netAmount:   string;
  tradeCount:  number;
}

interface StoredPosition {
  wallet:      string;
  tokenAddress: string;
  totalBought: string;
  totalSold:   string;
  netAmount:   string;
  tradeCount:  number;
  tokenSymbol: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute ground-truth positions for a wallet directly from the trades table. */
async function computeFromTrades(wallet: string): Promise<Map<string, AggregatedPosition>> {
  const rows = await db.execute<{
    wallet:       string;
    token_address: string;
    total_bought: string;
    total_sold:   string;
    net_amount:   string;
    trade_count:  string;
  }>(sql`
    WITH trade_parts AS (
      SELECT
        wallet,
        token_out_address   AS token_address,
        amount_out::numeric AS bought_amount,
        0::numeric          AS sold_amount,
        1                   AS trade_cnt
      FROM trades
      WHERE wallet = ${wallet}

      UNION ALL

      SELECT
        wallet,
        token_in_address   AS token_address,
        0::numeric         AS bought_amount,
        amount_in::numeric AS sold_amount,
        1                  AS trade_cnt
      FROM trades
      WHERE wallet = ${wallet}
    )
    SELECT
      wallet,
      token_address,
      trunc(SUM(bought_amount))::text AS total_bought,
      trunc(SUM(sold_amount))::text   AS total_sold,
      trunc(SUM(bought_amount) - SUM(sold_amount))::text AS net_amount,
      SUM(trade_cnt)::integer         AS trade_count
    FROM trade_parts
    GROUP BY wallet, token_address
  `);

  return new Map(
    rows.map((r) => [
      r.token_address,
      {
        wallet:       r.wallet,
        tokenAddress: r.token_address,
        totalBought:  r.total_bought,
        totalSold:    r.total_sold,
        netAmount:    r.net_amount,
        tradeCount:   Number(r.trade_count),
      },
    ]),
  );
}

/** Read stored wallet_positions for a wallet. */
async function readStoredPositions(wallet: string): Promise<Map<string, StoredPosition>> {
  const rows = await db.execute<{
    wallet:        string;
    token_address: string;
    token_symbol:  string;
    total_bought:  string;
    total_sold:    string;
    net_amount:    string;
    trade_count:   number;
  }>(sql`
    SELECT wallet, token_address, token_symbol, total_bought, total_sold, net_amount, trade_count
    FROM wallet_positions
    WHERE wallet = ${wallet}
  `);

  return new Map(
    rows.map((r) => [
      r.token_address,
      {
        wallet:       r.wallet,
        tokenAddress: r.token_address,
        tokenSymbol:  r.token_symbol,
        totalBought:  r.total_bought,
        totalSold:    r.total_sold,
        netAmount:    r.net_amount,
        tradeCount:   Number(r.trade_count),
      },
    ]),
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Live Position Validation ===\n');

  // 1. Get all wallets with positions
  const allWalletRows = await db
    .selectDistinct({ wallet: walletPositions.wallet })
    .from(walletPositions);

  const allWallets = allWalletRows.map((r) => r.wallet);

  if (allWallets.length === 0) {
    console.log('No wallet positions found — run the indexer first.');
    process.exit(0);
  }

  console.log(`Total wallets with positions: ${allWallets.length}`);

  // 2. Sample randomly
  const sampleSize = Math.min(SAMPLE_SIZE, allWallets.length);
  const shuffled = [...allWallets].sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, sampleSize);

  console.log(`Validating sample of ${sampleSize} wallets...\n`);

  // 3. Validate each wallet
  let totalPositions  = 0;
  let mathFailCount   = 0;
  let mismatchCount   = 0;
  let missingCount    = 0;
  let extraCount      = 0;

  const failures: string[] = [];

  for (const wallet of sample) {
    const [stored, computed] = await Promise.all([
      readStoredPositions(wallet),
      computeFromTrades(wallet),
    ]);

    for (const [tokenAddress, storedPos] of stored.entries()) {
      totalPositions++;

      // Math check: net must equal bought minus sold
      const bought = BigInt(storedPos.totalBought);
      const sold   = BigInt(storedPos.totalSold);
      const net    = BigInt(storedPos.netAmount);

      if (net !== bought - sold) {
        mathFailCount++;
        const msg = `MATH FAIL: wallet=${wallet.slice(0, 10)}… token=${storedPos.tokenSymbol} ` +
          `bought=${bought} sold=${sold} stored_net=${net} expected=${bought - sold}`;
        failures.push(msg);
        console.log(`  ✗ ${msg}`);
      }

      // Consistency check: stored vs computed from trades table
      const computedPos = computed.get(tokenAddress);
      if (!computedPos) {
        // Position exists in wallet_positions but no matching trades — should be impossible
        extraCount++;
        const msg = `EXTRA: wallet=${wallet.slice(0, 10)}… token=${storedPos.tokenSymbol} has position but no trades`;
        failures.push(msg);
        console.log(`  ✗ ${msg}`);
        continue;
      }

      const boughtMatch = storedPos.totalBought === computedPos.totalBought;
      const soldMatch   = storedPos.totalSold   === computedPos.totalSold;
      const netMatch    = storedPos.netAmount    === computedPos.netAmount;

      if (!boughtMatch || !soldMatch || !netMatch) {
        mismatchCount++;
        const msg = [
          `MISMATCH: wallet=${wallet.slice(0, 10)}… token=${storedPos.tokenSymbol}`,
          `  stored : bought=${storedPos.totalBought}  sold=${storedPos.totalSold}  net=${storedPos.netAmount}`,
          `  trades : bought=${computedPos.totalBought}  sold=${computedPos.totalSold}  net=${computedPos.netAmount}`,
        ].join('\n');
        failures.push(msg);
        console.log(`  ✗ ${msg}`);
      }
    }

    // Check for tokens in trades but missing from wallet_positions
    for (const [tokenAddress, computedPos] of computed.entries()) {
      if (!stored.has(tokenAddress)) {
        missingCount++;
        const msg = `MISSING: wallet=${wallet.slice(0, 10)}… token=${tokenAddress.slice(0, 10)}… has trades but no position`;
        failures.push(msg);
        console.log(`  ✗ ${msg}`);
      }
    }
  }

  // 4. Summary
  console.log('\n─────────────────────────────────────');
  console.log('Validation Summary');
  console.log('─────────────────────────────────────');
  console.log(`  Wallets checked  : ${sampleSize}`);
  console.log(`  Positions checked: ${totalPositions}`);
  console.log(`  Math failures    : ${mathFailCount}`);
  console.log(`  Drift mismatches : ${mismatchCount}`);
  console.log(`  Missing positions: ${missingCount}`);
  console.log(`  Extra positions  : ${extraCount}`);
  console.log('─────────────────────────────────────');

  const totalFailures = mathFailCount + mismatchCount + missingCount + extraCount;
  if (totalFailures === 0) {
    console.log('\n✓ PASS — all positions consistent with trades table\n');
  } else {
    console.log(`\n✗ FAIL — ${totalFailures} issue(s) found\n`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error('Validation failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await queryClient.end();
  });
