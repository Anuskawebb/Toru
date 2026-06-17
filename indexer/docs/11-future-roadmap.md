# 11 — Future Roadmap

This document lists realistic next steps in priority order. It clearly
distinguishes between what is implemented and what is planned.

---

## Implemented (Current State)

- PancakeSwap V2 swap indexing
- PancakeSwap V3 swap indexing
- PancakeSwap V4 swap indexing
- Multi-hop trade detection and storage
- Native BNB wrapping/unwrapping (WBNB canonical form)
- Fee-on-transfer token detection (above 0.5% threshold)
- Checkpoint-based resume
- Live block polling
- Batch block range processing
- PostgreSQL trade persistence (`trades` table)
- PostgreSQL token upsert (`tokens` table)
- Token discovery queue (`token_discovery_queue` table)
- Indexer state persistence (`indexer_state` table)
- In-memory pair cache (process-lifetime)
- In-memory token metadata cache (process-lifetime)
- Static token registry (15 common BSC tokens)
- JSON-line structured logging
- Validated env var configuration
- BscScan audit tooling (validate.ts, audit.ts)

---

## Planned — Near Term (Before Analytics)

### 1. Schema Hardening

Three fields should be added to the `trades` table before the analytics
phase begins:

**`token_in_decimals` / `token_out_decimals` (HIGH priority)**

Inline decimals eliminate the JOIN to the `tokens` table for every analytics
query. Values come from `resolveTokenMeta()` which is already called in
`handleBlock()`.

**`log_index` (HIGH priority)**

Enables deterministic ordering within a block. Currently, trades sharing
the same block timestamp cannot be sorted deterministically. `RawEvent.logIndex`
is already populated — it needs to be threaded into `NormalizedTrade` and
the DB schema.

**`pair_address` (MEDIUM priority)**

`NormalizedTrade.pairAddress` is already computed but not persisted to the
trades table. Useful for debugging, pool-level analytics, and V2/V3/V4
routing attribution.

See `schema-review.md` for the full migration plan.

### 2. Address Normalization in Storage Layer

All addresses (`wallet`, `token_in_address`, `token_out_address`) must be
lowercased before DB insert. Currently they carry EIP-55 mixed-case checksum
format from viem, which breaks case-sensitive TEXT comparisons in PostgreSQL.

This is a **blocking** issue — must be fixed before any data reaches the DB.
Four lines in `handleBlock()`.

### 3. Token Metadata Background Resolver

The `token_discovery_queue` table exists but has no consumer. A background
worker should:
1. Poll the queue for unresolved tokens.
2. Fetch CoinGecko metadata (logo URL, CoinGecko ID).
3. Update the `tokens` table with `image_url`, `coingecko_id`, `verified = true`.
4. Mark the queue entry as `resolved = true`.

This is a separate process or a scheduled job — not part of the indexer's
real-time path.

---

## Planned — Analytics Phase

### 4. Wallet History API

Query interface for all trades by wallet, sorted chronologically.

Required changes:
- Ensure address normalization is done before insert.
- Add composite index on `(wallet, block_number)` if not already covered.
- REST endpoint: `GET /trades?wallet=0x...&limit=50&cursor=<block>`.

### 5. Position Reconstruction Engine

Given a wallet and a token, compute:
- Total acquired (sum of `amount_out` where `token_out = token`)
- Total disposed (sum of `amount_in` where `token_in = token`)
- Net position (acquired - disposed)

Requires: inline decimals in the trades table (to convert raw BigInt to
human-readable amounts without JOINs).

FIFO cost basis requires: `log_index` for deterministic ordering within blocks.

### 6. Realized PnL Engine

Compute P&L in token-denominated terms from the cost basis engine.

Entry price: `amount_in_usdt / amount_out_token` per buy event.

For non-USDT pairs (e.g., WBNB/TOKEN): requires a WBNB price oracle at
trade time. Options:
- **Option A:** Query the WBNB/USDT pool price from the same block.
  High accuracy, additional RPC cost per block.
- **Option B:** Use a historical price API (CoinGecko, Binance).
  Lower accuracy, no RPC cost.
- **Option C:** Store WBNB price at insert time in the trades table
  (`price_in_usd` column, nullable). Populate from a price feed.

USD-denominated PnL is not feasible without one of these approaches.

### 7. Trader Rankings

Aggregate realized PnL, win rate, trade frequency, and volume per wallet
over configurable time windows.

Requires the position and PnL engines. Rankings can be materialized as a
PostgreSQL view or a periodically updated summary table.

### 8. Copy Trading Signal

For each incoming trade from a "leader" wallet, produce a structured signal:
- Leader wallet address
- Token bought/sold
- Amount
- Block timestamp
- Entry price (computed from trade)

The watcher service (`watcher/`) already has a copy-trading execution engine.
This indexer needs to emit signals to that service in real time.

Current approach: `handleBlock()` calls `printTrade()` to stdout. A copy
trading integration would add a hook or a push to a message queue (Redis,
Postgres NOTIFY, etc.) for leader trades.

---

## Planned — Protocol Expansion

### 9. Additional DEX Support

The `ParserRegistry` is designed for easy extension. Adding any new DEX
requires:
1. Identify the Swap event ABI signature.
2. Implement `EventParser` (canParse + parse).
3. Register in `index.ts`.
4. Add the dex name to the `Dex` union type.

Candidates for BSC expansion:
- Biswap
- THENA (concentrated liquidity)
- ApeSwap
- BabySwap

### 10. Multi-Chain Support

The current client (`chains/bsc.ts`) is BSC-specific. Extending to other
EVM chains requires:
1. A new chain module (e.g., `chains/eth.ts`).
2. Protocol-specific parser updates if the DEX contracts have different
   addresses or slightly different ABIs on the target chain.
3. A new checkpoint key per chain.
4. A separate indexer process per chain (or a chain-aware dispatcher).

The `IndexerStateRepository.saveCheckpoint('bsc', ...)` already uses a chain
key — the DB schema supports multi-chain.

---

## Explicitly Out of Scope (Current Design)

- **Websocket-based block subscription** — currently uses polling. WebSocket
  would reduce latency from ~3s to ~100ms but adds reconnection complexity.
  Not needed for the analytics use case.

- **Block reorganization handling** — BSC produces infrequent (but possible)
  reorgs. The current checkpoint does not roll back. A reorg would cause
  missed or duplicated trades for the reorganized blocks. Production deployment
  should monitor for reorgs and re-index affected ranges.

- **Historical full backfill** — the current design can backfill any range via
  `BLOCK_START`/`BLOCK_END`, but doing so for the full BSC chain history
  (~40M blocks) would require a dedicated backfill process with archive RPC
  access and horizontal scaling.
