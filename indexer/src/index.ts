import { env } from './config/env.js';
import { logger } from './logger.js';
import { getLatestBlock, getBlocksInRange } from './chains/bsc.js';
import { BlockProcessor } from './processor.js';
import { BlockPoller } from './poller.js';
import { ParserRegistry } from './parsers/registry.js';
import { pancakeswapV2Parser } from './parsers/pancakeswap-v2.js';
import { pancakeswapV3Parser } from './parsers/pancakeswap-v3.js';
import { pancakeswapV4Parser } from './parsers/pancakeswap-v4.js';
import { resolveTokenMeta, tokenCacheSize } from './cache/token-cache.js';
import { formatAmount } from './tokens/registry.js';
import type { IndexedBlock, NormalizedTrade } from './types/index.js';

// ── Wallet watch ──────────────────────────────────────────────────────────────

const WATCHED_WALLET = '0xd096705ea5ee99f2c3e4a1b23e9816395e4ba92c';

function isWatched(trade: NormalizedTrade): boolean {
  return trade.wallet.toLowerCase() === WATCHED_WALLET;
}

// ── Trade display ─────────────────────────────────────────────────────────────

async function printTrade(trade: NormalizedTrade): Promise<void> {
  const [metaIn, metaOut] = await Promise.all([
    resolveTokenMeta(trade.tokenIn),
    resolveTokenMeta(trade.tokenOut),
  ]);

  const amtIn  = formatAmount(trade.amountIn,  metaIn.decimals);
  const amtOut = formatAmount(trade.amountOut, metaOut.decimals);
  const watched = isWatched(trade);

  if (watched) {
    process.stdout.write(
      [
        '🚨'.repeat(30),
        '🚨  WATCHED WALLET DETECTED  🚨',
        '🚨'.repeat(30),
        `Wallet: ${trade.wallet}`,
        `Sold:   ${amtIn} ${metaIn.symbol}`,
        `Bought: ${amtOut} ${metaOut.symbol}`,
        `Tx:     ${trade.txHash}`,
        `Block:  ${trade.blockNumber.toString()}  (${new Date(trade.blockTimestampMs).toISOString()})`,
        `DEX:    ${trade.dex}`,
        '🚨'.repeat(30),
        '',
      ].join('\n'),
    );
  } else {
    process.stdout.write(
      [
        '─'.repeat(60),
        `Wallet: ${trade.wallet}`,
        `Sold:   ${amtIn} ${metaIn.symbol}`,
        `Bought: ${amtOut} ${metaOut.symbol}`,
        `Tx:     ${trade.txHash}`,
        `Block:  ${trade.blockNumber.toString()}  (${new Date(trade.blockTimestampMs).toISOString()})`,
        `DEX:    ${trade.dex}`,
        `Pair:   ${trade.pairAddress}`,
        '',
      ].join('\n'),
    );
  }
}

// ── Block handler (shared by both modes) ──────────────────────────────────────

async function handleBlock(block: IndexedBlock, trades: NormalizedTrade[]): Promise<void> {
  if (trades.length === 0) {
    logger.debug('Block processed — no swaps', {
      block:   block.number.toString(),
      txCount: block.transactionCount,
    });
    return;
  }

  // Pre-fetch all token metas in parallel — unknown tokens hit the chain once,
  // subsequent calls return from the in-memory cache instantly.
  const uniqueTokens = [
    ...new Set(trades.flatMap((t) => [t.tokenIn, t.tokenOut])),
  ] as `0x${string}`[];

  await Promise.all(uniqueTokens.map(resolveTokenMeta));

  logger.info('Block processed', {
    block:        block.number.toString(),
    txCount:      block.transactionCount,
    swapCount:    trades.length,
    tokensCached: tokenCacheSize(),
  });

  for (const trade of trades) {
    await printTrade(trade);
  }
}

// ── Parser registry ───────────────────────────────────────────────────────────

const registry = new ParserRegistry()
  .register(pancakeswapV2Parser)
  .register(pancakeswapV3Parser)
  .register(pancakeswapV4Parser);

// ── Processor (shared) ────────────────────────────────────────────────────────

function makeProcessor(): BlockProcessor {
  return new BlockProcessor(
    handleBlock,
    registry,
    {
      batchSize:          100,
      delayMs:            200,
      fetchConcurrency:   env.FETCH_CONCURRENCY,
      receiptConcurrency: env.RECEIPT_CONCURRENCY,
    },
  );
}

// ── Modes ─────────────────────────────────────────────────────────────────────

async function runBatch(startBlock: bigint, endBlock: bigint): Promise<void> {
  logger.info('Batch mode', {
    from:        startBlock.toString(),
    to:          endBlock.toString(),
    totalBlocks: (endBlock - startBlock + 1n).toString(),
  });

  const processor = makeProcessor();
  await processor.processRange(startBlock, endBlock);

  logger.info('Batch complete', { tokensCached: tokenCacheSize() });
}

async function runLive(): Promise<void> {
  logger.info('Live mode — polling BSC every 3s for new blocks');

  const processor = makeProcessor();
  const poller    = new BlockPoller(processor, env.POLL_INTERVAL_MS);

  await poller.start(); // blocks until SIGINT / SIGTERM / poller.stop()
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('BSC Indexer starting', { rpc: env.BSC_RPC_URL });

  // Print chain head
  const head = await getLatestBlock();
  logger.info('Chain head', {
    number:    head.number.toString(),
    timestamp: new Date(head.timestampMs).toISOString(),
    txCount:   head.transactionCount,
  });

  // Quick 10-block summary on startup
  const from10 = head.number - 9n;
  const recent = await getBlocksInRange(from10, head.number);
  for (const block of recent) {
    logger.info('Block', {
      number:    block.number.toString(),
      timestamp: new Date(block.timestampMs).toISOString(),
      txCount:   block.transactionCount,
    });
  }

  // Mode selection: set both BLOCK_START + BLOCK_END for a one-shot backfill.
  // Leave them unset to stream live blocks as they arrive.
  const envStart = process.env['BLOCK_START'];
  const envEnd   = process.env['BLOCK_END'];

  if (envStart !== undefined && envEnd !== undefined) {
    await runBatch(BigInt(envStart), BigInt(envEnd));
  } else {
    await runLive();
  }
}

main().catch((err: unknown) => {
  logger.error('Fatal error', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack  : undefined,
  });
  process.exit(1);
});
