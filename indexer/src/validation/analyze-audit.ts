import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

interface Trade {
  txHash: string;
  block: string;
  timestamp: string;
  wallet: string;
  dex: string;
  tokenIn: string;
  tokenInSym: string;
  amountIn: string;
  amountInHuman: string;
  tokenOut: string;
  tokenOutSym: string;
  amountOut: string;
  amountOutHuman: string;
  bscscan: string;
  flags: string[];
}

interface Tx {
  from: string;
  to: string | null;
  value: string;
}

interface Transfer {
  token: string;
  from: string;
  to: string;
  value: string;
}

interface AuditItem {
  trade: Trade;
  tx: Tx;
  transfers: Transfer[];
}

// Router addresses to check if they were incorrectly identified as user wallets
const ROUTER_ADDRESSES = [
  '0x10ed43c718714eb63d5aa57b78b54704e256024e', // PancakeSwap V2 Router
  '0x1b81d678ffb9c17d45619b1b7efc62a3ae124a6a', // PancakeSwap V3 Router
  '0x40a1fe393a7f566f27df6ace18e6773be844dafc', // V3 Router/Universal Router?
  '0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b', // V4 Vault/Pool Manager?
  '0x13398e87d373e5dc79391e60f09a8e9e14444444', // other routers
  // We should also check if the wallet is a pool address, which typically matches trade.pairAddress or other contracts
];

// Helper to determine if a wallet address is a pool or contract (usually by looking if it's the sender of the tx)
// The user wallet should always be the transaction.from (the sender), unless it's a gasless txn or meta-txn (rare on BSC for typical DEX trades)
// The prompt says: trade.wallet == transaction.from
// If wallet is not transaction.from, it could be a pool/router used as wallet.

async function run() {
  const detailsPath = resolve('./src/validation/audit-details.json');
  const auditData: AuditItem[] = JSON.parse(await readFile(detailsPath, 'utf-8'));

  const reports: Record<string, string[]> = {
    'pancakeswap-v2': [],
    'pancakeswap-v3': [],
    'pancakeswap-v4': [],
  };

  const summaries: Record<string, { pass: number; fail: number; details: string[] }> = {
    'pancakeswap-v2': { pass: 0, fail: 0, details: [] },
    'pancakeswap-v3': { pass: 0, fail: 0, details: [] },
    'pancakeswap-v4': { pass: 0, fail: 0, details: [] },
  };

  const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';

  for (const item of auditData) {
    const { trade, tx, transfers } = item;
    const dex = trade.dex;
    const txHash = trade.txHash;
    const wallet = trade.wallet.toLowerCase();
    const txFrom = tx.from.toLowerCase();

    const checkResults = {
      wallet: 'FAIL',
      tokenIn: 'FAIL',
      tokenOut: 'FAIL',
      amountIn: 'FAIL',
      amountOut: 'FAIL',
      reason: [] as string[],
    };

    // A. Wallet Attribution
    if (wallet === txFrom) {
      checkResults.wallet = 'PASS';
    } else {
      checkResults.reason.push(`wallet attribution mismatch: trade.wallet (${wallet}) !== tx.from (${txFrom})`);
    }

    // Check if wallet is a router or pool address
    if (ROUTER_ADDRESSES.includes(wallet)) {
      checkResults.wallet = 'FAIL';
      checkResults.reason.push(`router used as wallet: ${wallet}`);
    }

    // B. Token In and Amount In
    // We look for assets leaving the wallet.
    // If the tokenIn is WBNB and tx.value > 0, the user is sending native BNB as amountIn.
    const isWBNB = trade.tokenIn.toLowerCase() === WBNB;
    const txValue = BigInt(tx.value);
    
    // Find transfers of trade.tokenIn leaving the wallet
    const tokenInTransfers = transfers.filter(
      (t) => t.token === trade.tokenIn.toLowerCase() && t.from === wallet
    );
    
    let observedAmountIn = 0n;
    if (isWBNB && txValue > 0n) {
      observedAmountIn = txValue;
      checkResults.tokenIn = 'PASS';
    } else if (tokenInTransfers.length > 0) {
      observedAmountIn = tokenInTransfers.reduce((acc, t) => acc + BigInt(t.value), 0n);
      checkResults.tokenIn = 'PASS';
    } else {
      // Let's look at any asset leaving the wallet to see what it is
      const leavingAssets = transfers.filter((t) => t.from === wallet);
      if (leavingAssets.length > 0) {
        const uniqueLeavingTokens = Array.from(new Set(leavingAssets.map((t) => t.token)));
        checkResults.reason.push(
          `tokenIn mismatch: trade.tokenIn is ${trade.tokenInSym} (${trade.tokenIn}), but leaving asset(s) are: ${uniqueLeavingTokens.join(', ')}`
        );
      } else if (txValue > 0n) {
        checkResults.reason.push(
          `tokenIn mismatch: trade.tokenIn is ${trade.tokenInSym} (${trade.tokenIn}), but native BNB leaving wallet instead`
        );
      } else {
        checkResults.reason.push(`tokenIn mismatch: no asset leaving wallet detected`);
      }
    }

    // Verify Amount In (approximate match)
    if (checkResults.tokenIn === 'PASS') {
      const expectedAmountIn = BigInt(trade.amountIn);
      const diff = observedAmountIn > expectedAmountIn ? observedAmountIn - expectedAmountIn : expectedAmountIn - observedAmountIn;
      // Allow 1% difference or very small rounding
      const maxDiff = expectedAmountIn / 100n; // 1%
      if (diff <= maxDiff || diff < 1000000n) { // allow very small absolute difference for dust
        checkResults.amountIn = 'PASS';
      } else {
        checkResults.reason.push(
          `amountIn mismatch: trade.amountIn is ${trade.amountIn} (${trade.amountInHuman}), but BscScan observed leaving ${observedAmountIn.toString()}`
        );
      }
    }

    // C. Token Out and Amount Out
    // We look for assets received by the wallet (to === wallet)
    const tokenOutTransfers = transfers.filter(
      (t) => t.token === trade.tokenOut.toLowerCase() && t.to === wallet
    );

    let observedAmountOut = 0n;
    if (trade.tokenOut.toLowerCase() === WBNB && transfers.some(t => t.token === WBNB && t.to === wallet)) {
      // Sometimes BNB is received (but usually it is wrapped as WBNB or unwrapped).
      // If the trade.tokenOut is WBNB and WBNB was transferred to the wallet, it's correct.
      const wbnbTransfers = transfers.filter(t => t.token === WBNB && t.to === wallet);
      observedAmountOut = wbnbTransfers.reduce((acc, t) => acc + BigInt(t.value), 0n);
      checkResults.tokenOut = 'PASS';
    } else if (tokenOutTransfers.length > 0) {
      observedAmountOut = tokenOutTransfers.reduce((acc, t) => acc + BigInt(t.value), 0n);
      checkResults.tokenOut = 'PASS';
    } else {
      // Let's look at any asset entering the wallet
      const enteringAssets = transfers.filter((t) => t.to === wallet);
      if (enteringAssets.length > 0) {
        const uniqueEnteringTokens = Array.from(new Set(enteringAssets.map((t) => t.token)));
        checkResults.reason.push(
          `tokenOut mismatch: trade.tokenOut is ${trade.tokenOutSym} (${trade.tokenOut}), but received asset(s) are: ${uniqueEnteringTokens.join(', ')}`
        );
      } else {
        checkResults.reason.push(`tokenOut mismatch: no asset received by wallet detected`);
      }
    }

    // Verify Amount Out (approximate match)
    if (checkResults.tokenOut === 'PASS') {
      const expectedAmountOut = BigInt(trade.amountOut);
      const diff = observedAmountOut > expectedAmountOut ? observedAmountOut - expectedAmountOut : expectedAmountOut - observedAmountOut;
      const maxDiff = expectedAmountOut / 100n; // 1%
      if (diff <= maxDiff || diff < 1000000n) {
        checkResults.amountOut = 'PASS';
      } else {
        checkResults.reason.push(
          `amountOut mismatch: trade.amountOut is ${trade.amountOut} (${trade.amountOutHuman}), but BscScan observed received ${observedAmountOut.toString()}`
        );
      }
    }

    // Overall check status
    const isPass = 
      checkResults.wallet === 'PASS' &&
      checkResults.tokenIn === 'PASS' &&
      checkResults.tokenOut === 'PASS' &&
      checkResults.amountIn === 'PASS' &&
      checkResults.amountOut === 'PASS';

    let blockText = '';
    if (isPass) {
      summaries[dex]!.pass++;
      blockText = `[PASS]
txHash: ${txHash}
wallet: correct
tokenIn: correct
tokenOut: correct
amountIn: correct
amountOut: correct`;
    } else {
      summaries[dex]!.fail++;
      const reasonStr = checkResults.reason.join(', ');
      summaries[dex]!.details.push(`Tx: ${txHash}\nReason: ${reasonStr}`);
      blockText = `[FAIL]
txHash: ${txHash}
reason: ${reasonStr}`;
    }

    reports[dex]!.push(blockText);
  }

  // Generate output report
  let output = '';
  
  for (const version of ['pancakeswap-v2', 'pancakeswap-v3', 'pancakeswap-v4']) {
    const title = version === 'pancakeswap-v2' ? 'PancakeSwap V2' : version === 'pancakeswap-v3' ? 'PancakeSwap V3' : 'PancakeSwap V4';
    output += `# ${title}\n\n`;
    output += reports[version]!.join('\n\n') + '\n\n';
  }

  const v2Pass = summaries['pancakeswap-v2']!.pass;
  const v2Fail = summaries['pancakeswap-v2']!.fail;
  const v3Pass = summaries['pancakeswap-v3']!.pass;
  const v3Fail = summaries['pancakeswap-v3']!.fail;
  const v4Pass = summaries['pancakeswap-v4']!.pass;
  const v4Fail = summaries['pancakeswap-v4']!.fail;
  
  const totalAudited = v2Pass + v2Fail + v3Pass + v3Fail + v4Pass + v4Fail;
  const totalPass = v2Pass + v3Pass + v4Pass;
  const accuracy = (totalPass / totalAudited) * 100;

  output += `## FINAL SUMMARY\n\n`;
  output += `Total Audited: ${totalAudited}\n\n`;
  output += `V2:\nPass: ${v2Pass}\nFail: ${v2Fail}\n\n`;
  output += `V3:\nPass: ${v3Pass}\nFail: ${v3Fail}\n\n`;
  output += `V4:\nPass: ${v4Pass}\nFail: ${v4Fail}\n\n`;
  output += `Overall Accuracy:\n${accuracy.toFixed(1)}%\n\n`;

  output += `List of failed transactions:\n`;
  const allFails = [
    ...summaries['pancakeswap-v2']!.details.map(d => `[V2] ${d}`),
    ...summaries['pancakeswap-v3']!.details.map(d => `[V3] ${d}`),
    ...summaries['pancakeswap-v4']!.details.map(d => `[V4] ${d}`),
  ];
  
  if (allFails.length > 0) {
    output += allFails.map(f => `- ${f}`).join('\n') + '\n';
  } else {
    output += `None (100% Pass)\n`;
  }

  await writeFile('./src/validation/audit-results-draft.txt', output, 'utf-8');
  console.log('Saved draft report to ./src/validation/audit-results-draft.txt');
  console.log(output);
}

run().catch(console.error);
