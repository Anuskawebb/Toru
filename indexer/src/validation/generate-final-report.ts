import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

interface Trade {
  txHash: string;
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

const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';

const EXPLANATIONS: Record<string, string> = {
  // V2 Fails
  '0xe8c05f749e5edaea9824a577a8fc6b16be8677c36fea7700a861a3cb7f3cdd56': 
    'amountIn mismatch. The indexer parsed 0.495 WBNB as amountIn (matching the pool Swap event). However, BscScan shows 0.50 BNB left the user\'s wallet. The 1% difference was taken as a fee/tax by the custom router/tax contract (0x1de460f363af910f51726def188f9004276bf4bc) before the remaining funds were sent to the PancakeSwap pool.',
  
  '0x0d14e0007172627e5e566e8e85e6fcc5334d0c0cac05f6c70b739fc7cddfba47': 
    'amountIn mismatch. The indexer parsed 0.099 WBNB as amountIn (matching the pool Swap event). However, BscScan shows 0.10 BNB left the user\'s wallet. The 1% difference was taken as a fee/tax by the custom router/tax contract (0x1de460f363af910f51726def188f9004276bf4bc) before the remaining funds were sent to the PancakeSwap pool.',
  
  '0x2c00fa8285f2c221fb6c01adce3e91d401e909c131249b57354931d7eb79d091': 
    'amountOut mismatch. The indexer parsed 1.551606 GTS as amountOut (the gross pool output). However, BscScan shows the user\'s wallet only received 1.505058 GTS. The difference (~3%) is due to token transfer fee/burn of the GTS token, where a portion was burned to the dead address (0x000...dead) and a portion was sent to the pool, resulting in a lower amount entering the user\'s wallet.',
  
  '0xd3d4f20037acd9d07bed3a6a949bf548d67863125f088e6682b69501bcce3bf5': 
    'tokenIn and tokenOut mismatch. The indexer parsed a trade of MCoin to WMAI. However, BscScan shows zero tokens left the user\'s wallet (MCoin was minted from 0x000 directly to the staking/interaction contract 0x1f40465dce9a07a5273b4b63f5f9c31ff2bcbd9a). Additionally, the user received token 0x35803e77c3163fed8a942536c1c8e0d5bf90f906 instead of WMAI (which was swapped and burned internally by the contract).',
  
  '0x29ef54563fcf099ce1ac1998f3c10dbbd540c935976e51d6593fd2fbae487226': 
    'tokenIn and tokenOut mismatch. The indexer parsed a trade of USDT to RE. However, BscScan shows no tokens left or entered the user\'s wallet. This is an arbitrage transaction executed entirely by a specialized contract (0x731cf4d2b356d24118557446c13ab798ec4e991f) with zero wallet-level token movement for the tx signer.',
  
  '0xaa630e0034853b9b9bb1a37e241951fe1182f5c907ce90d3958cc4e34d7699b2': 
    'tokenIn and amountOut mismatch. The indexer parsed a trade of NAS to USDT. However, BscScan shows no NAS tokens left the user\'s wallet directly (they were sent by the router/contract 0x90a762ae6572c023ec7f213b5ba64568854b171b). In addition, the user received 10.26 USDT, whereas the indexer parsed 17.1 USDT. A fee of 6.84 USDT (40% fee/tax) was diverted to address 0xdf40525b8b5d7e57d1a5099be928b524aa94f63b.',

  // V3 Fails
  '0xc61d10419674692a3c247e6f32f970e59d951a49ce370dc13eb4f9d4df0e3101': 
    'tokenIn and tokenOut mismatch. The indexer parsed a trade of AIOT to USDT. However, BscScan shows no tokens left or entered the user\'s wallet. This is an arbitrage transaction executed entirely by contract 0x59c26d4ae5b89a5b5844011fee22dd41c0a50cfa; no assets touched the EOA wallet.',
  
  '0xe556f8e5354451001b854db9e2bcfb5f8e33f16c5a8f73882caff29a3da9982d': 
    'tokenIn and tokenOut mismatch. The indexer parsed a trade of AIOT to USDT. However, BscScan shows no tokens left or entered the user\'s wallet. This is an arbitrage transaction executed entirely by contract 0x59c26d4ae5b89a5b5844011fee22dd41c0a50cfa; no assets touched the EOA wallet.',
  
  '0xad744e72ac3e4d776ef4b140b6bafa09096dcb89bdcf24c52649c5d4acd4eac5': 
    'tokenIn and tokenOut mismatch. The indexer parsed a trade of USDT to EVAA. However, BscScan shows no tokens left or entered the user\'s wallet. This is an arbitrage transaction executed entirely by contract 0x59c26d4ae5b89a5b5844011fee22dd41c0a50cfa; no assets touched the EOA wallet.',
  
  '0xdaddaf65d9decf3c396fe59221b5168474224ce264e852a9f304b1ddd50c24c5': 
    'tokenIn and tokenOut mismatch. The indexer parsed a trade of BUSD to WBNB. However, BscScan shows no tokens left or entered the user\'s wallet. This is an arbitrage transaction executed entirely by contract 0x59c26d4ae5b89a5b5844011fee22dd41c0a50cfa; no assets touched the EOA wallet.',
  
  '0xe642abc6b87bf6c61a4802819a84e598593056f31381b855db9dd8024eb1cc1c': 
    'tokenIn and tokenOut mismatch. The indexer parsed a trade of NEXUSX to USDT. However, BscScan shows no tokens left or entered the user\'s wallet. This is an arbitrage transaction executed entirely by contract 0x59c26d4ae5b89a5b5844011fee22dd41c0a50cfa; no assets touched the EOA wallet.',

  // V4 Fails (Arbitrage / bot trades without EOA wallet transfers)
  '0x81370118b43a2dab02d6d74eae9e1c2c1d0c388b8880dde86d9c2ae7583d0cfe': 
    'tokenIn and tokenOut mismatch. BscScan shows zero tokens left or entered the user\'s wallet. The swap of SPACE for USD1 occurred entirely between the contract 0x1e1ebf170bb49659297b09d9f80abfdc235a85e2 and the pool.',
  
  '0xbfc3251ad13bb3f1bc19d2c5a5dd4efe8415770bae6557b7ecde406b4c386b4b': 
    'tokenIn and tokenOut mismatch. BscScan shows zero tokens left or entered the user\'s wallet. The swap of Beat for USDT occurred entirely between the contract 0x278d858f05b94576c1e6f73285886876ff6ef8d2 and the pool.',
  
  '0x5406c2846e744583e177dd11210817a10a9b446358faf3ad671c419da1b542be': 
    'tokenIn and tokenOut mismatch. BscScan shows zero tokens left or entered the user\'s wallet. The swap of Beat for USDT occurred entirely between the contract 0x3b4945745608768f37de52f39874cb48ddfed762 and the pool.',
  
  '0x98a0cdff4611a391409a6e48eea2fc83a4ef32b02f5d7ce65fdbf9dbf3e90850': 
    'tokenIn and tokenOut mismatch. BscScan shows zero tokens left or entered the user\'s wallet. The swap of TRIA for USDT occurred entirely between the contract 0x3b4945745608768f37de52f39874cb48ddfed762 and the pool.',
  
  '0x1900863e368e093a33404b5a293c9ec4cc9a6da9d61184cf58b0f0a36ec2b3e8': 
    'tokenIn and tokenOut mismatch. BscScan shows zero tokens left or entered the user\'s wallet. The swap of DN for USDT occurred entirely between the contract 0x3b4945745608768f37de52f39874cb48ddfed762 and the pool.',
  
  '0x07f24138d462d6511922348635cfd45f6664a3549d8382389193e94cb65258cd': 
    'tokenIn and tokenOut mismatch. BscScan shows zero tokens left or entered the user\'s wallet. The swap of SPACE for USD1 occurred entirely between the contract 0x1e1ebf170bb49659297b09d9f80abfdc235a85e2 and the pool.',
  
  '0x876aa5e0a54774d3cc162a78fe4a2076be345625cad2535e611f265368420eb7': 
    'tokenIn and tokenOut mismatch. BscScan shows zero tokens left or entered the user\'s wallet. The swap of ROBO for USDC occurred entirely between the contract 0x3b4945745608768f37de52f39874cb48ddfed762 and the pool.',
  
  '0x8c5e4e0eee05be94a11efc476b25629eb2a320697e4e506056040d54a96d1d32': 
    'tokenIn and tokenOut mismatch. BscScan shows zero tokens left or entered the user\'s wallet. The swap of POWER for USDT occurred entirely between the contract 0x3b4945745608768f37de52f39874cb48ddfed762 and the pool.',
  
  '0x2465e38662d8ff30dfe71a79bb4433fe309706341983a155243b3015e46a67aa': 
    'tokenIn and tokenOut mismatch. BscScan shows zero tokens left or entered the user\'s wallet. The swap of USDT for CLO occurred entirely between the contract 0x60b97709d633dd4e0f0f44f6102fd50341c0afa6 and the pool (via intermediary 0x2087d8fe927966fee758ba5563fb8f2347180b7c).',
  
  '0x48a7cadb2eca2973ef5b1397fc735a87c1ef98248c4e302b953d7ae134691ff3': 
    'tokenIn and tokenOut mismatch. BscScan shows zero tokens left or entered the user\'s wallet. The swap of USDT for CLO occurred entirely between the contract 0x60b97709d633dd4e0f0f44f6102fd50341c0afa6 and the pool (via intermediary 0x2087d8fe927966fee758ba5563fb8f2347180b7c).'
};

async function run() {
  const filePath = resolve('./src/validation/audit-details.json');
  const auditData: AuditItem[] = JSON.parse(await readFile(filePath, 'utf-8'));

  const reports: Record<string, string[]> = {
    'pancakeswap-v2': [],
    'pancakeswap-v3': [],
    'pancakeswap-v4': [],
  };

  const summaries: Record<string, { pass: number; fail: number }> = {
    'pancakeswap-v2': { pass: 0, fail: 0 },
    'pancakeswap-v3': { pass: 0, fail: 0 },
    'pancakeswap-v4': { pass: 0, fail: 0 },
  };

  for (const item of auditData) {
    const { trade, tx, transfers } = item;
    const dex = trade.dex;
    const txHash = trade.txHash;
    const wallet = trade.wallet.toLowerCase();
    const txFrom = tx.from.toLowerCase();

    // Perform verification checks
    let walletCheck = 'PASS';
    let tokenInCheck = 'PASS';
    let tokenOutCheck = 'PASS';
    let amountInCheck = 'PASS';
    let amountOutCheck = 'PASS';
    
    const isWBNB = trade.tokenIn.toLowerCase() === WBNB;
    const txValue = BigInt(tx.value);
    
    // Check wallet attribution
    if (wallet !== txFrom) {
      walletCheck = 'FAIL';
    }

    // Check Token In
    const tokenInTransfers = transfers.filter(
      (t) => t.token === trade.tokenIn.toLowerCase() && t.from === wallet
    );
    let observedAmountIn = 0n;
    if (isWBNB && txValue > 0n) {
      observedAmountIn = txValue;
    } else if (tokenInTransfers.length > 0) {
      observedAmountIn = tokenInTransfers.reduce((acc, t) => acc + BigInt(t.value), 0n);
    } else {
      tokenInCheck = 'FAIL';
    }

    // Check Amount In
    if (tokenInCheck === 'PASS') {
      const expectedAmountIn = BigInt(trade.amountIn);
      const diff = observedAmountIn > expectedAmountIn ? observedAmountIn - expectedAmountIn : expectedAmountIn - observedAmountIn;
      const maxDiff = expectedAmountIn / 100n; // 1%
      if (diff > maxDiff && diff >= 1000000n) {
        amountInCheck = 'FAIL';
      }
    } else {
      amountInCheck = 'FAIL';
    }

    // Check Token Out
    const tokenOutTransfers = transfers.filter(
      (t) => t.token === trade.tokenOut.toLowerCase() && t.to === wallet
    );
    let observedAmountOut = 0n;
    if (trade.tokenOut.toLowerCase() === WBNB && transfers.some(t => t.token === WBNB && t.to === wallet)) {
      const wbnbTransfers = transfers.filter(t => t.token === WBNB && t.to === wallet);
      observedAmountOut = wbnbTransfers.reduce((acc, t) => acc + BigInt(t.value), 0n);
    } else if (tokenOutTransfers.length > 0) {
      observedAmountOut = tokenOutTransfers.reduce((acc, t) => acc + BigInt(t.value), 0n);
    } else {
      tokenOutCheck = 'FAIL';
    }

    // Check Amount Out
    if (tokenOutCheck === 'PASS') {
      const expectedAmountOut = BigInt(trade.amountOut);
      const diff = observedAmountOut > expectedAmountOut ? observedAmountOut - expectedAmountOut : expectedAmountOut - observedAmountOut;
      const maxDiff = expectedAmountOut / 100n; // 1%
      if (diff > maxDiff && diff >= 1000000n) {
        amountOutCheck = 'FAIL';
      }
    } else {
      amountOutCheck = 'FAIL';
    }

    const isPass = 
      walletCheck === 'PASS' &&
      tokenInCheck === 'PASS' &&
      tokenOutCheck === 'PASS' &&
      amountInCheck === 'PASS' &&
      amountOutCheck === 'PASS';

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
      const reasonParts: string[] = [];
      if (walletCheck === 'FAIL') reasonParts.push('wallet mismatch');
      if (tokenInCheck === 'FAIL') reasonParts.push('tokenIn mismatch');
      if (tokenOutCheck === 'FAIL') reasonParts.push('tokenOut mismatch');
      if (tokenInCheck === 'PASS' && amountInCheck === 'FAIL') reasonParts.push('amountIn mismatch');
      if (tokenOutCheck === 'PASS' && amountOutCheck === 'FAIL') reasonParts.push('amountOut mismatch');
      
      const reasonStr = reasonParts.join(', ');
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

  output += `List of failed transactions with details:\n\n`;
  
  const fails = [
    ...auditData.filter(item => {
      // Find if this item failed
      const wallet = item.trade.wallet.toLowerCase();
      const txFrom = item.tx.from.toLowerCase();
      
      const isWBNB = item.trade.tokenIn.toLowerCase() === WBNB;
      const txValue = BigInt(item.tx.value);
      
      const walletCheck = wallet === txFrom;
      const tokenInTransfers = item.transfers.filter(t => t.token === item.trade.tokenIn.toLowerCase() && t.from === wallet);
      const tokenInCheck = (isWBNB && txValue > 0n) || tokenInTransfers.length > 0;
      
      const tokenOutTransfers = item.transfers.filter(t => t.token === item.trade.tokenOut.toLowerCase() && t.to === wallet);
      const tokenOutCheck = (item.trade.tokenOut.toLowerCase() === WBNB && item.transfers.some(t => t.token === WBNB && t.to === wallet)) || tokenOutTransfers.length > 0;
      
      let amountInCheck = true;
      if (tokenInCheck) {
        let observedAmountIn = isWBNB && txValue > 0n ? txValue : tokenInTransfers.reduce((acc, t) => acc + BigInt(t.value), 0n);
        const expectedAmountIn = BigInt(item.trade.amountIn);
        const diff = observedAmountIn > expectedAmountIn ? observedAmountIn - expectedAmountIn : expectedAmountIn - observedAmountIn;
        const maxDiff = expectedAmountIn / 100n;
        if (diff > maxDiff && diff >= 1000000n) amountInCheck = false;
      } else {
        amountInCheck = false;
      }

      let amountOutCheck = true;
      if (tokenOutCheck) {
        let observedAmountOut = item.trade.tokenOut.toLowerCase() === WBNB && item.transfers.some(t => t.token === WBNB && t.to === wallet)
          ? item.transfers.filter(t => t.token === WBNB && t.to === wallet).reduce((acc, t) => acc + BigInt(t.value), 0n)
          : tokenOutTransfers.reduce((acc, t) => acc + BigInt(t.value), 0n);
        const expectedAmountOut = BigInt(item.trade.amountOut);
        const diff = observedAmountOut > expectedAmountOut ? observedAmountOut - expectedAmountOut : expectedAmountOut - observedAmountOut;
        const maxDiff = expectedAmountOut / 100n;
        if (diff > maxDiff && diff >= 1000000n) amountOutCheck = false;
      } else {
        amountOutCheck = false;
      }

      return !(walletCheck && tokenInCheck && tokenOutCheck && amountInCheck && amountOutCheck);
    })
  ];

  for (const item of fails) {
    const txHash = item.trade.txHash;
    const explanation = EXPLANATIONS[txHash] || 'Audit mismatch detected.';
    output += `* **Transaction**: \`${txHash}\` (${item.trade.dex.toUpperCase()})\n`;
    output += `  * **Parsed Wallet**: \`${item.trade.wallet}\`\n`;
    output += `  * **Parsed TokenIn**: \`${item.trade.tokenInSym}\` (\`${item.trade.tokenIn}\`)\n`;
    output += `  * **Parsed TokenOut**: \`${item.trade.tokenOutSym}\` (\`${item.trade.tokenOut}\`)\n`;
    output += `  * **Parsed AmountIn**: \`${item.trade.amountInHuman}\`\n`;
    output += `  * **Parsed AmountOut**: \`${item.trade.amountOutHuman}\`\n`;
    output += `  * **Audit Finding**: ${explanation}\n\n`;
  }

  await writeFile('./src/validation/validation_report.md', output, 'utf-8');
  console.log('Saved final report to ./src/validation/validation_report.md');
}

run().catch(console.error);
