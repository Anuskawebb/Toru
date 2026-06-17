import { writeFile } from 'fs/promises';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { BlockProcessor } from '../processor.js';
import { ParserRegistry } from '../parsers/registry.js';
import { pancakeswapV2Parser } from '../parsers/pancakeswap-v2.js';
import { pancakeswapV3Parser } from '../parsers/pancakeswap-v3.js';
import { pancakeswapV4Parser } from '../parsers/pancakeswap-v4.js';
import { getLatestBlock } from '../chains/bsc.js';
import type { IndexedBlock, NormalizedTrade } from '../types/index.js';

const EXPORT_FILE = './trades_export.json';

// Simple parser registry including V2, V3, and V4
const registry = new ParserRegistry()
  .register(pancakeswapV2Parser)
  .register(pancakeswapV3Parser)
  .register(pancakeswapV4Parser);

async function runAudit() {
  logger.info('Starting Indexer Validation and Audit Suite');

  // 1. Get range of blocks to process.
  // We scan a range of recent blocks to gather 1,000+ trades.
  const head = await getLatestBlock();
  const headNumber = Number(head.number);

  // We backfill from head - 120 blocks to head to fetch ~1000+ trades
  const scanFrom = headNumber - 120;
  const scanTo = headNumber;

  logger.info('Preparing audit sweep', {
    fromBlock: scanFrom,
    toBlock: scanTo,
    totalBlocks: scanTo - scanFrom + 1,
  });

  const collectedTrades: NormalizedTrade[] = [];

  const auditHandler = async (block: IndexedBlock, trades: NormalizedTrade[]) => {
    // Collect all trades in memory
    collectedTrades.push(...trades);
    
    logger.info('Processed block', {
      block: block.number.toString(),
      txCount: block.transactionCount,
      swapsInBlock: trades.length,
      totalSwapsSoFar: collectedTrades.length,
    });
  };

  const processor = new BlockProcessor(
    auditHandler,
    registry,
    {
      batchSize: 100,
      delayMs: 200,
      fetchConcurrency: env.FETCH_CONCURRENCY,
      receiptConcurrency: env.RECEIPT_CONCURRENCY,
    }
  );

  // Run the processor over the range
  await processor.processRange(BigInt(scanFrom), BigInt(scanTo));

  logger.info('Processor sweep completed. Exporting trades to JSON...', {
    totalTrades: collectedTrades.length,
  });

  // Export trades to file
  await writeFile(
    EXPORT_FILE,
    JSON.stringify(
      collectedTrades,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    ) + '\n',
    'utf-8'
  );

  logger.info(`Trades exported to ${EXPORT_FILE}`);

  // 2. Perform automated validation checks on collected trades.
  logger.info('Beginning automated audit assertions...');
  
  const auditReport = {
    totalTrades: collectedTrades.length,
    v2Trades: 0,
    v3Trades: 0,
    v4Trades: 0,
    failures: [] as string[],
    duplicateCount: 0,
    negativeAmounts: 0,
    zeroAmounts: 0,
    invalidWallets: 0,
    missingTokens: 0,
  };

  const seenTrades = new Set<string>();

  for (const trade of collectedTrades) {
    // Count distribution
    if (trade.dex === 'pancakeswap-v2') auditReport.v2Trades++;
    else if (trade.dex === 'pancakeswap-v3') auditReport.v3Trades++;
    else if (trade.dex === 'pancakeswap-v4') auditReport.v4Trades++;

    // Assertions
    
    // A. Check for negative amounts
    if (trade.amountIn < 0n || trade.amountOut < 0n) {
      auditReport.negativeAmounts++;
      auditReport.failures.push(
        `Negative amount detected in tx ${trade.txHash}: amountIn=${trade.amountIn}, amountOut=${trade.amountOut}`
      );
    }

    // B. Check for zero amounts
    if (trade.amountIn === 0n || trade.amountOut === 0n) {
      auditReport.zeroAmounts++;
      auditReport.failures.push(
        `Zero amount detected in tx ${trade.txHash}: amountIn=${trade.amountIn}, amountOut=${trade.amountOut}`
      );
    }

    // C. Check for duplicate trades (combination of txHash, logIndex and pairAddress)
    // Note: raw logs have unique logIndex. We check uniqueness.
    // Wait, logIndex is not on NormalizedTrade directly. Let's inspect the unique signature of the trade:
    const tradeSig = `${trade.txHash.toLowerCase()}-${trade.pairAddress.toLowerCase()}-${trade.tokenIn.toLowerCase()}-${trade.tokenOut.toLowerCase()}-${trade.amountIn}`;
    if (seenTrades.has(tradeSig)) {
      auditReport.duplicateCount++;
    } else {
      seenTrades.add(tradeSig);
    }

    // D. Check for valid wallet format
    if (!trade.wallet.startsWith('0x') || trade.wallet.length !== 42) {
      auditReport.invalidWallets++;
      auditReport.failures.push(`Invalid wallet address format: ${trade.wallet}`);
    }

    // E. Check if wallet is a known router or pool
    const routerAddress = '0x40a1fe393a7f566f27df6ace18e6773be844dafc';
    const poolManagerAddress = '0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b';
    if (
      trade.wallet.toLowerCase() === routerAddress.toLowerCase() ||
      trade.wallet.toLowerCase() === poolManagerAddress.toLowerCase() ||
      trade.wallet.toLowerCase() === trade.pairAddress.toLowerCase()
    ) {
      auditReport.invalidWallets++;
      auditReport.failures.push(
        `Wallet is set to router/pool address in tx ${trade.txHash}: ${trade.wallet}`
      );
    }

    // F. Check for missing tokenIn/tokenOut
    if (!trade.tokenIn || !trade.tokenOut) {
      auditReport.missingTokens++;
      auditReport.failures.push(`Missing token address in tx ${trade.txHash}`);
    }
  }

  // 3. Output results
  console.log('\n==================================================');
  console.log('            INDEXER AUDIT SUITE REPORT             ');
  console.log('==================================================');
  console.log(`Block Range Checked:    ${scanFrom} -> ${scanTo}`);
  console.log(`Total Trades Processed: ${auditReport.totalTrades}`);
  console.log(`PancakeSwap V2:         ${auditReport.v2Trades}`);
  console.log(`PancakeSwap V3:         ${auditReport.v3Trades}`);
  console.log(`PancakeSwap V4:         ${auditReport.v4Trades}`);
  console.log('--------------------------------------------------');
  console.log(`Duplicate trades:       ${auditReport.duplicateCount}`);
  console.log(`Negative amounts:       ${auditReport.negativeAmounts}`);
  console.log(`Zero amounts:           ${auditReport.zeroAmounts}`);
  console.log(`Invalid wallets:        ${auditReport.invalidWallets}`);
  console.log(`Missing token info:     ${auditReport.missingTokens}`);
  console.log('==================================================');
  
  if (auditReport.failures.length > 0) {
    console.log('\n❌ AUDIT FAILED with the following errors:');
    auditReport.failures.slice(0, 10).forEach((f) => console.log(` - ${f}`));
    if (auditReport.failures.length > 10) {
      console.log(` ... and ${auditReport.failures.length - 10} more errors.`);
    }
    process.exit(1);
  } else {
    console.log('\n✅ ALL AUDIT SCHEMAS AND ATTRIBUTIONS PASSED 100%!');
    process.exit(0);
  }
}

runAudit().catch((err) => {
  logger.error('Audit run failed', { error: String(err) });
  process.exit(1);
});
