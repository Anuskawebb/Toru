import { env } from './config/env.js';
import { logger } from './logger.js';
import { getLatestBlock, getBlocksInRange, lastReceiptStats } from './chains/bsc.js';
import { BlockProcessor } from './processor.js';
import { BlockPoller } from './poller.js';
import { ParserRegistry } from './parsers/registry.js';
import { DEX_PARSERS } from './parsers/index.js';
import { resolveTokenMeta, tokenCacheSize } from './cache/token-cache.js';
import { formatAmount } from './tokens/registry.js';
import type { IndexedBlock, NormalizedTrade } from './types/index.js';
import {
  TradeRepository,
  TokenRepository,
  TokenDiscoveryQueueRepository,
  IndexerStateRepository,
  PositionRepository,
  WalletMetricsRepository,
} from '@aether/db';

// ── Process lifecycle ─────────────────────────────────────────────────────────

process.on('exit', (code) => {
  // Synchronous write — fires just before the process terminates regardless of
  // how it exits (normal, signal, or process.exit()). The logger is a thin
  // process.stdout.write wrapper, so this is safe even during teardown.
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(), level: 'info', msg: 'Process exit', code,
    heapMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }) + '\n');
});

process.on('SIGTERM', () => {
  logger.warn('Received SIGTERM — shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.warn('Received SIGINT — shutting down');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack:  reason instanceof Error ? reason.stack  : undefined,
  });
  process.exit(1);
});

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

// ── Batch-level receipt stats accumulator ─────────────────────────────────────

const batchReceiptStats = {
  totalTx:     0,
  succeeded:   0,
  failed:      0,
  failed403:   0,
  failedOther: 0,
  blocksWithFailures: 0,
};

// ── Block handler (shared by both modes) ──────────────────────────────────────

async function handleBlock(block: IndexedBlock, trades: NormalizedTrade[]): Promise<void> {
  const t0 = Date.now();

  if (trades.length === 0) {
    // Nothing to persist or reconstruct — advance the DB checkpoint and return.
    // The processor saves the file-based checkpoint after we return, which is
    // what the poller uses for resumption.
    try {
      await IndexerStateRepository.saveCheckpoint('bsc', block.number);
    } catch (err) {
      logger.error('Failed to save checkpoint for empty block', {
        block: block.number.toString(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
    logger.debug('Block processed — no swaps', {
      block:   block.number.toString(),
      txCount: block.transactionCount,
    });
    return;
  }

  // ── Resolve token metadata ────────────────────────────────────────────────
  // All unique tokens fetched in parallel; resolved cache means repeated tokens
  // across blocks are O(1) after the first hit.
  const uniqueTokens = [
    ...new Set(trades.flatMap((t) => [t.tokenIn, t.tokenOut])),
  ] as `0x${string}`[];

  const tMeta0 = Date.now();
  const metas = await Promise.all(
    uniqueTokens.map(async (addr) => {
      const meta = await resolveTokenMeta(addr);
      return { address: addr.toLowerCase(), meta };
    })
  );
  const metadataMs = Date.now() - tMeta0;
  const metaMap = new Map(metas.map(m => [m.address, m.meta]));

  // ── Build insert payloads ─────────────────────────────────────────────────
  const tradesToInsert: Array<{
    txHash: string; blockNumber: bigint; logIndex: number;
    timestamp: Date; wallet: string; dex: string; pairAddress: string;
    tokenInAddress: string; tokenOutAddress: string;
    tokenInSymbol: string; tokenOutSymbol: string;
    tokenInDecimals: number; tokenOutDecimals: number;
    amountIn: string; amountOut: string;
  }> = [];
  const tokensToUpsert = new Map<string, { address: string; symbol: string; decimals: number }>();

  for (const trade of trades) {
    const metaIn  = metaMap.get(trade.tokenIn.toLowerCase());
    const metaOut = metaMap.get(trade.tokenOut.toLowerCase());

    const tokenInSymbol  = metaIn?.symbol   ?? trade.tokenIn.slice(0, 8);
    const tokenOutSymbol = metaOut?.symbol  ?? trade.tokenOut.slice(0, 8);
    const decimalsIn     = metaIn?.decimals  ?? 18;
    const decimalsOut    = metaOut?.decimals ?? 18;

    tradesToInsert.push({
      txHash:          trade.txHash.toLowerCase(),
      blockNumber:     trade.blockNumber,
      logIndex:        trade.logIndex,
      timestamp:       new Date(trade.blockTimestampMs),
      wallet:          trade.wallet.toLowerCase(),
      dex:             trade.dex,
      pairAddress:     trade.pairAddress.toLowerCase(),
      tokenInAddress:  trade.tokenIn.toLowerCase(),
      tokenOutAddress: trade.tokenOut.toLowerCase(),
      tokenInSymbol,
      tokenOutSymbol,
      tokenInDecimals:  decimalsIn,
      tokenOutDecimals: decimalsOut,
      amountIn:        trade.amountIn.toString(),
      amountOut:       trade.amountOut.toString(),
    });

    if (!tokensToUpsert.has(trade.tokenIn.toLowerCase())) {
      tokensToUpsert.set(trade.tokenIn.toLowerCase(), {
        address:  trade.tokenIn.toLowerCase(),
        symbol:   tokenInSymbol,
        decimals: decimalsIn,
      });
    }
    if (!tokensToUpsert.has(trade.tokenOut.toLowerCase())) {
      tokensToUpsert.set(trade.tokenOut.toLowerCase(), {
        address:  trade.tokenOut.toLowerCase(),
        symbol:   tokenOutSymbol,
        decimals: decimalsOut,
      });
    }

    await printTrade(trade);
  }

  // ── Build position update inputs ──────────────────────────────────────────
  // TradeInput is a strict subset of the row shape already built above —
  // field-for-field pick, no re-derivation.
  const tradeInputs = tradesToInsert.map((t) => ({
    wallet:           t.wallet,
    tokenInAddress:   t.tokenInAddress,
    tokenOutAddress:  t.tokenOutAddress,
    tokenInSymbol:    t.tokenInSymbol,
    tokenOutSymbol:   t.tokenOutSymbol,
    tokenInDecimals:  t.tokenInDecimals,
    tokenOutDecimals: t.tokenOutDecimals,
    amountIn:         t.amountIn,
    amountOut:        t.amountOut,
    timestamp:        t.timestamp,
  }));

  const tokenRows = [...tokensToUpsert.values()].map((t) => ({
    address:  t.address,
    symbol:   t.symbol,
    name:     t.symbol + ' Token',
    decimals: t.decimals,
  }));
  const tokenAddresses = tokenRows.map((t) => t.address);

  // ── DB writes — ordered: trades → positions → tokens → queue → checkpoint ─
  //
  // No try-catch here: any failure propagates to BlockProcessor.processBlock,
  // which logs "Handler failed — block not checkpointed" and re-throws.
  // The poller catches the re-throw and retries the same block next tick.
  //
  // Ordering guarantee: the DB checkpoint advances only after both trades and
  // positions have been committed. External observers see a consistent watermark.
  //
  // ⚠ Non-idempotency note: insertTrades uses ON CONFLICT DO NOTHING (safe to
  // replay), but applyTrades applies arithmetic deltas (not safe to replay).
  // If the process crashes between applyTrades and the checkpoint write, a retry
  // will double-count positions for that block. Mitigation: run rebuildAll() to
  // reset from the trades table as ground truth. This window is expected to be
  // extremely rare in practice.

  // 1. Trades — one bulk roundtrip, deduplicates via unique index.
  // RETURNING gives back only rows that were actually inserted (skipped dupes
  // are absent), so applyTrades only counts genuinely new trades.
  const tTrades0 = Date.now();
  const insertedHashes = new Set(await TradeRepository.insertTrades(tradesToInsert));
  const tradeInsertMs = Date.now() - tTrades0;

  // 2. Positions — deltas for new trades only; idempotent on replay.
  const newTradeInputs = tradeInputs.filter((_, i) =>
    insertedHashes.has(tradesToInsert[i]!.txHash)
  );
  const tPos0 = Date.now();
  await PositionRepository.applyTrades(newTradeInputs);
  const positionUpdateMs = Date.now() - tPos0;

  // 3. Wallet metrics — rebuild metrics for wallets that had new trades.
  // Runs after applyTrades so currentOpenPositions reads the updated state.
  // Derives from full trade history (not deltas) — idempotent on replay.
  const affectedWallets = [...new Set(newTradeInputs.map((t) => t.wallet))];
  const tMetrics0 = Date.now();
  await WalletMetricsRepository.rebuildWallets(affectedWallets);
  const metricsUpdateMs = Date.now() - tMetrics0;

  // 5. Token registry — one bulk roundtrip
  const tTokens0 = Date.now();
  await TokenRepository.upsertTokens(tokenRows);
  const tokenUpsertMs = Date.now() - tTokens0;

  // 6. Discovery queue — one bulk roundtrip
  const tQueue0 = Date.now();
  await TokenDiscoveryQueueRepository.enqueueTokens(tokenAddresses);
  const queueInsertMs = Date.now() - tQueue0;

  // 7. DB checkpoint — saved last so it reflects a fully committed block
  const tChk0 = Date.now();
  await IndexerStateRepository.saveCheckpoint('bsc', block.number);
  const checkpointMs = Date.now() - tChk0;

  // ── Receipt stats accumulator ─────────────────────────────────────────────
  const rs = lastReceiptStats;
  batchReceiptStats.totalTx     += rs.total;
  batchReceiptStats.succeeded   += rs.succeeded;
  batchReceiptStats.failed      += rs.failed;
  batchReceiptStats.failed403   += rs.failed403;
  batchReceiptStats.failedOther += rs.failedOther;
  if (rs.failed > 0) batchReceiptStats.blocksWithFailures++;

  const totalMs = Date.now() - t0;
  logger.info('Block processed', {
    block:             block.number.toString(),
    txCount:           block.transactionCount,
    swapCount:         trades.length,
    uniqueTokens:      tokensToUpsert.size,
    tokensCached:      tokenCacheSize(),
    receipts:          { succeeded: rs.succeeded, failed: rs.failed, failed403: rs.failed403 },
    metadataMs,
    tradeInsertMs,
    positionUpdateMs,
    metricsUpdateMs,
    tokenUpsertMs,
    queueInsertMs,
    checkpointMs,
    dbTotalMs:         tradeInsertMs + positionUpdateMs + metricsUpdateMs + tokenUpsertMs + queueInsertMs + checkpointMs,
    totalMs,
  });
}


// ── Parser registry ───────────────────────────────────────────────────────────

const registry = new ParserRegistry();
for (const parser of DEX_PARSERS) {
  registry.register(parser);
}

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
  const t0 = Date.now();
  logger.info('Batch mode', {
    from:        startBlock.toString(),
    to:          endBlock.toString(),
    totalBlocks: (endBlock - startBlock + 1n).toString(),
  });

  const processor = makeProcessor();
  await processor.processRange(startBlock, endBlock);

  const mem = process.memoryUsage();
  logger.info('Batch complete', {
    tokensCached:  tokenCacheSize(),
    durationMs:    Date.now() - t0,
    heapUsedMB:    Math.round(mem.heapUsed  / 1024 / 1024),
    heapTotalMB:   Math.round(mem.heapTotal / 1024 / 1024),
    rssMB:         Math.round(mem.rss       / 1024 / 1024),
    receiptStats: {
      totalTx:            batchReceiptStats.totalTx,
      succeeded:          batchReceiptStats.succeeded,
      failed:             batchReceiptStats.failed,
      failed403:          batchReceiptStats.failed403,
      failedOther:        batchReceiptStats.failedOther,
      blocksWithFailures: batchReceiptStats.blocksWithFailures,
      successRate:        batchReceiptStats.totalTx > 0
        ? ((batchReceiptStats.succeeded / batchReceiptStats.totalTx) * 100).toFixed(1) + '%'
        : 'n/a',
    },
  });

  // Force exit: the postgres connection pool's open TCP sockets keep Node's
  // event loop alive indefinitely after the batch finishes. process.exit(0)
  // is safe here — all DB writes have already committed synchronously above.
  process.exit(0);
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
