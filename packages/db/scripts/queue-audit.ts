import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  // Sample 50 queue entries
  const sample = await db.execute(sql`
    SELECT address, attempts, resolved, first_seen_at, last_attempted_at
    FROM token_discovery_queue
    ORDER BY first_seen_at DESC
    LIMIT 50
  `);
  const rows: any[] = (sample as any).rows ?? (sample as any);

  let addrMixed = 0, duplicateCheck = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.address !== r.address.toLowerCase()) addrMixed++;
    if (seen.has(r.address)) duplicateCheck++;
    seen.add(r.address);
  }

  console.log(`\nSample: ${rows.length} queue entries (most recent)`);
  console.log(`Mixed-case addresses:  ${addrMixed}`);
  console.log(`Duplicate addresses:   ${duplicateCheck}`);

  // Full stats
  const stats = await db.execute(sql`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN resolved = true THEN 1 ELSE 0 END) AS resolved_count,
      SUM(CASE WHEN resolved = false THEN 1 ELSE 0 END) AS unresolved_count,
      SUM(CASE WHEN attempts = 0 THEN 1 ELSE 0 END) AS zero_attempts,
      MIN(attempts) AS min_attempts,
      MAX(attempts) AS max_attempts,
      AVG(attempts)::numeric(5,2) AS avg_attempts
    FROM token_discovery_queue
  `);
  const s: any = ((stats as any).rows ?? stats as any)[0];
  console.log('\n=== Queue stats ===');
  console.log(`total:          ${s.total}`);
  console.log(`resolved:       ${s.resolved_count}`);
  console.log(`unresolved:     ${s.unresolved_count}`);
  console.log(`zero attempts:  ${s.zero_attempts}`);
  console.log(`attempts range: ${s.min_attempts} – ${s.max_attempts}  (avg ${s.avg_attempts})`);

  // Confirm no duplicates in entire table
  const dupCheck = await db.execute(sql`
    SELECT COUNT(*) AS total, COUNT(DISTINCT address) AS unique_addrs
    FROM token_discovery_queue
  `);
  const d: any = ((dupCheck as any).rows ?? dupCheck as any)[0];
  console.log(`\nTotal rows: ${d.total}  |  Unique addresses: ${d.unique_addrs}`);
  console.log(d.total === d.unique_addrs
    ? '✓ No duplicate queue entries'
    : `✗ ${d.total - d.unique_addrs} duplicates found`);

  await queryClient.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
