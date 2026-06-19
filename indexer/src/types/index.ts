// ── Block ─────────────────────────────────────────────────────────────────────

/** Normalised block shape used throughout the indexer pipeline. */
export interface IndexedBlock {
  number: bigint;
  hash: `0x${string}`;
  parentHash: `0x${string}`;
  timestamp: bigint;
  /** Unix epoch milliseconds — convenience alias for timestamp. */
  timestampMs: number;
  miner: `0x${string}`;
  gasUsed: bigint;
  gasLimit: bigint;
  transactionCount: number;
  /** Raw transaction hashes in block order. */
  transactions: readonly `0x${string}`[];
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

export interface Checkpoint {
  lastProcessedBlock: number;
  updatedAt: string; // ISO-8601
}

// ── Raw events ────────────────────────────────────────────────────────────────

/**
 * A single log entry extracted from a transaction receipt.
 * Protocol-neutral — parsers consume this and produce typed output.
 */
export interface RawEvent {
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  /** The contract that emitted the log (pair address for AMM swaps). */
  contractAddress: `0x${string}`;
  /** topics[0] is always the event signature hash. */
  topics: readonly `0x${string}`[];
  /** ABI-encoded non-indexed parameters. */
  data: `0x${string}`;
  /** Wallet that sent the transaction — populated from receipt.from. */
  wallet: `0x${string}`;
}

// ── Parsed swap internals ─────────────────────────────────────────────────────

/** Raw decoded amounts and addresses from a PancakeSwap V2 Swap log. */
export interface DecodedV2Swap {
  sender: `0x${string}`;
  to: `0x${string}`;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
}

// ── Normalized trade ──────────────────────────────────────────────────────────

export type Dex = 'pancakeswap-v2' | 'pancakeswap-v3' | 'pancakeswap-v4' | 'thena';

/**
 * Canonical trade format for the entire platform.
 * Every DEX parser must produce this shape.
 */
export interface NormalizedTrade {
  txHash: `0x${string}`;
  blockNumber: bigint;
  /** Position of the Swap event log within the transaction receipt. Used for FIFO ordering within a block. */
  logIndex: number;
  /** Unix epoch milliseconds of the containing block. */
  blockTimestampMs: number;
  /** EOA that sent the swap transaction. */
  wallet: `0x${string}`;
  /** Pair / pool contract that emitted the Swap event. */
  pairAddress: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  dex: Dex;
}

// ── Raw swap (protocol-neutral intermediate) ──────────────────────────────────

/**
 * Common intermediate produced by every DEX parser.
 * Amounts use a unified **swapper perspective**:
 *   positive → user received this token  (amountOut leg)
 *   negative → user sent this token      (amountIn leg)
 *
 * Conversion by protocol:
 *   V2:  amount0 = amount0Out − amount0In   (net of unsigned in/out values)
 *   V3:  amount0 = −poolAmount0             (negate pool-perspective to swapper)
 *   V4:  amount0 = decoded.amount0          (already swapper perspective on-chain)
 *
 * token0/token1 are present for V2 and V3 (resolved via pool.token0()/token1()).
 * They are absent for V4 — TradeReconstructor derives them from ERC-20 Transfers.
 */
export interface RawSwap {
  txHash:           `0x${string}`;
  blockNumber:      bigint;
  logIndex:         number;       // Swap event position in receipt
  blockTimestampMs: number;
  wallet:           `0x${string}`;
  contractAddress:  `0x${string}`; // pair for V2/V3, PoolManager for V4
  dex:              Dex;
  amount0:          bigint;
  amount1:          bigint;
  token0?:          `0x${string}`; // absent for V4
  token1?:          `0x${string}`; // absent for V4
  /** All events from the same tx receipt — required for V4 Transfer-based derivation. */
  siblingEvents:    readonly RawEvent[];
}

// ── V4 swap internals ─────────────────────────────────────────────────────────

/** Typed representation of a decoded PancakeSwap V4 Swap event. */
export interface DecodedV4Swap {
  poolId:       `0x${string}`; // bytes32 (indexed)
  sender:       `0x${string}`; // address (indexed)
  amount0:      bigint;        // int128 — positive = into pool, negative = out
  amount1:      bigint;        // int128 — positive = into pool, negative = out
  sqrtPriceX96: bigint;        // uint160 — post-swap price
  liquidity:    bigint;        // uint128
  tick:         number;        // int24
  fee:          number;        // uint24
  protocolFee:  number;        // uint16
}

// ── Parser context ────────────────────────────────────────────────────────────

export interface ParseContext {
  blockTimestampMs: number;
  /**
   * All RawEvents extracted from the same transaction receipt.
   * Passed by the processor so parsers can use cross-event data — for example,
   * V4 uses ERC-20 Transfer events to identify which tokens were swapped because
   * the pool currency pair cannot be derived from the Swap event alone.
   */
  siblingEvents: RawEvent[];
}

// ── Processor ─────────────────────────────────────────────────────────────────

export interface ProcessorOptions {
  /** Blocks processed per batch cycle. Default: 100. */
  batchSize: number;
  /** Milliseconds to wait between batch cycles. Default: 200. */
  delayMs: number;
  /** Max concurrent getBlock calls per network round-trip. Default: 5. */
  fetchConcurrency: number;
  /** Max concurrent getTransactionReceipt calls. Default: 10. */
  receiptConcurrency: number;
}

/**
 * Called once per block with the block metadata and all normalized trades
 * discovered inside it (may be empty if no swaps occurred).
 */
export type BlockHandler = (block: IndexedBlock, trades: NormalizedTrade[]) => Promise<void>;
