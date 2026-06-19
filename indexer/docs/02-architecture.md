# 02 — Architecture

## Component Map

```
indexer/src/
├── index.ts                     Entry point. Wires all components; owns handleBlock().
├── processor.ts                 BlockProcessor: batch-fetches blocks and receipts.
├── poller.ts                    BlockPoller: live polling loop (3s interval).
├── logger.ts                    JSON line logger (stdout / stderr).
├── chains/
│   └── bsc.ts                   viem public client. Block and receipt fetch helpers.
├── config/
│   └── env.ts                   Validated env var config (fail-fast on startup).
├── extractors/
│   └── events.ts                Receipt → RawEvent[]. Single function.
├── parsers/
│   ├── index.ts                 EventParser interface.
│   ├── registry.ts              ParserRegistry: canParse() + parse() dispatch.
│   ├── pancakeswap-v2.ts        V2 Swap decoder.
│   ├── pancakeswap-v3.ts        V3 Swap decoder.
│   └── pancakeswap-v4.ts        V4 Swap decoder.
├── reconstruction/
│   └── trade-reconstructor.ts   RawSwap → NormalizedTrade. Token direction logic.
├── cache/
│   ├── pair-cache.ts            Pair address → {token0, token1}. Process-lifetime cache.
│   └── token-cache.ts           Token address → {symbol, decimals}. Process-lifetime cache.
├── services/
│   └── checkpoint.ts            Reads and writes checkpoint.json.
├── tokens/
│   └── registry.ts              Static token registry (15 known tokens). formatAmount().
└── types/
    └── index.ts                 All shared TypeScript interfaces.
```

---

## Components

### `chains/bsc.ts`

**Responsibility:** BSC node interaction. One module, one client.

**Inputs:** `BSC_RPC_URL` environment variable.

**Outputs:** `IndexedBlock`, `TransactionReceipt[]`.

**Key design points:**
- Uses viem's `createPublicClient` with `bsc` chain preset (chainId 56).
- `http()` transport configured with `retryCount: 3`, `retryDelay: 1000ms`,
  `timeout: 30s`. Viem handles retries internally — the caller does not retry.
- `multicall: { wait: 16 }` enables viem's request batching for `readContract`
  calls (used by pair-cache and token-cache).
- `getBlocksInRange()` fetches blocks in windows of `concurrency` using
  `Promise.all`. Never requests more than `FETCH_CONCURRENCY` blocks in
  parallel.
- `getTransactionReceipts()` uses `Promise.allSettled` — one failed receipt
  logs a warning and is skipped; it does not abort the whole block.
- `normalise()` converts viem's `GetBlockReturnType` to the internal
  `IndexedBlock` shape. Throws if `block.number` or `block.hash` is null
  (pending block).

**Dependencies:** `config/env.ts`, `types/index.ts`, `logger.ts`.

---

### `config/env.ts`

**Responsibility:** Fail-fast environment variable validation at startup.

**Inputs:** `process.env`.

**Outputs:** Frozen `env` object, re-exported as `Env` type.

**Key design points:**
- `requireString` throws immediately if a variable is absent — no "undefined
  config" bugs at runtime.
- `optionalInt` validates that the value is a positive integer; rejects
  decimals, negatives, and non-numeric strings.
- `LOG_LEVEL` validated against the four accepted strings; rejects typos.
- Exports a `const env` object — callers read `env.BSC_RPC_URL`, never
  `process.env['BSC_RPC_URL']`.

**Variables:**

| Variable | Type | Default | Notes |
|---|---|---|---|
| `BSC_RPC_URL` | string | required | Any BSC-compatible JSON-RPC endpoint |
| `CHECKPOINT_FILE` | string | `./checkpoint.json` | File path for the file-based checkpoint |
| `BATCH_SIZE` | int | 100 | Blocks per processor batch cycle |
| `BATCH_DELAY_MS` | int | 200 | ms delay between batch cycles |
| `FETCH_CONCURRENCY` | int | 5 | Concurrent block fetches per window |
| `RECEIPT_CONCURRENCY` | int | 10 | Concurrent receipt fetches per window |
| `POLL_INTERVAL_MS` | int | 3000 | ms between live polling ticks |
| `LOG_LEVEL` | enum | `info` | `debug` \| `info` \| `warn` \| `error` |

---

### `extractors/events.ts`

**Responsibility:** Turn a transaction receipt into `RawEvent[]`.

**Inputs:** `TransactionReceipt` from viem.

**Outputs:** `RawEvent[]` — one entry per log line.

**Key design points:**
- Reverted transactions return `[]` immediately (no logs processed).
- Every log in the receipt becomes a `RawEvent` regardless of protocol.
  The `canParse()` filter in `ParserRegistry` discards irrelevant events later.
- `wallet` is always `receipt.from` — the EOA that signed and submitted the
  transaction. This is set once here and propagated through the entire pipeline.
  No downstream code needs to fetch the transaction itself.
- `logIndex` uses `log.logIndex ?? i` — the `??` fallback handles the edge
  case where viem returns `null` for log index (seen in some BSC archive nodes).

---

### `parsers/index.ts` — `EventParser` interface

```ts
interface EventParser {
  readonly name: string;
  canParse(event: RawEvent): boolean;
  parse(event: RawEvent, context: ParseContext): Promise<RawSwap | null>;
}
```

- `canParse` is synchronous and O(1). Called for every log in every block.
  Compares `event.topics[0]` against the parser's known event signature hash.
- `parse` is async (may call the chain). Returns `null` to skip an event
  gracefully (malformed data, flash swap, known edge case).
- Parsers do **not** produce `NormalizedTrade`. That responsibility belongs
  exclusively to `TradeReconstructor`.

---

### `parsers/registry.ts` — `ParserRegistry`

**Responsibility:** Route a `RawEvent` to the correct parser.

**Key design points:**
- Parsers are registered in order. `canParse()` is evaluated left-to-right;
  the first matching parser handles the event.
- V2, V3, and V4 have distinct `topics[0]` values, so there is no ambiguity.
- `ParserRegistry.parse()` is called concurrently for all parseable events
  in a block via `Promise.allSettled`. Parser errors are caught there.
- Adding a parser: implement `EventParser`, call `registry.register(parser)`.

---

### `reconstruction/trade-reconstructor.ts`

**Responsibility:** Convert `RawSwap` → `NormalizedTrade`. All trade direction
and token identity logic lives here.

**Inputs:** `RawSwap` (from any parser).

**Outputs:** `NormalizedTrade | null`.

**Three reconstruction strategies (applied in order):**

1. **`fromPair` (V2, V3):** `token0` and `token1` are known. Read `amount0`
   and `amount1` signs to determine which is tokenIn vs tokenOut.
2. **`resolveV4Tokens` → `fromPair` (V4, primary):** Match ERC-20 Transfer
   amounts in sibling events against the Swap amounts to identify token0 and
   token1. Then call `fromPair`.
3. **`fromTransfers` (V4, fallback):** Read wallet-level ERC-20 Transfers
   directly (from wallet = sold, to wallet = received). Used when amount
   matching in step 2 fails.

See `06-trade-reconstruction.md` for full detail.

---

### `cache/pair-cache.ts`

**Responsibility:** Cache the `token0`/`token1` pair for every V2/V3 pool.

**Key design points:**
- Two `Map`s: `inflight` (in-progress promises) and `resolved` (completed results).
- If a second request for the same pair arrives while the first RPC call is
  still in-flight, it receives the same `Promise` — coalescing N concurrent
  requests into one RPC call.
- Results never expire. Token pairs are immutable on-chain.
- Uses `bscClient.readContract` which goes through viem's multicall batching.

---

### `cache/token-cache.ts`

**Responsibility:** Cache `symbol` and `decimals` for every token address.

**Resolution order (per address):**
1. `tokens/registry.ts` static map (zero RPC — 15 known tokens)
2. In-memory `resolved` Map
3. On-chain `readContract` for `symbol()` + `decimals()` (parallel)
4. Fallback: `{ symbol: address.slice(0,8)+'…', decimals: 18 }` for tokens
   with non-standard ABIs (bytes32 symbol, proxy without ABI, etc.)

Same coalescing pattern as `pair-cache.ts`. Results never expire.

---

### `services/checkpoint.ts` — `CheckpointService`

**Responsibility:** Persist the high-water mark for block processing.

**Storage:** A JSON file at `CHECKPOINT_FILE` (default `./checkpoint.json`).

```json
{ "lastProcessedBlock": 104740269, "updatedAt": "2026-06-17T10:14:00.000Z" }
```

**Key design points:**
- `getLastProcessedBlock()` returns `null` on first run (no file). Returns
  `number` (not `bigint`) — the block number is always safe as a JS integer.
- `saveLastProcessedBlock()` writes atomically via `fs.promises.writeFile`.
- If the file exists but contains invalid JSON or wrong shape, an error is
  thrown immediately — no silent corruption.
- In live mode (`BlockPoller`), the checkpoint is also saved to PostgreSQL via
  `IndexerStateRepository.saveCheckpoint()` in `handleBlock()`. The two
  storage locations are independent — the file is the primary resume source
  on restart; the DB record is for observability.

---

### `tokens/registry.ts`

**Responsibility:** Static map of well-known BSC token addresses plus
`formatAmount()`.

**Key design points:**
- 15 tokens hardcoded: WBNB, USDT, USDC, BUSD, DAI, ETH, BTCB, CAKE, ADA,
  LINK, XRP, BCH, DOT + FDUSD not yet listed.
- All BSC stablecoins use 18 decimals (unlike Ethereum where USDT/USDC are 6).
  This is correct for BSC and is explicitly noted in the source.
- `lookupStatic()` lowercases the input before lookup — address casing is
  irrelevant here.
- `formatAmount(raw, decimals)` converts a raw `bigint` to a human-readable
  decimal string. Caps the fractional part at 6 characters, strips trailing
  zeros. Does not use floating point — pure bigint arithmetic to avoid
  precision loss on large token amounts.

---

### `logger.ts`

**Responsibility:** Minimal structured logger. No dependencies.

**Format:** One JSON line per log entry, written to `stdout` (info/debug) or
`stderr` (warn/error). Always includes `ts`, `level`, `msg`. Additional
context fields are spread into the same object.

```json
{"ts":"2026-06-17T10:14:00.000Z","level":"info","msg":"Block processed","block":"104740170","swapCount":17}
```

**Key design points:**
- Reads `LOG_LEVEL` directly from `process.env` to avoid a circular import
  with `config/env.ts`.
- No external logging libraries — one file, zero dependencies.
- `debug` level is off by default (`LOG_LEVEL=info`). Enable with
  `LOG_LEVEL=debug` to see per-pair and per-trade decode details.

---

## Dependency Graph

```
index.ts
├── processor.ts
│   ├── chains/bsc.ts ─── config/env.ts
│   ├── extractors/events.ts
│   ├── parsers/registry.ts
│   │   ├── parsers/pancakeswap-v2.ts
│   │   │   └── cache/pair-cache.ts ─── chains/bsc.ts
│   │   ├── parsers/pancakeswap-v3.ts
│   │   │   └── cache/pair-cache.ts
│   │   └── parsers/pancakeswap-v4.ts
│   ├── reconstruction/trade-reconstructor.ts
│   └── services/checkpoint.ts
├── poller.ts
│   └── services/checkpoint.ts
└── cache/token-cache.ts
    └── tokens/registry.ts
```

There are no circular imports. The dependency direction is:
`entry point → orchestration → protocol → infrastructure`.
