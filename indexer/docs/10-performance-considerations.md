# 10 — Performance Considerations

## Observed Throughput

From the validation run (100 blocks, 1,705 trades):

- Block range: 104740170–104740269
- Total trades: 1,705 (average 17.05 per block)
- Protocol split: V2 (56%), V4 (31%), V3 (13%)
- Multi-hop transactions: 194 (11% of all swap txs)
- WBNB-involved swaps: 523 (31%)

BSC produces one block approximately every 3 seconds. At 17 trades/block and
3s/block, the live indexer processes ~340 trades/minute in steady state.

---

## Concurrency Model

### Block Fetching

```ts
// src/chains/bsc.ts
for (let i = 0; i < blockNumbers.length; i += concurrency) {
  const window = blockNumbers.slice(i, i + concurrency);
  const batch = await Promise.all(window.map(n => getBlock(n)));
  results.push(...batch);
}
```

`FETCH_CONCURRENCY` (default 5) controls the sliding window size. Each window
is a `Promise.all` — up to 5 concurrent `eth_getBlockByNumber` calls. Windows
are sequential (window N+1 awaits window N). This bounds peak RPC pressure to
5 concurrent block requests while still parallelizing within each window.

**Tuning:** On a private RPC node (QuickNode, NodeReal), raise to 10–20. On
public RPCs (bsc-dataseed), keep at 3–5 to avoid rate limiting.

### Receipt Fetching

```ts
// src/chains/bsc.ts
for (let i = 0; i < txHashes.length; i += concurrency) {
  const settled = await Promise.allSettled(window.map(h => getTransactionReceipt(h)));
  // ...
}
```

`RECEIPT_CONCURRENCY` (default 10) is separate from `FETCH_CONCURRENCY` because
receipts are larger payloads than block headers but there are more of them per
block (up to ~200 transactions per BSC block). 10 concurrent receipt requests is
a conservative default.

### Parsing

All parseable events within one block are parsed concurrently:

```ts
const parseResults = await Promise.allSettled(
  parseable.map((event) => this.registry.parse(event, context))
);
```

This means all pair cache lookups for all events in a block happen in parallel.
For blocks with many first-seen pairs, this can produce a burst of concurrent
`readContract` calls.

---

## Pair Cache

**Purpose:** Eliminate repeated `eth_call` requests for `token0()`/`token1()`
on the same pair.

**Mechanism:** Two Maps — `inflight` (in-progress Promises) and `resolved`
(completed results). Concurrent lookups for the same pair address coalesce into
a single RPC call:

```ts
const pending = inflight.get(key);
if (pending !== undefined) return pending;   // join the existing call

const promise = fetchPair(pairAddress, key);
inflight.set(key, promise);                  // register; others will join this
return promise;
```

**Lifetime:** Process lifetime. The cache never evicts entries. Token pairs are
immutable on-chain (the pair contract's `token0()` and `token1()` never change).
A long-running indexer process accumulates an entry per unique pair encountered.

**Memory:** Each entry is two 42-character strings + Map overhead ≈ ~200 bytes.
At 10,000 unique pairs (high estimate for BSC), total ≈ 2MB. Not a concern.

**RPC amplification:** Without the cache, every V2/V3 Swap event would require
2 `eth_call`s (one for `token0`, one for `token1`). With viem's multicall
batching (`multicall: { wait: 16 }`), these two calls are batched into one
JSON-RPC request per pair per block. After the first encounter, zero RPC calls.

---

## Token Metadata Cache

**Same pattern as pair cache.** Three-tier resolution:

1. Static registry (zero RPC, ~15 common tokens)
2. In-memory resolved Map
3. On-chain `readContract` for `symbol()` + `decimals()` in parallel

viem multicall batching applies here too — `symbol()` and `decimals()` for
the same token are batched into one JSON-RPC call.

**Memory:** Same as pair cache. Entries never evict. At 50,000 unique tokens
(generous estimate), ≈ 5MB. Not a concern.

---

## Batch Size and Delay

`BATCH_SIZE = 100`: The processor fetches 100 blocks per batch cycle. After
each cycle, it waits `BATCH_DELAY_MS = 200ms` before the next cycle (unless
it's the last batch). This delay throttles sustained load on the RPC endpoint.

**Catchup mode:** If the indexer is far behind the chain head (e.g., after a
restart or a backfill), it processes batches of 100 blocks without delays
between blocks within a batch, only between batches. This maximizes throughput
during catchup while still throttling between cycles.

**Live mode:** `BlockPoller` ticks every 3s. BSC produces one block every ~3s.
Between ticks, `processRange(last+1, head)` typically covers 1 block. The
200ms delay between batches is irrelevant at this scale.

---

## viem Multicall Batching

```ts
// src/chains/bsc.ts
batch: {
  multicall: { wait: 16 },
},
```

`wait: 16` means viem collects all `readContract` calls that arrive within a
16ms window and submits them as a single `eth_call` to the `Multicall3`
contract. This batches:
- All `token0()` + `token1()` calls from the pair cache within the same
  block's parse phase.
- All `symbol()` + `decimals()` calls from the token cache.

**Effect:** A block with 20 first-seen pairs produces 40 individual `readContract`
calls. With multicall batching, these collapse into 1–3 JSON-RPC requests
(depending on the 16ms arrival window). Without batching, 40 JSON-RPC calls.

---

## Memory Footprint

In steady-state live mode:

| Component | Memory |
|---|---|
| Pair cache | ~200 bytes × N unique pairs |
| Token cache | ~150 bytes × N unique tokens |
| Per-block event arrays | Proportional to block's receipt count; GC'd after each block |
| `siblingEvents` per RawSwap | Reference to the same per-tx array — not duplicated |

`siblingEvents` in `RawSwap` holds a reference to the `eventsByTx` array, not
a copy. The array is GC-eligible after `extractTrades` returns and is not
retained in any long-lived structure.

---

## RPC Call Budget (Per Block, Approximate)

| Operation | Calls | Batching |
|---|---|---|
| `eth_getBlockByNumber` | 1 | — |
| `eth_getTransactionReceipt` | N (tx count, up to ~200) | Windowed, 10 at a time |
| `token0()` + `token1()` for new pairs | 2 × P (new pairs) | Multicall-batched |
| `symbol()` + `decimals()` for new tokens | 2 × T (new tokens) | Multicall-batched |
| `checkpoint.saveLastProcessedBlock` | 1 (file write) | — |
| `IndexerStateRepository.saveCheckpoint` | 1 (DB) | — |
| `TradeRepository.insertTrades` | 1 (DB batch) | — |
| `TokenRepository.upsertToken` | T (per unique token) | — |

After the first few thousand blocks, the pair and token caches are warm. The
dominant RPC cost is receipt fetching (proportional to block's transaction
count).

---

## Database Throughput

`TradeRepository.insertTrades` does a single batch insert per block. For a
block with 17 trades, this is one SQL statement with 17 rows. The unique index
check (`ON CONFLICT DO NOTHING`) runs for each row.

At 17 trades/block and 20 blocks/min in live mode: ~340 DB inserts/minute.
This is well within PostgreSQL's capacity (typically 10,000+ simple inserts/sec).

---

## Scaling Limitations

**Current design does not horizontally scale.** The checkpoint is a single
file (or a single DB row for `'bsc'`). Running two instances against the same
checkpoint would cause races.

For higher throughput:
1. Shard by block range (each instance owns a range).
2. Use a Redis-backed checkpoint with compare-and-swap.
3. Replace the in-process caches with a shared Redis cache.

These are not implemented. The current design supports a single process
handling ~20 blocks/minute (live) or ~200 blocks/minute (batch backfill on
a private RPC).
