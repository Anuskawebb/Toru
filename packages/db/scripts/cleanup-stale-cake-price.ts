import { queryClient } from '../src/client.js';

const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';

async function main() {
  const res = await queryClient`DELETE FROM token_prices WHERE token_address = ${CAKE}`;
  console.log('Deleted CAKE from token_prices, rows affected:', res.count);
  const tp = await queryClient`SELECT token_address, price_usd FROM token_prices`;
  console.log('Remaining token_prices:', JSON.stringify(tp));
  await queryClient.end();
}
main().catch(e => { console.error(e); process.exit(1); });
