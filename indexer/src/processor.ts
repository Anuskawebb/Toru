import { getLatestBlock, getBlocksInRange, getTransactionReceipts } from './chains/bsc.js';
import { CheckpointService } from './services/checkpoint.js';
import { extractEvents } from './extractors/events.js';
import { logger } from './logger.js';
import { env } from './config/env.js';
import { ParserRegistry } from './parsers/registry.js';
import { reconstructTrade } from './reconstruction/trade-reconstructor.js';
import type {
  BlockHandler,
  IndexedBlock,
  NormalizedTrade,
  ProcessorOptions,
  RawEvent,
} from './types/index.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── BlockProcessor ────────────────────────────────────────────────────────────

/**
 * Orchestrates the full indexing pipeline:
 *
 *   Block
 *   → Transaction Hashes
 *   → Transaction Receipts        (batched, concurrent)
 *   → Raw Events                  (extracted from all logs)
 *   → Swap Detection              (canParse per registered parser)
 *   → Trade Normalization         (async parse with pair-cache lookup)
 *   → BlockHandler(block, trades)
 *
 * Add new DEX parsers by passing them in the `parsers` option.
 * The checkpoint advances after each successful block, so crashes restart
 * from exactly where they left off.
 */
export class BlockProcessor {
  private readonly checkpoint: CheckpointService;
  private readonly handler: BlockHandler;
  private readonly registry: ParserRegistry;
  private readonly options: ProcessorOptions;

  constructor(
    handler: BlockHandler,
    registry: ParserRegistry,
    options?: Partial<ProcessorOptions>,
  ) {
    this.handler    = handler;
    this.registry   = registry;
    this.checkpoint = new CheckpointService();
    this.options    = {
      batchSize:          options?.batchSize          ?? env.BATCH_SIZE,
      delayMs:            options?.delayMs            ?? env.BATCH_DELAY_MS,
      fetchConcurrency:   options?.fetchConcurrency   ?? env.FETCH_CONCURRENCY,
      receiptConcurrency: options?.receiptConcurrency ?? env.RECEIPT_CONCURRENCY,
    };
  }

  /**
   * Run from checkpoint (or `startBlock`) through the current chain head.
   * @param startBlock Override checkpoint — useful for one-shot backfills.
   */
  async run(startBlock?: number): Promise<void> {
    const [lastProcessed, head] = await Promise.all([
      this.checkpoint.getLastProcessedBlock(),
      getLatestBlock(),
    ]);

    const headNumber = Number(head.number);

    const from =
      startBlock !== undefined
        ? startBlock
        : lastProcessed !== null
        ? lastProcessed + 1
        : headNumber - this.options.batchSize + 1;

    if (from > headNumber) {
      logger.info('Already at chain head — nothing to process', {
        lastProcessed,
        head: headNumber,
      });
      return;
    }

    logger.info('Processor starting', {
      fromBlock:   from,
      toBlock:     headNumber,
      totalBlocks: headNumber - from + 1,
      batchSize:   this.options.batchSize,
      parsers:     this.registry.names,
    });

    await this.processRange(BigInt(from), BigInt(headNumber));

    logger.info('Processor run complete', { processedUpTo: headNumber });
  }

  async processRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
    const { batchSize, delayMs, fetchConcurrency } = this.options;
    const step = BigInt(batchSize);

    for (let start = fromBlock; start <= toBlock; start += step) {
      const end = start + step - 1n < toBlock ? start + step - 1n : toBlock;

      logger.info('Fetching block batch', {
        fromBlock: start.toString(),
        toBlock:   end.toString(),
        size:      Number(end - start + 1n),
      });

      const blocks = await getBlocksInRange(start, end, fetchConcurrency);

      for (const block of blocks) {
        await this.processBlock(block);
      }

      const isLastBatch = end >= toBlock;
      if (!isLastBatch && delayMs > 0) await sleep(delayMs);
    }
  }

  // ── Per-block pipeline ──────────────────────────────────────────────────────

  private async processBlock(block: IndexedBlock): Promise<void> {
    const trades = await this.extractTrades(block);

    try {
      await this.handler(block, trades);
      await this.checkpoint.saveLastProcessedBlock(Number(block.number));
    } catch (err) {
      logger.error('Handler failed — block not checkpointed', {
        blockNumber: block.number.toString(),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Full receipt → event → trade pipeline for one block.
   * Never throws — errors per receipt/event are logged and skipped.
   */
  private async extractTrades(block: IndexedBlock): Promise<NormalizedTrade[]> {
    if (block.transactions.length === 0) return [];

    // ── 1. Fetch receipts ───────────────────────────────────────────────────
    logger.debug('Fetching receipts', {
      block:  block.number.toString(),
      txCount: block.transactions.length,
    });

    const receipts = await getTransactionReceipts(
      block.transactions,
      this.options.receiptConcurrency,
    );

    // ── 2. Extract raw events ───────────────────────────────────────────────
    const allEvents = receipts.flatMap(extractEvents);

    // ── 3. Build per-tx sibling map ─────────────────────────────────────────
    // Parsers like V4 need all logs from the same tx to derive token identities
    // (ERC-20 Transfer events tell us what tokens actually moved).
    const eventsByTx = new Map<string, RawEvent[]>();
    for (const event of allEvents) {
      let list = eventsByTx.get(event.txHash);
      if (list === undefined) {
        list = [];
        eventsByTx.set(event.txHash, list);
      }
      list.push(event);
    }

    // ── 4. Filter to parseable events ──────────────────────────────────────
    const parseable = allEvents.filter((ev) => this.registry.canParse(ev));

    logger.debug('Event extraction complete', {
      block:      block.number.toString(),
      receipts:   receipts.length,
      totalLogs:  allEvents.length,
      swapEvents: parseable.length,
    });

    if (parseable.length === 0) return [];

    // ── 5. Parse → RawSwap ────────────────────────────────────────────────
    const parseResults = await Promise.allSettled(
      parseable.map((event) => {
        const siblingEvents = eventsByTx.get(event.txHash) ?? [];
        const context = { blockTimestampMs: block.timestampMs, siblingEvents };
        return this.registry.parse(event, context);
      }),
    );

    // ── 6. Reconstruct RawSwap → NormalizedTrade ───────────────────────────
    const trades: NormalizedTrade[] = [];
    for (const result of parseResults) {
      if (result.status === 'rejected') {
        logger.warn('Parse failed', {
          error: result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        });
        continue;
      }
      if (result.value === null) continue;

      const trade = reconstructTrade(result.value);
      if (trade !== null) trades.push(trade);
    }

    return trades;
  }
}
