/**
 * One-time cleanup: remove orphaned mock token rows from token_metrics
 * that were left over from previous validation runs.
 *
 * Safe to run multiple times (idempotent).
 */
import { db, queryClient } from '../src/client.js';

async function main() {
  const MOCK_ADDRESSES = [
    '0x1111111111111111111111111111111111111111', // TKN_A (valuation-layer)
    '0x2222222222222222222222222222222222222222', // TKN_B
    '0x3333333333333333333333333333333333333333', // TKN_C
    '0x4444444444444444444444444444444444444444', // TKN_D
    '0x5555555555555555555555555555555555555555', // TKN_E
  ];

  // Only delete if no real trades exist for these addresses
  for (const addr of MOCK_ADDRESSES) {
    const tradeCheck = await queryClient`
      SELECT COUNT(*)::int as c FROM trades
      WHERE token_in_address = ${addr} OR token_out_address = ${addr}
    `;
    const tradeCount = Number(tradeCheck[0].c);
    if (tradeCount === 0) {
      const res = await queryClient`
        DELETE FROM token_metrics WHERE token_address = ${addr}
      `;
      console.log(`Deleted orphan ${addr} from token_metrics (${res.count} row)`);
    } else {
      console.log(`Skipping ${addr} — has ${tradeCount} real trades, not orphaned`);
    }
  }

  const countRes = await queryClient`SELECT COUNT(*)::int as c FROM token_metrics`;
  console.log(`token_metrics count after cleanup: ${countRes[0].c}`);

  await queryClient.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
