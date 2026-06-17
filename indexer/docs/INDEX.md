# Indexer Documentation

Technical reference for the `@aether/indexer` package.

**Last updated:** 2026-06-17  
**Package version:** 0.1.0  
**Chain:** BSC (BNB Smart Chain, chainId 56)  
**Protocols:** PancakeSwap V2, V3, V4

---

## Navigation

| Document | What it covers |
|---|---|
| [01 — Overview](01-overview.md) | What the indexer does, problem statement, data flow diagram |
| [02 — Architecture](02-architecture.md) | Every component, responsibility, dependency graph |
| [03 — Block Processing](03-block-processing.md) | BatchProcessor, BlockPoller, the extraction pipeline |
| [04 — Event Extraction](04-event-extraction.md) | Receipt → RawEvent, ParseContext, sender attribution |
| [05 — DEX Parsers](05-dex-parsers.md) | V2, V3, V4 decoders with real examples |
| [06 — Trade Reconstruction](06-trade-reconstruction.md) | NormalizedTrade fields, fromPair, resolveV4Tokens, fromTransfers |
| [07 — Data Models](07-data-models.md) | All TypeScript interfaces and DB schema, field by field |
| [08 — Validation & Auditing](08-validation-and-auditing.md) | Automated assertions, BscScan audit, findings |
| [09 — Known Edge Cases](09-known-edge-cases.md) | Native BNB, fee-on-transfer, V4 internal accounting, aggregators |
| [10 — Performance](10-performance-considerations.md) | Concurrency, caching, RPC budget, scaling limits |
| [11 — Future Roadmap](11-future-roadmap.md) | What's implemented vs planned, next steps |

---

## System at a Glance

```
BSC RPC
  │
  ▼
BlockPoller (live) / processRange (batch)
  │  block number range
  ▼
BlockProcessor
  ├── getBlocksInRange()        concurrent, FETCH_CONCURRENCY windows
  ├── getTransactionReceipts()  concurrent, RECEIPT_CONCURRENCY windows
  ├── extractEvents()           Receipt → RawEvent[] (all logs)
  ├── ParserRegistry.canParse() topic0 hash comparison — O(1) per log
  ├── ParserRegistry.parse()    concurrent per block
  │   ├── pancakeswapV2Parser   → RawSwap (token0/token1 from pair-cache)
  │   ├── pancakeswapV3Parser   → RawSwap (token0/token1 from pair-cache)
  │   └── pancakeswapV4Parser   → RawSwap (token0/token1 absent)
  └── reconstructTrade()
      ├── fromPair()            V2/V3 — known tokens, signed amounts
      ├── resolveV4Tokens()     V4 primary — Transfer amount matching
      └── fromTransfers()       V4 fallback — wallet-level Transfers
            │
            ▼
        NormalizedTrade[]

handleBlock()
  ├── resolveTokenMeta()        symbol + decimals (cache → chain → fallback)
  ├── TradeRepository.insertTrades()
  ├── TokenRepository.upsertToken()
  ├── TokenDiscoveryQueueRepository.enqueueToken()
  └── IndexerStateRepository.saveCheckpoint()
            │
            ▼
  PostgreSQL: trades, tokens, token_discovery_queue, indexer_state
```

---

## Quick Reference

### Running the Indexer

```sh
# Live mode (polls for new blocks every 3s)
pnpm start

# Batch mode (processes a specific block range and exits)
BLOCK_START=104740000 BLOCK_END=104740500 pnpm start

# Validation (scan last 100 blocks, generate report)
pnpm run validate

# Audit (select 30 BscScan-verifiable trades for manual check)
pnpm run audit
```

### Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `BSC_RPC_URL` | YES | — | Any BSC JSON-RPC endpoint |
| `CHECKPOINT_FILE` | no | `./checkpoint.json` | Resume position |
| `BATCH_SIZE` | no | `100` | Blocks per batch |
| `BATCH_DELAY_MS` | no | `200` | ms between batches |
| `FETCH_CONCURRENCY` | no | `5` | Concurrent block fetches |
| `RECEIPT_CONCURRENCY` | no | `10` | Concurrent receipt fetches |
| `POLL_INTERVAL_MS` | no | `3000` | ms between live ticks |
| `LOG_LEVEL` | no | `info` | `debug\|info\|warn\|error` |

### Key Addresses (BSC Mainnet)

| Contract | Address |
|---|---|
| PancakeSwap V2 Router | `0x10ed43c718714eb63d5aa57b78b54704e256024e` |
| PancakeSwap Universal Router | `0x13f4ea83d0bd40e75c8222255bc855a974568dd4` |
| PancakeSwap V4 Router | `0x40a1fe393a7f566f27df6ace18e6773be844dafc` |
| PancakeSwap V4 PoolManager | `0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b` |
| WBNB | `0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c` |
| USDT (BSC, 18 dec) | `0x55d398326f99059ff775485246999027b3197955` |
| USDC (BSC, 18 dec) | `0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d` |

### Swap Event Topic0 Hashes

| Protocol | topic0 |
|---|---|
| PancakeSwap V2 | `0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822` |
| PancakeSwap V3 | `keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)")` |
| PancakeSwap V4 | `keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24,uint16)")` |

V3 and V4 hashes are computed at runtime in `parsers/pancakeswap-v3.ts` and
`parsers/pancakeswap-v4.ts` using viem's `keccak256`.

### Amount Convention

All `RawSwap` amounts use **swapper perspective**:
- `amount > 0` → user **received** this currency
- `amount < 0` → user **sent** this currency

All `NormalizedTrade` amounts are positive absolute values:
- `amountIn` → what the user sold
- `amountOut` → what the user received

### Validation Status

Parser correctness confirmed via manual BscScan verification (30 trades).

- 9/9 directly-verifiable trades: 100% pass rate
- V4 failures: methodology mismatch (BscScan Token Transfers tab unsuitable for V4)
- V2/V3 failures: native BNB, aggregator routing, sub-threshold fees
- Zero parser defects found

---

## Critical Pre-DB Requirement

**Address normalization must be applied before any DB insert.**

viem returns addresses in EIP-55 checksum format (mixed case). PostgreSQL
`varchar` is case-sensitive. Storing mixed-case addresses breaks all
`WHERE address = '0x...'` queries.

Fix: lowercase all addresses in the `handleBlock()` storage layer before
building the `InsertTrade` object. See `schema-review.md` for details.
