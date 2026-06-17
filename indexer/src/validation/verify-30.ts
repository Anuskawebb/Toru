import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { bscClient } from '../chains/bsc.js';
import { decodeEventLog } from 'viem';

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

interface ExpectedTrade {
  index: string;
  txHash: string;
  wallet: string;
  soldAmount: number;
  soldToken: string;
  boughtAmount: number;
  boughtToken: string;
  startIndex: number; // position in file to rewrite
}

async function run() {
  const summaryPath = resolve('./audit-summary.txt');
  const summaryContent = await readFile(summaryPath, 'utf-8');

  // Let's parse audit-summary.txt to extract expected trades
  const lines = summaryContent.split('\n');
  const expectedTrades: ExpectedTrade[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    const txMatch = line.match(/\[(\d+)\] https:\/\/bscscan\.com\/tx\/(0x[a-fA-F0-9]{64})/);
    if (txMatch) {
      const index = txMatch[1];
      const txHash = txMatch[2];
      if (index === undefined || txHash === undefined) continue;
      
      // Look ahead for Wallet, Sold, Bought
      let wallet = '';
      let soldAmount = 0;
      let soldToken = '';
      let boughtAmount = 0;
      let boughtToken = '';
 
      for (let j = 1; j <= 5; j++) {
        const nextLine = lines[i + j];
        if (!nextLine) continue;
 
        if (nextLine.includes('Wallet:')) {
          const m = nextLine.match(/Wallet:\s+(0x[a-fA-F0-9]{40})/);
          if (m && m[1] !== undefined) wallet = m[1].toLowerCase();
        }
        if (nextLine.includes('Sold:')) {
          const m = nextLine.match(/Sold:\s+([\d\.]+)\s+(\S+)\s+\((0x[a-fA-F0-9]{40})\)/);
          if (m && m[1] !== undefined && m[3] !== undefined) {
            soldAmount = parseFloat(m[1]);
            soldToken = m[3].toLowerCase();
          }
        }
        if (nextLine.includes('Bought:')) {
          const m = nextLine.match(/Bought:\s+([\d\.]+)\s+(\S+)\s+\((0x[a-fA-F0-9]{40})\)/);
          if (m && m[1] !== undefined && m[3] !== undefined) {
            boughtAmount = parseFloat(m[1]);
            boughtToken = m[3].toLowerCase();
          }
        }
      }
 
      expectedTrades.push({
        index,
        txHash,
        wallet,
        soldAmount,
        soldToken,
        boughtAmount,
        boughtToken,
        startIndex: i,
      });
    }
  }

  console.log(`Parsed ${expectedTrades.length} trades from audit-summary.txt`);

  // Let's query RPC and verify each trade
  // We will build a map of verification results for each txHash to update the file
  const verificationMap = new Map<string, { wallet: boolean; sent: boolean; recv: boolean; logs: string[] }>();

  const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';

  for (const expected of expectedTrades) {
    console.log(`Verifying trade ${expected.index} on tx ${expected.txHash}...`);
    const logs: string[] = [];
    let walletOk = false;
    let sentOk = false;
    let recvOk = false;

    try {
      const tx = await bscClient.getTransaction({ hash: expected.txHash as `0x${string}` });
      const receipt = await bscClient.getTransactionReceipt({ hash: expected.txHash as `0x${string}` });

      const txFrom = tx.from.toLowerCase();
      const txValue = BigInt(tx.value);

      // 1. Wallet Attribution
      if (txFrom === expected.wallet) {
        walletOk = true;
      } else {
        logs.push(`wallet mismatch: expected ${expected.wallet}, observed tx.from ${txFrom}`);
      }

      // Find all BEP-20 transfers
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
            // ignore
          }
        }
      }

      // 2. Sent Token and Amount
      let observedSentAmount = 0n;
      if (expected.soldToken === WBNB && txValue > 0n) {
        observedSentAmount = txValue;
        sentOk = true;
      } else {
        const matchingTransfers = transfers.filter(
          (t) => t.token === expected.soldToken && t.from === expected.wallet
        );
        if (matchingTransfers.length > 0) {
          observedSentAmount = matchingTransfers.reduce((acc, t) => acc + BigInt(t.value), 0n);
          sentOk = true;
        } else {
          // Check if any asset left
          const left = transfers.filter(t => t.from === expected.wallet);
          logs.push(`sent token mismatch: expected ${expected.soldToken}, but wallet sent: ${left.map(l => `${l.token}: ${l.value}`).join(', ') || 'nothing'}`);
        }
      }

      if (sentOk) {
        // Since we have decimal amount, we need to compare human readable or estimate precision
        // Let's check token decimals. Usually it is 18, but could be 9 or 6.
        // Let's assume standard ERC20 decimals or check dynamically if possible, or just compare float ratio
        // We'll query decimals of the token. Let's do standard JSON-RPC query for decimals.
        let decimals = 18;
        try {
          const res = await bscClient.readContract({
            address: expected.soldToken as `0x${string}`,
            abi: [{ name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }] }],
            functionName: 'decimals',
          });
          decimals = Number(res);
        } catch {
          // default to 18
        }

        const observedHuman = Number(observedSentAmount) / Math.pow(10, decimals);
        const ratio = observedHuman / expected.soldAmount;
        if (ratio > 0.99 && ratio < 1.01) {
          sentOk = true;
        } else {
          sentOk = false;
          logs.push(`sent amount mismatch: expected ${expected.soldAmount}, observed ${observedHuman} (decimals=${decimals})`);
        }
      }

      // 3. Received Token and Amount
      let observedRecvAmount = 0n;
      const matchingRecvTransfers = transfers.filter(
        (t) => t.token === expected.boughtToken && t.to === expected.wallet
      );
      if (matchingRecvTransfers.length > 0) {
        observedRecvAmount = matchingRecvTransfers.reduce((acc, t) => acc + BigInt(t.value), 0n);
        recvOk = true;
      } else if (expected.boughtToken === WBNB && transfers.some(t => t.token === WBNB && t.to === expected.wallet)) {
        const wbnbRecv = transfers.filter(t => t.token === WBNB && t.to === expected.wallet);
        observedRecvAmount = wbnbRecv.reduce((acc, t) => acc + BigInt(t.value), 0n);
        recvOk = true;
      } else {
        const received = transfers.filter(t => t.to === expected.wallet);
        logs.push(`received token mismatch: expected ${expected.boughtToken}, but wallet received: ${received.map(r => `${r.token}: ${r.value}`).join(', ') || 'nothing'}`);
      }

      if (recvOk) {
        let decimals = 18;
        try {
          const res = await bscClient.readContract({
            address: expected.boughtToken as `0x${string}`,
            abi: [{ name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }] }],
            functionName: 'decimals',
          });
          decimals = Number(res);
        } catch {
          // default to 18
        }

        const observedHuman = Number(observedRecvAmount) / Math.pow(10, decimals);
        const ratio = observedHuman / expected.boughtAmount;
        if (ratio > 0.99 && ratio < 1.01) {
          recvOk = true;
        } else {
          recvOk = false;
          logs.push(`received amount mismatch: expected ${expected.boughtAmount}, observed ${observedHuman} (decimals=${decimals})`);
        }
      }

    } catch (err: any) {
      logs.push(`RPC error: ${err.message || String(err)}`);
    }

    verificationMap.set(expected.txHash, {
      wallet: walletOk,
      sent: sentOk,
      recv: recvOk,
      logs,
    });
  }

  // Now rewrite audit-summary.txt ticking off the checks
  const updatedLines = [...lines];

  for (const expected of expectedTrades) {
    const res = verificationMap.get(expected.txHash);
    if (!res) continue;

    // We look ahead from expected.startIndex to find the check list lines:
    // [ ] From:
    // [ ] Token sent:
    // [ ] Token received:
    // We want to replace "[ ]" with "[x]" if true, or keep "[ ]" / add "[FAIL]" if false
    for (let j = 1; j <= 12; j++) {
      const idx = expected.startIndex + j;
      const line = updatedLines[idx];
      if (!line) continue;

      if (line.includes('From:')) {
        updatedLines[idx] = line.replace('[ ]', res.wallet ? '[x]' : '[FAIL]');
      }
      if (line.includes('Token sent:')) {
        updatedLines[idx] = line.replace('[ ]', res.sent ? '[x]' : '[FAIL]');
      }
      if (line.includes('Token received:')) {
        updatedLines[idx] = line.replace('[ ]', res.recv ? '[x]' : '[FAIL]');
      }
    }
  }

  await writeFile(summaryPath, updatedLines.join('\n'), 'utf-8');
  console.log(`Updated audit-summary.txt with verification results!`);

  // Write verification log
  let logOutput = '';
  for (const expected of expectedTrades) {
    const res = verificationMap.get(expected.txHash);
    if (!res) continue;
    logOutput += `Trade ${expected.index} (Tx: ${expected.txHash}):\n`;
    logOutput += `  Wallet: ${res.wallet ? 'PASS' : 'FAIL'}\n`;
    logOutput += `  TokenSent: ${res.sent ? 'PASS' : 'FAIL'}\n`;
    logOutput += `  TokenRecv: ${res.recv ? 'PASS' : 'FAIL'}\n`;
    if (res.logs.length > 0) {
      logOutput += `  Details:\n${res.logs.map(l => `    - ${l}`).join('\n')}\n`;
    }
    logOutput += '\n';
  }
  await writeFile('./src/validation/verification-details.log', logOutput, 'utf-8');
  console.log('Saved detailed logs to ./src/validation/verification-details.log');
}

run().catch(console.error);
