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
import {
  TradeRepository,
  TokenRepository,
  TokenDiscoveryQueueRepository,
  IndexerStateRepository,
} from '@aether/db';

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
  // Always update checkpoint in the database
  try {
    await IndexerStateRepository.saveCheckpoint('bsc', block.number);
  } catch (err) {
    logger.error('Failed to save indexer checkpoint in database', {
      block: block.number.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
  }

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

  const metas = await Promise.all(
    uniqueTokens.map(async (addr) => {
      const meta = await resolveTokenMeta(addr);
      return { address: addr.toLowerCase(), meta };
    })
  );
  const metaMap = new Map(metas.map(m => [m.address, m.meta]));

  logger.info('Block processed', {
    block:        block.number.toString(),
    txCount:      block.transactionCount,
    swapCount:    trades.length,
    tokensCached: tokenCacheSize(),
  });

  const tradesToInsert = [];
  const tokensToUpsert = new Map<string, { address: string; symbol: string; decimals: number }>();

  for (const trade of trades) {
    const metaIn = metaMap.get(trade.tokenIn.toLowerCase());
    const metaOut = metaMap.get(trade.tokenOut.toLowerCase());

    const tokenInSymbol = metaIn?.symbol ?? trade.tokenIn.slice(0, 8);
    const tokenOutSymbol = metaOut?.symbol ?? trade.tokenOut.slice(0, 8);
    const decimalsIn = metaIn?.decimals ?? 18;
    const decimalsOut = metaOut?.decimals ?? 18;

    tradesToInsert.push({
      txHash: trade.txHash,
      blockNumber: trade.blockNumber,
      timestamp: new Date(trade.blockTimestampMs),
      wallet: trade.wallet,
      dex: trade.dex,
      tokenInAddress: trade.tokenIn.toLowerCase(),
      tokenOutAddress: trade.tokenOut.toLowerCase(),
      tokenInSymbol,
      tokenOutSymbol,
      amountIn: trade.amountIn.toString(),
      amountOut: trade.amountOut.toString(),
    });

    if (!tokensToUpsert.has(trade.tokenIn.toLowerCase())) {
      tokensToUpsert.set(trade.tokenIn.toLowerCase(), {
        address: trade.tokenIn.toLowerCase(),
        symbol: tokenInSymbol,
        decimals: decimalsIn,
      });
    }

    if (!tokensToUpsert.has(trade.tokenOut.toLowerCase())) {
      tokensToUpsert.set(trade.tokenOut.toLowerCase(), {
        address: trade.tokenOut.toLowerCase(),
        symbol: tokenOutSymbol,
        decimals: decimalsOut,
      });
    }

    await printTrade(trade);
  }

  // Persist trades, upsert tokens, and queue metadata lookups
  try {
    // 1. Insert trades
    await TradeRepository.insertTrades(tradesToInsert);

    // 2. Upsert tokens and enqueue for metadata resolution
    for (const tokenData of tokensToUpsert.values()) {
      // Upsert basic cache properties.
      await TokenRepository.upsertToken({
        address: tokenData.address,
        symbol: tokenData.symbol,
        name: tokenData.symbol + ' Token', // default stub
        decimals: tokenData.decimals,
      });

      // Enqueue if missing logo/coingecko ID
      const cached = await TokenRepository.findByAddress(tokenData.address);
      if (!cached || !cached.imageUrl || !cached.coingeckoId) {
        await TokenDiscoveryQueueRepository.enqueueToken(tokenData.address);
      }
    }
  } catch (err) {
    logger.error('Failed to persist trades or tokens to database', {
      block: block.number.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
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
