import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  // Sample 20 real trades (exclude smoke test tx)
  const sample = await db.execute(sql`
    SELECT tx_hash, wallet, token_in_address, token_out_address,
           pair_address, log_index, token_in_decimals, token_out_decimals, dex
    FROM trades
    WHERE tx_hash != '0x1111111111111111111111111111111111111111111111111111111111111111'
    LIMIT 20
  `);
  const rows: any[] = (sample as any).rows ?? (sample as any);

  // Violations tracker
  let walletMixed = 0, tokenInMixed = 0, tokenOutMixed = 0, pairMixed = 0;
  let txHashMixed = 0, logIndexNull = 0, decimalsNull = 0;

  for (const r of rows) {
    if (r.wallet !== r.wallet.toLowerCase()) walletMixed++;
    if (r.token_in_address !== r.token_in_address.toLowerCase()) tokenInMixed++;
    if (r.token_out_address !== r.token_out_address.toLowerCase()) tokenOutMixed++;
    if (r.pair_address && r.pair_address !== r.pair_address.toLowerCase()) pairMixed++;
    if (r.tx_hash !== r.tx_hash.toLowerCase()) txHashMixed++;
    if (r.log_index === null || r.log_index === undefined) logIndexNull++;
    if (r.token_in_decimals === null || r.token_out_decimals === null) decimalsNull++;
  }

  console.log(`\nSample size: ${rows.length} rows\n`);
  console.log('=== Normalization ===');
  console.log(`wallet mixed-case violations:        ${walletMixed}`);
  console.log(`token_in_address mixed-case:         ${tokenInMixed}`);
  console.log(`token_out_address mixed-case:        ${tokenOutMixed}`);
  console.log(`pair_address mixed-case:             ${pairMixed}`);
  console.log(`tx_hash mixed-case:                  ${txHashMixed}`);
  console.log('\n=== Field population ===');
  console.log(`log_index NULL:                      ${logIndexNull}`);
  console.log(`token_in/out_decimals NULL:          ${decimalsNull}`);

  // Full-table violation scan
  const violations = await db.execute(sql`
    SELECT
      SUM(CASE WHEN wallet != LOWER(wallet) THEN 1 ELSE 0 END) AS wallet_mixed,
      SUM(CASE WHEN token_in_address != LOWER(token_in_address) THEN 1 ELSE 0 END) AS token_in_mixed,
      SUM(CASE WHEN token_out_address != LOWER(token_out_address) THEN 1 ELSE 0 END) AS token_out_mixed,
      SUM(CASE WHEN pair_address IS NOT NULL AND pair_address != LOWER(pair_address) THEN 1 ELSE 0 END) AS pair_mixed,
      SUM(CASE WHEN log_index IS NULL THEN 1 ELSE 0 END) AS log_index_null,
      SUM(CASE WHEN token_in_decimals IS NULL OR token_out_decimals IS NULL THEN 1 ELSE 0 END) AS decimals_null,
      COUNT(*) AS total
    FROM trades
    WHERE tx_hash != '0x1111111111111111111111111111111111111111111111111111111111111111'
  `);
  const v: any = ((violations as any).rows ?? violations as any)[0];
  console.log('\n=== Full-table scan ===');
  console.log(`Total trades scanned:  ${v.total}`);
  console.log(`wallet mixed-case:     ${v.wallet_mixed}`);
  console.log(`token_in mixed-case:   ${v.token_in_mixed}`);
  console.log(`token_out mixed-case:  ${v.token_out_mixed}`);
  console.log(`pair mixed-case:       ${v.pair_mixed}`);
  console.log(`log_index NULL:        ${v.log_index_null}`);
  console.log(`decimals NULL:         ${v.decimals_null}`);

  // Decimals distribution
  const decs = await db.execute(sql`
    SELECT token_in_decimals, COUNT(*) AS n
    FROM trades
    WHERE tx_hash != '0x1111111111111111111111111111111111111111111111111111111111111111'
    GROUP BY token_in_decimals ORDER BY n DESC LIMIT 8
  `);
  console.log('\n=== token_in_decimals distribution ===');
  for (const r of ((decs as any).rows ?? decs as any) as any[]) {
    console.log(`  decimals=${r.token_in_decimals}: ${r.n} trades`);
  }

  // Log index range
  const lidx = await db.execute(sql`
    SELECT MIN(log_index) AS mn, MAX(log_index) AS mx, AVG(log_index)::int AS avg
    FROM trades
    WHERE tx_hash != '0x1111111111111111111111111111111111111111111111111111111111111111'
  `);
  const li: any = ((lidx as any).rows ?? lidx as any)[0];
  console.log(`\nlog_index range: ${li.mn} – ${li.mx}  (avg ${li.avg})`);

  await queryClient.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
