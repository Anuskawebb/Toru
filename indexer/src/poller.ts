import { getLatestBlock } from './chains/bsc.js';
import { CheckpointService } from './services/checkpoint.js';
import { logger } from './logger.js';
import { env } from './config/env.js';
import type { BlockProcessor } from './processor.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── BlockPoller ───────────────────────────────────────────────────────────────

/**
 * Runs the indexer continuously — polls BSC every POLL_INTERVAL_MS, processes
 * any blocks produced since the last checkpoint, then waits.
 *
 * Each tick:
 *   1. Read checkpoint  → where we last stopped
 *   2. Fetch chain head → where BSC is now
 *   3. If checkpoint < head: hand the range to BlockProcessor
 *   4. Sleep until next tick
 *
 * Errors in a single tick are logged and swallowed — the next tick retries
 * from the same checkpoint so no blocks are silently skipped.
 *
 * Graceful shutdown: call stop() or send SIGINT / SIGTERM.
 */
export class BlockPoller {
  private running     = false;
  private cycleCount  = 0;

  private readonly processor:   BlockProcessor;
  private readonly checkpoint:  CheckpointService;
  private readonly intervalMs:  number;

  constructor(processor: BlockProcessor, intervalMs = env.POLL_INTERVAL_MS) {
    this.processor  = processor;
    // Shares the same checkpoint.json as the processor — whichever writes last wins,
    // so checkpoint always reflects the true high-water mark.
    this.checkpoint = new CheckpointService();
    this.intervalMs = intervalMs;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Starts the poll loop. Resolves only after stop() is called. */
  async start(): Promise<void> {
    this.running = true;

    logger.info('Live block poller started', {
      intervalMs: this.intervalMs,
      checkpoint: env.CHECKPOINT_FILE,
    });

    // Graceful shutdown on Ctrl-C and container stop signals
    const onSignal = (): void => this.stop();
    process.once('SIGINT',  onSignal);
    process.once('SIGTERM', onSignal);

    while (this.running) {
      this.cycleCount++;

      try {
        await this.tick();
      } catch (err) {
        // Transient RPC error — log and carry on. The checkpoint hasn't moved
        // so the next tick will retry the same block range.
        logger.error('Poll cycle failed — will retry next tick', {
          cycle: this.cycleCount,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (this.running) {
        await sleep(this.intervalMs);
      }
    }

    logger.info('Poller stopped', { totalCycles: this.cycleCount });
  }

  /** Signals the loop to exit after the current tick completes. */
  stop(): void {
    logger.info('Shutdown signal received — finishing current batch…');
    this.running = false;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    const [lastProcessed, head] = await Promise.all([
      this.checkpoint.getLastProcessedBlock(),
      getLatestBlock(),
    ]);

    const headNumber = Number(head.number);

    // On first run with no checkpoint, start from the current head so we don't
    // backfill the entire chain on launch.
    const fromBlock = lastProcessed !== null ? lastProcessed + 1 : headNumber;

    if (fromBlock > headNumber) {
      logger.debug('At chain head — waiting for next block', {
        head:  headNumber,
        cycle: this.cycleCount,
      });
      return;
    }

    const newBlocks = headNumber - fromBlock + 1;

    logger.info('Processing new blocks', {
      from:      fromBlock,
      to:        headNumber,
      count:     newBlocks,
      cycle:     this.cycleCount,
    });

    await this.processor.processRange(BigInt(fromBlock), BigInt(headNumber));
  }
}
