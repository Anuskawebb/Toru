# 01 — Overview

## What the Indexer Does

The indexer is an autonomous BSC chain scanner that converts raw on-chain
swap events into a normalized, protocol-neutral trade format and persists them
to a PostgreSQL database. It is the data-collection layer of the Aether
platform — every downstream analytics feature (trader rankings, position
tracking, copy trading) reads from what this process writes.

## Problem Statement

DEX swap data on BSC is fragmented across three incompatible protocol designs:

- **PancakeSwap V2** — Uniswap V2 fork. Unsigned `uint256` amounts split
  across `amount0In`, `amount0Out`, `amount1In`, `amount1Out`. Direction
  determined by comparing signed values. Pair token addresses fetched from the
  pool contract.
- **PancakeSwap V3** — Uniswap V3 fork. Signed `int256` amounts in pool
  perspective (`+` = into pool). Token addresses fetched from the pool.
- **PancakeSwap V4** — Novel PoolManager architecture. Signed `int128` amounts
  in swapper perspective. Token addresses are **not** derivable from the event
  alone; they require cross-referencing ERC-20 Transfer logs in the same receipt.

Reading swap events across these three protocols requires different decoding
logic, different amount sign conventions, and different token-identity strategies.
No public data source covers all three with the latency and completeness the
platform requires.

The indexer solves this by:

1. Pulling every block from a BSC RPC endpoint.
2. Parsing raw event logs with protocol-specific decoders.
3. Reconstructing trade direction and token identity through a layered strategy.
4. Producing a single canonical `NormalizedTrade` per swap event.
5. Persisting that record to PostgreSQL, deduplicated by unique constraint.

## Current Capabilities

| Capability | Status |
|---|---|
| PancakeSwap V2 swap parsing | Implemented |
| PancakeSwap V3 swap parsing | Implemented |
| PancakeSwap V4 swap parsing | Implemented |
| Multi-hop swap detection | Implemented |
| Native BNB wrapping / unwrapping | Handled (via WBNB canonical form) |
| Checkpoint-based resume | Implemented |
| Live block polling | Implemented |
| Batch block range processing | Implemented |
| PostgreSQL persistence (trades, tokens) | Implemented |
| Token metadata resolution (symbol, decimals) | Implemented |
| Token discovery queue | Implemented |
| Trader analytics / PnL / rankings | Not yet implemented |

## Supported Protocols

| Protocol | Chain | Swap Event | Topic0 |
|---|---|---|---|
| PancakeSwap V2 | BSC | `Swap(address,uint256,uint256,uint256,uint256,address)` | `0xd78ad9…` |
| PancakeSwap V3 | BSC | `Swap(address,address,int256,int256,uint160,uint128,int24)` | computed at startup |
| PancakeSwap V4 | BSC | `Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24,uint16)` | computed at startup |

V3 and V4 topic hashes are derived at startup using `keccak256` from the
ABI signature string to avoid hardcoding and to make any future signature change
immediately visible as a type error.

## Supported Chains

BSC (BNB Smart Chain) mainnet only. The chain client is defined in
`src/chains/bsc.ts` using viem's `bsc` chain preset. Adding a new chain
requires a new chain module and a separate deployment.

## Data Flow

```
BSC RPC Endpoint
      │
      ▼
┌─────────────┐
│ BlockPoller │  (live mode: polls every 3s)
│     or      │
│   Batch     │  (batch mode: BLOCK_START / BLOCK_END env vars)
└──────┬──────┘
       │  block number range
       ▼
┌──────────────────┐
│  BlockProcessor  │  src/processor.ts
│                  │
│  1. getBlock[]   │  ← concurrent, batched (FETCH_CONCURRENCY)
│  2. getReceipt[] │  ← concurrent, batched (RECEIPT_CONCURRENCY)
│  3. extractEvents│
│  4. canParse?    │
│  5. parse()      │
│  6. reconstruct  │
└──────┬───────────┘
       │  NormalizedTrade[]
       ▼
┌──────────────────┐
│  BlockHandler    │  src/index.ts handleBlock()
│                  │
│  resolveTokenMeta│  ← token symbol + decimals
│  TradeRepository │  ← INSERT INTO trades
│  TokenRepository │  ← UPSERT INTO tokens
│  TokenDiscovery  │  ← enqueue for logo/coingecko
│  IndexerState    │  ← save checkpoint to DB
└──────────────────┘
       │
       ▼
  PostgreSQL (trades, tokens, token_discovery_queue, indexer_state)
```
