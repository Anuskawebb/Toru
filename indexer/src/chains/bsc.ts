import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import type { IndexedBlock } from '../types/index.js';

// ── Client ────────────────────────────────────────────────────────────────────

export const bscClient = createPublicClient({
  chain: bsc,
  transport: http(env.BSC_RPC_URL, {
    retryCount: 3,
    retryDelay: 1_000,
    timeout: 30_000,
  }),
  batch: {
    multicall: { wait: 16 },
  },
});

// ── Normalisation ─────────────────────────────────────────────────────────────

type RawBlock = Awaited<ReturnType<typeof bscClient.getBlock>>;

function normalise(raw: RawBlock): IndexedBlock {
  if (raw.number === null || raw.hash === null) {
    throw new Error('Received pending block — only finalised blocks are supported');
  }

  return {
    number:           raw.number,
    hash:             raw.hash,
    parentHash:       raw.parentHash,
    timestamp:        raw.timestamp,
    timestampMs:      Number(raw.timestamp) * 1_000,
    miner:            raw.miner,
    gasUsed:          raw.gasUsed,
    gasLimit:         raw.gasLimit,
    transactionCount: raw.transactions.length,
    // getBlock with includeTransactions: false returns Hash[]; cast is safe
    transactions:     raw.transactions as readonly `0x${string}`[],
  };
}

// ── Block helpers ─────────────────────────────────────────────────────────────

/** Returns the current chain head as a normalised IndexedBlock. */
export async function getLatestBlock(): Promise<IndexedBlock> {
  logger.debug('Fetching latest block');
  const raw = await bscClient.getBlock({ blockTag: 'latest' });
  return normalise(raw);
}

/** Fetches a single block by number. */
export async function getBlock(blockNumber: bigint): Promise<IndexedBlock> {
  logger.debug('Fetching block', { blockNumber: blockNumber.toString() });
  const raw = await bscClient.getBlock({ blockNumber });
  return normalise(raw);
}

/**
 * Fetches all blocks in [fromBlock, toBlock] inclusive.
 * Requests are batched into windows of `concurrency` to avoid overwhelming
 * public RPCs.
 */
export async function getBlocksInRange(
  fromBlock: bigint,
  toBlock: bigint,
  concurrency = env.FETCH_CONCURRENCY,
): Promise<IndexedBlock[]> {
  if (fromBlock > toBlock) {
    throw new RangeError(`fromBlock (${fromBlock}) must be ≤ toBlock (${toBlock})`);
  }

  const blockNumbers: bigint[] = [];
  for (let n = fromBlock; n <= toBlock; n++) blockNumbers.push(n);

  logger.debug('Fetching block range', {
    fromBlock: fromBlock.toString(),
    toBlock:   toBlock.toString(),
    total:     blockNumbers.length,
    concurrency,
  });

  const results: IndexedBlock[] = [];

  for (let i = 0; i < blockNumbers.length; i += concurrency) {
    const window = blockNumbers.slice(i, i + concurrency);
    const batch = await Promise.all(
      window.map((n) => bscClient.getBlock({ blockNumber: n }).then(normalise)),
    );
    results.push(...batch);
  }

  return results;
}

// ── Receipt helpers ───────────────────────────────────────────────────────────

export type TransactionReceipt = Awaited<
  ReturnType<typeof bscClient.getTransactionReceipt>
>;

/** Fetches the receipt for a single transaction hash. */
export async function getTransactionReceipt(
  txHash: `0x${string}`,
): Promise<TransactionReceipt> {
  return bscClient.getTransactionReceipt({ hash: txHash });
}

// ── Receipt stats (reset per getTransactionReceipts call) ────────────────────

export interface ReceiptStats {
  total:      number;
  succeeded:  number;
  failed:     number;
  failed403:  number;
  failedOther: number;
}

export let lastReceiptStats: ReceiptStats = {
  total: 0, succeeded: 0, failed: 0, failed403: 0, failedOther: 0,
};

/**
 * Fetches receipts for a list of transaction hashes in batched concurrent
 * windows. Skips failed individual receipts (logs a warning) so one bad tx
 * does not abort the whole block. Updates `lastReceiptStats` for the caller.
 */
export async function getTransactionReceipts(
  txHashes: readonly `0x${string}`[],
  concurrency: number,
): Promise<TransactionReceipt[]> {
  lastReceiptStats = { total: 0, succeeded: 0, failed: 0, failed403: 0, failedOther: 0 };

  if (txHashes.length === 0) return [];

  lastReceiptStats.total = txHashes.length;
  const results: TransactionReceipt[] = [];

  for (let i = 0; i < txHashes.length; i += concurrency) {
    const window = txHashes.slice(i, i + concurrency);

    const settled = await Promise.allSettled(
      window.map((hash) => bscClient.getTransactionReceipt({ hash })),
    );

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
        lastReceiptStats.succeeded++;
      } else {
        const msg = outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
        const is403 = msg.includes('403');
        lastReceiptStats.failed++;
        if (is403) lastReceiptStats.failed403++;
        else        lastReceiptStats.failedOther++;
        logger.warn('Receipt fetch failed — skipping tx', { error: msg });
      }
    }
  }

  return results;
}
