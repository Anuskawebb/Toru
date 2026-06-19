import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  const [trades, tokens, queue] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) AS n FROM trades`),
    db.execute(sql`SELECT COUNT(*) AS n FROM tokens`),
    db.execute(sql`SELECT COUNT(*) AS n FROM token_discovery_queue`),
  ]);
  const row = (r: any) => (r as any).rows?.[0] ?? (r as any)[0];
  console.log(`trades:  ${row(trades).n}`);
  console.log(`tokens:  ${row(tokens).n}`);
  console.log(`queue:   ${row(queue).n}`);
  await queryClient.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
