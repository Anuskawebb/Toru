import 'dotenv/config';
import { inspectTransaction } from './debug/tx-inspector.js';

// Accept tx hash from CLI arg or env var:
//   pnpm run debug 0x...
//   TX_HASH=0x... pnpm run debug
const raw = process.argv[2] ?? process.env['TX_HASH'];

if (raw === undefined || raw === '') {
  process.stderr.write(
    'Usage:\n' +
    '  pnpm run debug 0x<txHash>\n' +
    '  TX_HASH=0x<txHash> pnpm run debug\n',
  );
  process.exit(1);
}

if (!raw.startsWith('0x')) {
  process.stderr.write(`Error: tx hash must start with 0x — got: ${raw}\n`);
  process.exit(1);
}

await inspectTransaction(raw as `0x${string}`);
