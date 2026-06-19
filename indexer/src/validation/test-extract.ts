import { readFile } from 'fs/promises';
import { resolve } from 'path';

async function run() {
  const filePath = resolve('./validation-report.json');
  const data = JSON.parse(await readFile(filePath, 'utf-8'));
  const trades = data.trades || [];

  const v2 = trades.filter((t: any) => t.dex === 'pancakeswap-v2');
  const v3 = trades.filter((t: any) => t.dex === 'pancakeswap-v3');
  const v4 = trades.filter((t: any) => t.dex === 'pancakeswap-v4');

  console.log(`Total trades in report: ${trades.length}`);
  console.log(`V2 count: ${v2.length}`);
  console.log(`V3 count: ${v3.length}`);
  console.log(`V4 count: ${v4.length}`);

  console.log('\n--- FIRST 10 V2 TRADES ---');
  v2.slice(0, 10).forEach((t: any, i: number) => {
    console.log(`${i + 1}. Tx: ${t.txHash}, Wallet: ${t.wallet}, TokenIn: ${t.tokenInSym} (${t.amountInHuman}), TokenOut: ${t.tokenOutSym} (${t.amountOutHuman})`);
  });

  console.log('\n--- FIRST 10 V3 TRADES ---');
  v3.slice(0, 10).forEach((t: any, i: number) => {
    console.log(`${i + 1}. Tx: ${t.txHash}, Wallet: ${t.wallet}, TokenIn: ${t.tokenInSym} (${t.amountInHuman}), TokenOut: ${t.tokenOutSym} (${t.amountOutHuman})`);
  });

  console.log('\n--- FIRST 10 V4 TRADES ---');
  v4.slice(0, 10).forEach((t: any, i: number) => {
    console.log(`${i + 1}. Tx: ${t.txHash}, Wallet: ${t.wallet}, TokenIn: ${t.tokenInSym} (${t.amountInHuman}), TokenOut: ${t.tokenOutSym} (${t.amountOutHuman})`);
  });
}

run().catch(console.error);
