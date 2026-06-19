# 07 — Data Models

All types are defined in `src/types/index.ts`. This document provides
field-by-field explanations for every type used in the pipeline.

---

## `IndexedBlock`

```ts
interface IndexedBlock {
  number:           bigint;
  hash:             `0x${string}`;
  parentHash:       `0x${string}`;
  timestamp:        bigint;           // Unix epoch seconds (BSC block time)
  timestampMs:      number;           // timestamp * 1000 (milliseconds)
  miner:            `0x${string}`;
  gasUsed:          bigint;
  gasLimit:         bigint;
  transactionCount: number;
  transactions:     readonly `0x${string}`[];  // tx hashes in block order
}
```

**`number`** — `bigint` because BSC block numbers can exceed `Number.MAX_SAFE_INTEGER`
in the distant future. All comparison and arithmetic uses `bigint`.

**`timestamp`** — BSC uses seconds (Ethereum standard). `timestampMs` is a
pre-computed convenience alias so callers don't repeat `Number(ts) * 1000`.

**`transactions`** — hash list only, not full transaction objects. Full
transactions are not needed; receipt fetching uses the hash directly.

**What's absent:** Gas price, nonce, difficulty, uncles. Not needed by
the indexer and deliberately excluded to keep the type lean.

---

## `RawEvent`

```ts
interface RawEvent {
  txHash:          `0x${string}`;
  blockNumber:     bigint;
  logIndex:        number;
  contractAddress: `0x${string}`;
  topics:          readonly `0x${string}`[];
  data:            `0x${string}`;
  wallet:          `0x${string}`;
}
```

**`logIndex`** — position of this log within the transaction receipt's log
array. Used for ordering events within a receipt. May be a fallback index
value (`i`) when the BSC node returns `null` for `log.logIndex`.

**`contractAddress`** — the contract that emitted this event (pair address
for V2/V3 Swap events; PoolManager address for V4; token address for Transfers).

**`topics`** — array of 32-byte indexed parameters. `topics[0]` is always the
event signature hash (keccak256 of the event ABI signature). For V2 Swap:
`[sig_hash, sender, to]`. Length varies by event type.

**`data`** — hex string of ABI-encoded non-indexed parameters. Parsers slice
this directly rather than using a full ABI decoder, for performance.

**`wallet`** — inherited from `receipt.from`. Set once in `extractEvents`,
never changed. Represents the EOA that initiated the transaction.

---

## `DecodedV2Swap`

```ts
interface DecodedV2Swap {
  sender:     `0x${string}`;
  to:         `0x${string}`;
  amount0In:  bigint;
  amount1In:  bigint;
  amount0Out: bigint;
  amount1Out: bigint;
}
```

Intermediate type used only within the V2 parser. Not exported to other
modules. Values are unsigned `uint256` directly from the ABI encoding.

`sender` is typically the router contract. `to` is typically the next contract
in the call chain or the user's wallet for single-hop swaps.

Neither `sender` nor `to` is used for wallet attribution — that always comes
from `receipt.from`.

---

## `DecodedV3Swap`

```ts
interface DecodedV3Swap {
  sender:       `0x${string}`;
  recipient:    `0x${string}`;
  poolAmount0:  bigint;   // pool perspective (positive = into pool)
  poolAmount1:  bigint;
  sqrtPriceX96: bigint;
  liquidity:    bigint;
  tick:         number;
}
```

Exported from `parsers/pancakeswap-v3.ts`. Amounts are in pool perspective
(not negated yet). The parser negates before storing in `RawSwap`.

`sqrtPriceX96`, `liquidity`, and `tick` are not used in the current
reconstruction pipeline but are decoded for completeness and future use
(e.g., price-at-time-of-trade for PnL without a separate oracle query).

---

## `DecodedV4Swap`

```ts
interface DecodedV4Swap {
  poolId:       `0x${string}`;   // bytes32 pool identifier
  sender:       `0x${string}`;   // router / hook (NOT the wallet)
  amount0:      bigint;           // swapper perspective — positive = received
  amount1:      bigint;
  sqrtPriceX96: bigint;
  liquidity:    bigint;
  tick:         number;
  fee:          number;           // hundredths of a basis point (e.g., 800 = 0.08%)
  protocolFee:  number;           // uint16
}
```

`poolId` is `keccak256(abi.encode(PoolKey))` where `PoolKey` is the struct
`{currency0, currency1, fee, tickSpacing, hooks}`. The PoolId cannot be
reversed to recover `currency0`/`currency1` — that's why token identity must
be derived from Transfer events.

`fee` is NOT the fee the user paid. It is the pool's configured fee tier.
The actual fee paid is `fee` × `amountIn` / 1_000_000.

---

## `RawSwap`

```ts
interface RawSwap {
  txHash:           `0x${string}`;
  blockNumber:      bigint;
  blockTimestampMs: number;
  wallet:           `0x${string}`;
  contractAddress:  `0x${string}`;   // pair for V2/V3; PoolManager for V4
  dex:              Dex;
  amount0:          bigint;           // unified swapper perspective
  amount1:          bigint;           // unified swapper perspective
  token0?:          `0x${string}`;   // present for V2/V3; absent for V4
  token1?:          `0x${string}`;   // present for V2/V3; absent for V4
  siblingEvents:    readonly RawEvent[];
}
```

This is the common intermediate between parsers and `TradeReconstructor`.
All parsers produce this shape; the reconstructor consumes it.

**`amount0` / `amount1` are in unified swapper perspective** regardless of
which protocol produced them:
- V2: `amount0Out - amount0In` (net of unsigned values)
- V3: `-(poolAmount0)` (negated from pool perspective)
- V4: direct from event (already swapper perspective on-chain)

**`siblingEvents`** — all `RawEvent[]` from the same transaction. Passed
through to enable the V4 reconstructor to read Transfer events. Not stored;
used only during reconstruction.

---

## `NormalizedTrade`

See `06-trade-reconstruction.md` for the full field-by-field description.

```ts
interface NormalizedTrade {
  txHash:           `0x${string}`;
  blockNumber:      bigint;
  blockTimestampMs: number;
  wallet:           `0x${string}`;
  pairAddress:      `0x${string}`;
  tokenIn:          `0x${string}`;
  tokenOut:         `0x${string}`;
  amountIn:         bigint;
  amountOut:        bigint;
  dex:              Dex;
}
```

`amountIn` is always positive (user always sold a positive amount).
`amountOut` is always positive (user always received a positive amount).

---

## `Checkpoint`

```ts
interface Checkpoint {
  lastProcessedBlock: number;
  updatedAt: string;   // ISO-8601
}
```

Persisted to `CHECKPOINT_FILE` (default: `./checkpoint.json`).

`lastProcessedBlock` uses `number` (not `bigint`) — block numbers fit safely
within 53-bit JavaScript integer precision for the foreseeable future.

`updatedAt` is informational only. The checkpoint service reads only
`lastProcessedBlock` on load.

---

## `TokenMeta`

```ts
// src/tokens/registry.ts
interface TokenMeta {
  symbol:   string;
  decimals: number;
}
```

Minimal metadata needed for display and amount formatting. Used by
`token-cache.ts` and `tokens/registry.ts`. Notably does NOT include the
token address (the address is the cache key, not stored inside the value).

---

## `TokenPair`

```ts
// src/cache/pair-cache.ts
interface TokenPair {
  token0: `0x${string}`;
  token1: `0x${string}`;
}
```

The canonical token pair for a V2/V3 pool. Fetched once via on-chain
`readContract`, cached indefinitely.

---

## `Dex` Union Type

```ts
// src/types/index.ts
type Dex = 'pancakeswap-v2' | 'pancakeswap-v3' | 'pancakeswap-v4';
```

String literal union for type-safe protocol identification throughout the
codebase. Also stored verbatim in the database `dex` column.

---

## Database Schema

Defined in `packages/db/src/schema/`. Managed by Drizzle ORM.

### `trades`

```sql
CREATE TABLE "trades" (
  "id"               serial PRIMARY KEY,
  "tx_hash"          varchar(66)  NOT NULL,
  "block_number"     bigint       NOT NULL,
  "timestamp"        timestamp    NOT NULL,    -- block timestamp (not tx-level)
  "wallet"           varchar(42)  NOT NULL,
  "dex"              varchar(50)  NOT NULL,
  "token_in_address" varchar(42)  NOT NULL,
  "token_out_address"varchar(42)  NOT NULL,
  "token_in_symbol"  varchar(50)  NOT NULL,
  "token_out_symbol" varchar(50)  NOT NULL,
  "amount_in"        text         NOT NULL,    -- raw BigInt as decimal string
  "amount_out"       text         NOT NULL,
  "created_at"       timestamp    DEFAULT now() NOT NULL
);
```

`amount_in` / `amount_out` are stored as `text` (not `numeric` or `bigint`)
because raw ERC-20 token amounts can exceed PostgreSQL `bigint` (max 9.2×10^18).
For arithmetic in queries, cast to `numeric`: `SUM(amount_in::numeric)`.

Unique index: `(tx_hash, wallet, token_in_address, token_out_address, amount_in, amount_out, dex)`.
Duplicate inserts silently succeed via `ON CONFLICT DO NOTHING`.

### `tokens`

```sql
CREATE TABLE "tokens" (
  "address"     varchar(42)  PRIMARY KEY,
  "symbol"      varchar(50)  NOT NULL,
  "name"        varchar(100) NOT NULL,
  "decimals"    integer      NOT NULL,
  "image_url"   text,
  "coingecko_id"varchar(100),
  "verified"    boolean      DEFAULT false NOT NULL,
  "first_seen_at"timestamp   DEFAULT now() NOT NULL,
  "updated_at"  timestamp    DEFAULT now() NOT NULL
);
```

### `indexer_state`

```sql
CREATE TABLE "indexer_state" (
  "chain"                varchar(50) PRIMARY KEY,
  "last_processed_block" bigint      NOT NULL,
  "updated_at"           timestamp   DEFAULT now() NOT NULL
);
```

Row key is `'bsc'`. Written via `IndexerStateRepository.saveCheckpoint()`.

### `token_discovery_queue`

```sql
CREATE TABLE "token_discovery_queue" (
  "address"         varchar(42) PRIMARY KEY,
  "first_seen_at"   timestamp   DEFAULT now() NOT NULL,
  "attempts"        integer     DEFAULT 0 NOT NULL,
  "last_attempted_at"timestamp,
  "resolved"        boolean     DEFAULT false NOT NULL
);
```

Tokens missing `image_url` or `coingecko_id` are enqueued here for
a background metadata resolution process (not yet implemented).
