# 03 — Block Processing

## Entry Points

The indexer supports two execution modes, selected by environment variables:

```ts
// src/index.ts

if (envStart !== undefined && envEnd !== undefined) {
  await runBatch(BigInt(envStart), BigInt(envEnd));  // one-shot
} else {
  await runLive();                                   // continuous
}
```

### Batch Mode

Set `BLOCK_START` and `BLOCK_END` to process a specific range and exit:

```sh
BLOCK_START=104740000 BLOCK_END=104740500 pnpm start
```

`BlockProcessor.processRange()` is called directly. The process exits when
the range is exhausted.

### Live Mode

No environment variables set. `BlockPoller` is created, wrapping the same
`BlockProcessor`. Polls BSC every `POLL_INTERVAL_MS` (default 3000ms) for
new blocks and processes them in order.

---

## Live Mode: `BlockPoller` (`src/poller.ts`)

```
start()
  ↓
  while running:
    tick()
      ├── checkpoint.getLastProcessedBlock()  ← current high-water mark
      ├── getLatestBlock()                    ← current chain head
      │
      ├── fromBlock = checkpoint + 1 (or head if no checkpoint)
      │
      └── if fromBlock ≤ head:
            processor.processRange(fromBlock, head)
    sleep(POLL_INTERVAL_MS)
```

**Key behaviours:**

- On first run with no checkpoint: starts from the current chain head.
  The indexer does NOT attempt to backfill the entire chain on cold start.
- Transient tick errors (RPC failures, timeouts) are caught and logged.
  The checkpoint does not advance, so the next tick retries the same range.
- Graceful shutdown: `SIGINT`/`SIGTERM` sets `running = false`. The current
  tick completes before the process exits — no partial blocks.
- `stop()` can be called programmatically (e.g., from tests).

---

## `BlockProcessor` (`src/processor.ts`)

`processRange(fromBlock, toBlock)` is the core loop. It slices the range
into batches of `BATCH_SIZE` blocks and processes them sequentially:

```
processRange(fromBlock, toBlock)
  for each batch [start, end] of size BATCH_SIZE:
    1. getBlocksInRange(start, end, FETCH_CONCURRENCY)
    2. for each block in batch:
         processBlock(block)
    if not last batch: sleep(BATCH_DELAY_MS)
```

### Step 1 — Fetch Blocks (`src/chains/bsc.ts`)

```ts
getBlocksInRange(fromBlock, toBlock, concurrency)
```

- Fetches blocks in sliding windows of `concurrency` (default 5).
- Each window is a `Promise.all` — up to 5 concurrent `eth_getBlockByNumber`
  calls.
- Windows are sequential — window N+1 starts only after window N resolves.
- Returns `IndexedBlock[]` in ascending block-number order.

### Step 2 — Per-Block Processing

```
processBlock(block)
  trades = extractTrades(block)
  handler(block, trades)            ← calls handleBlock() in index.ts
  checkpoint.saveLastProcessedBlock()
```

The checkpoint advances only after `handler` completes. If `handler` throws,
the checkpoint does not advance — the next run reprocesses the same block.

### Step 3 — `extractTrades(block)` — The Core Pipeline

```
block.transactions (hash list)
  ↓
getTransactionReceipts(hashes, RECEIPT_CONCURRENCY)
  ↓
receipts.flatMap(extractEvents)    → RawEvent[] (all logs)
  ↓
build eventsByTx Map               → sibling events for V4 token derivation
  ↓
filter: registry.canParse(event)   → parseable events only
  ↓
Promise.allSettled(parsers.map(parse))   → RawSwap | null per event
  ↓
reconstructTrade(rawSwap)          → NormalizedTrade | null per swap
  ↓
dedup by seen Set                  → discard exact duplicates
  ↓
return NormalizedTrade[]
```

**Concurrency model within `extractTrades`:**

- Receipt fetching: `Promise.allSettled` in windows of `RECEIPT_CONCURRENCY`
  (default 10). One failed receipt is skipped with a warning.
- Parsing: all parseable events within one block are parsed concurrently
  (`Promise.allSettled` over the full list). Each parser may make async RPC
  calls (pair cache lookups).
- Reconstruction: synchronous per-event, sequentially after all parsers resolve.

**In-memory deduplication:**

```ts
// processor.ts line 217
const key = `${trade.txHash}|${trade.tokenIn.toLowerCase()}|
             ${trade.tokenOut.toLowerCase()}|${trade.amountIn}|${trade.amountOut}`;
if (seen.has(key)) continue;
seen.add(key);
```

This prevents the V4 multi-hop case where multiple Swap events in the same
tx can produce duplicate `NormalizedTrade` objects when `fromTransfers` is
used (since it reads wallet-level transfers, which are the same regardless of
which Swap event triggered the reconstruction).

---

## Checkpoint Behavior

| Scenario | Outcome |
|---|---|
| No checkpoint file | Starts from current chain head (live) or `BLOCK_START` (batch) |
| Checkpoint exists | Resumes from `lastProcessedBlock + 1` |
| Handler throws | Checkpoint not advanced; block reprocessed on restart |
| Receipt fetch fails | Receipt skipped; other receipts in block continue; checkpoint still advances |
| Mid-batch crash | Restarts from the last successfully checkpointed block |

The checkpoint is also written to PostgreSQL (`indexer_state` table) via
`IndexerStateRepository.saveCheckpoint('bsc', block.number)` inside
`handleBlock()`. The file-based checkpoint is the authoritative resume source
on restart; the DB record supports observability dashboards.

---

## Block Handler (`src/index.ts handleBlock`)

`handleBlock(block, trades)` is the consumer of `NormalizedTrade[]`. It runs
after `extractTrades` completes for each block.

**Steps:**
1. `IndexerStateRepository.saveCheckpoint()` — DB checkpoint update.
2. If `trades.length === 0`: log debug and return.
3. `resolveTokenMeta(address)` for all unique token addresses in parallel.
4. Batch build `tradesToInsert` and `tokensToUpsert`.
5. `TradeRepository.insertTrades(tradesToInsert)` — batch insert.
6. `TokenRepository.upsertToken(...)` per unique token.
7. `TokenDiscoveryQueueRepository.enqueueToken(...)` for tokens missing
   `imageUrl` or `coingeckoId`.
8. `printTrade(trade)` for each trade (stdout display).

**Error handling in handler:** DB failures are caught and logged but do not
abort the handler. The checkpoint still advances. This means DB errors cause
missed trades, not a crash loop. This trade-off was intentional — a DB outage
should not block the indexer from advancing its position on the chain.

---

## Retry and Fault Tolerance Summary

| Layer | Retry mechanism |
|---|---|
| viem transport | 3 retries, 1s delay, 30s timeout (configured in `bsc.ts`) |
| Block fetch failure | Propagates to `processRange` → `poller.tick` error catch → logged, retried next poll |
| Receipt fetch failure | `Promise.allSettled` — failed receipt skipped, rest continue |
| Parse failure | `Promise.allSettled` — failed parse logged, rest continue |
| Reconstruction failure | Returns `null`, skipped |
| DB insert failure | Logged, checkpoint still advances |
| Handler failure | Checkpoint not advanced (crash path); poller retries next tick |
