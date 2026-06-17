import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { bscClient } from '../chains/bsc.js';
import { decodeEventLog } from 'viem';

// ERC20 Transfer Event ABI
const erc20TransferAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' }
    ],
    name: 'Transfer',
    type: 'event'
  }
];

async function run() {
  const filePath = resolve('./validation-report.json');
  const data = JSON.parse(await readFile(filePath, 'utf-8'));
  const trades = data.trades || [];

  const v2 = trades.filter((t: any) => t.dex === 'pancakeswap-v2').slice(0, 10);
  const v3 = trades.filter((t: any) => t.dex === 'pancakeswap-v3').slice(0, 10);
  const v4 = trades.filter((t: any) => t.dex === 'pancakeswap-v4').slice(0, 10);

  const selectedTrades = [...v2, ...v3, ...v4];

  console.log(`Auditing ${selectedTrades.length} trades total...`);

  const results: any[] = [];

  for (const trade of selectedTrades) {
    console.log(`\nFetching ${trade.dex} transaction: ${trade.txHash}...`);
    try {
      const tx = await bscClient.getTransaction({ hash: trade.txHash });
      const receipt = await bscClient.getTransactionReceipt({ hash: trade.txHash });

      // Find all ERC20 transfer events
      const transfers: any[] = [];
      for (const log of receipt.logs) {
        if (
          log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
          log.topics.length === 3
        ) {
          try {
            const decoded = decodeEventLog({
              abi: erc20TransferAbi,
              data: log.data,
              topics: log.topics,
            });
            transfers.push({
              token: log.address.toLowerCase(),
              from: (decoded.args as any).from.toLowerCase(),
              to: (decoded.args as any).to.toLowerCase(),
              value: (decoded.args as any).value,
            });
          } catch (e) {
            // ignore malformed transfer events
          }
        }
      }

      results.push({
        trade,
        tx: {
          from: tx.from.toLowerCase(),
          to: tx.to?.toLowerCase(),
          value: tx.value,
        },
        transfers,
      });
    } catch (err) {
      console.error(`Failed to fetch/parse tx ${trade.txHash}:`, err);
    }
  }

  // Save detailed results to a file for analysis
  await writeFile(
    './src/validation/audit-details.json',
    JSON.stringify(
      results,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    ),
    'utf-8'
  );
  console.log('Saved audit details to ./src/validation/audit-details.json');
}

import { writeFile } from 'fs/promises';
run().catch(console.error);
