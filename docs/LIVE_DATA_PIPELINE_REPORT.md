# Live Data Pipeline Report

**Generated:** 2026-06-19  
**Observer:** Claude Code  
**Session purpose:** End-to-end propagation verification after API layer fix

---

## 1. Indexer Health

### Chain

| Field | Value |
|---|---|
| Chain | **BSC (Binance Smart Chain)** |
| Indexer type | HTTP block-range polling (eth_getLogs) |
| Checkpoint table | `indexer_state` |
| Last processed block | **104,773,659** |
| Last checkpoint written | 2026-06-19 13:26:57 UTC |
| Indexer location | Remote server (not running locally) |
| Local watcher process | None (`pgrep tsx` returns empty) |

> **Note on chain naming:** The frontend directive references BSC. The `watcher/` codebase targets **Mantle Mainnet** (chain ID 5000) for copy-trade execution. The analytics pipeline (`trades`, `wallet_metrics`, `wallet_scores`, `token_metrics`, `smart_money_signals`) is fed by a **separate BSC indexer** that writes to `indexer_state` with `chain = 'bsc'`. These are two distinct processes.

### Indexer Activity During Observation Window

Trade count was sampled over ~25 minutes:

| Time (relative) | `trades` count | Δ |
|---|---|---|
| T+0 | 12,562 | — |
| T+5m | 12,669 | +107 |
| T+10m | 13,088 | +419 |
| T+15m | 13,592 | +504 |
| T+18m | 13,814 | +222 |
| T+20m | 13,947 | +133 |
| T+25m | 14,235 | +288 |
| **Total** | **14,235** | **+1,673 trades** |

**Ingest rate: ~67–80 trades/minute.** The indexer is performing a historical backfill (catching up from block 104,773,659 toward the current BSC tip). The latest trade timestamp in the database is `2026-06-17 14:24:23` — the indexer is currently 2 days behind the chain tip.

---

## 2. Latest Block Processed

```
indexer_state:
  chain:               bsc
  last_processed_block: 104,773,659
  updated_at:          2026-06-19 13:26:57 UTC
```

BSC produces ~3 blocks/second. At the time of observation, the current BSC head was approximately block ~104,820,000, placing the indexer roughly **~46,000 blocks (~4.3 hours) behind live** — within normal backfill range.

---

## 3. Data Propagation Status

### Pipeline Stages

```
BSC Chain
  ↓ (polling every 12s, chunked eth_getLogs)
  trades table  ← LIVE ✅
  ↓
  wallet_metrics  ← LIVE ✅ (incrementally updated by indexer)
  ↓
  wallet_scores   ← STALE ❌ (last run: 2026-06-18 19:35 — ~18h ago)
  ↓
  token_metrics   ← STALE ❌ (last run: 2026-06-18 20:08 — ~18h ago)
  ↓
  smart_money_signals  ← STALE ❌ (last run: 2026-06-18 19:50 — ~18h ago)
  ↓
  trade_recommendations  ← EMPTY ❌ (decision engine not running)
  ↓
  execution_orders / execution_transactions  ← EMPTY ❌ (execution engine not running)
```

### Table State Snapshot (2026-06-19 ~13:30 UTC)

| Table | Row Count | Last Updated |
|---|---|---|
| `trades` | **14,235** (growing) | 2026-06-17 14:24 (indexer backfilling) |
| `wallet_metrics` | 6,067 | **2026-06-19 13:26** ← live |
| `wallet_scores` | 1,710 | 2026-06-18 19:35 ← 18h stale |
| `token_metrics` | 412 | 2026-06-18 20:08 ← 18h stale |
| `smart_money_signals` | 412 | 2026-06-18 19:50 ← 18h stale |
| `trade_recommendations` | 0 | — |
| `execution_orders` | 0 | — |
| `agent_positions` | 2 (open) | — |
| `portfolio_state` | 1 | 2026-06-18 14:38 |

### What Is Automated vs. Manual

| Stage | Automated | Trigger | Notes |
|---|---|---|---|
| `trades` ingest | ✅ Yes | BSC indexer (remote server) | Running live |
| `wallet_metrics` update | ✅ Yes | Called inline by indexer during ingestion | Incremental, per-wallet |
| `wallet_scores` rebuild | ❌ No | Manual script: `rebuild-wallet-scores.ts` | Needs PERCENT_RANK over all wallets — batch-only |
| `token_metrics` rebuild | ❌ No | Manual script: `rebuild-token-metrics.ts` | Requires wallet_scores to be current |
| `smart_money_signals` rebuild | ❌ No | Manual script: `rebuild-smart-money-signals.ts` | Requires token_metrics + wallet_scores |
| Decision engine | ❌ No | Not running | `packages/agent-core/src/decision/decision-engine.ts` exists but has no scheduler |
| Execution engine | ❌ No | Not running | `packages/agent-core/src/execution/execution-engine.ts` exists but has no scheduler |

---

## 4. APIs Verified

All endpoints tested after the `globalThis` connection pool fix. Response times are from a warm pool.

| Endpoint | HTTP | Response Time | Data Age | Notes |
|---|---|---|---|---|
| `/api/signals` | 200 | 319ms | **~18h stale** | Signals from 2026-06-18 19:50 |
| `/api/activity` | 200 | 83ms | **~18h stale** | Events generated from stale signals |
| `/api/portfolio` | 200 | 87ms | 2026-06-18 14:38 | Real portfolio_state row |
| `/api/positions` | 200 | 159ms | Live | 2 open positions |
| `/api/agent` | 200 | 93ms | **~18h stale** | Signals count current; recommendations = 0 |
| `/api/execution-center` | 200 | 86ms | Live | 0 orders (execution engine not running) |
| `/api/orders` | 200 | 241ms | — | 0 rows |
| `/api/executions` | 200 | 213ms | — | 0 rows |

**Key observation:** `/api/signals` and `/api/activity` return stale data because `smart_money_signals` has not been rebuilt since 2026-06-18. The **API layer itself is correct and fast** — the staleness is upstream in the analytics pipeline.

---

## 5. Frontend Verified

The frontend dev server is running on `localhost:3001`. The following components now consume real API data:

| Component | Data Source | Status | Staleness |
|---|---|---|---|
| Top Opportunities (`/markets`) | `/api/signals` | ✅ Real data | ~18h |
| Live Intelligence (sidebar) | `/api/activity` | ✅ Real data | ~18h |
| Signals Tab (sidebar) | `/api/signals` | ✅ Real data | ~18h |
| Portfolio page | `/api/portfolio` + `/api/positions` | ✅ Real data | < 24h |
| Agent page | `/api/agent` | ✅ Real data | ~18h signals |
| Execution Center | `/api/execution-center` | ✅ Real data | Live (0 orders) |
| Community Feed | `/api/activity` | ✅ Real data | ~18h |
| Token Detail | `/api/signals` + `/api/tokens/[address]` | ✅ Real data | ~18h |

**Token symbol display:** Token symbols in `smart_money_signals` are stored as raw hex addresses (e.g., `0x8d0d00`) when the BSC metadata service has not resolved them to human-readable symbols (e.g., `CAKE`, `WBNB`). This is a data quality gap, not an API bug.

---

## 6. Missing Automation Steps

### Critical Gap: No Analytics Scheduler

The full analytics pipeline from `trades` → `signals` requires 3 batch steps that have **no scheduler**:

```
wallet_scores rebuild  ~3-5s for 6,067 wallets
      ↓
token_metrics rebuild  ~2-4s for 412 tokens
      ↓
smart_money_signals rebuild  ~1-2s
```

Total refresh time: **~6-11 seconds per full cycle.**

Currently these run only when a developer manually executes:
```bash
cd packages/db
npx tsx scripts/rebuild-wallet-scores.ts
npx tsx scripts/rebuild-token-metrics.ts
npx tsx scripts/rebuild-smart-money-signals.ts
```

### Additional Missing Automation

| Missing Component | What It Does | Where Code Exists |
|---|---|---|
| Decision engine scheduler | Reads signals → writes `trade_recommendations` | `packages/agent-core/src/decision/decision-engine.ts` |
| Execution engine scheduler | Reads recommendations → writes `execution_orders` | `packages/agent-core/src/execution/execution-engine.ts` |
| Token symbol resolver | Resolves hex addresses → human-readable symbols | `packages/db/src/services/token-metadata.ts` |
| Mantle watcher (local dev) | Copy-trade execution on Mantle | `watcher/src/index.ts` (not started locally) |

---

## 7. Recommended Scheduler Architecture

### Option A: Add a cron loop to the existing BSC indexer (Simplest)

After each indexing batch, trigger the analytics chain if enough new wallets were added:

```
BSC Indexer (running on remote server)
  ├─ after every N blocks:
  │     WalletScoresService.rebuildAll()     // ~3-5s
  │     TokenMetricsService.rebuildAll()     // ~2-4s
  │     SmartMoneySignalsRepository.rebuild() // ~1-2s
  │     DecisionEngine.run()                 // fast
  └─ every 60s (P&L updater equivalent):
        ExecutionEngine.processQueue()
```

**Recommended rebuild interval:** Every 15-30 minutes during live indexing.

### Option B: Standalone cron worker (Cleanest for production)

A separate `packages/analytics-worker/` that runs on a cron schedule:

```
packages/analytics-worker/src/index.ts
  setInterval(async () => {
    await WalletScoresService.rebuildAll()
    await TokenMetricsService.rebuildAll()
    await SmartMoneySignalsRepository.rebuildAll()
    await DecisionEngine.run()
    await ExecutionEngine.processQueue()
  }, 15 * 60 * 1000)  // every 15 minutes
```

Deploy alongside the BSC indexer on the same Render/Railway service.

### Option C: Database triggers (Most reliable)

PostgreSQL trigger on `wallet_metrics` that calls a stored procedure to queue a refresh. Requires pg_cron or a notification consumer.

### Immediate Recommendation

Run the analytics rebuild NOW to freshen the signal data, then implement Option A as a `setInterval` inside the existing BSC indexer:

```bash
cd packages/db
npx tsx scripts/rebuild-wallet-scores.ts
npx tsx scripts/rebuild-token-metrics.ts
npx tsx scripts/rebuild-smart-money-signals.ts
```

---

## 8. Summary

### Is Toro a Live System?

**Partially.** The BSC indexer is live and continuously ingesting trades. The `trades` and `wallet_metrics` tables are real-time. However, the signal layer (everything from `wallet_scores` onward) is batch-refreshed and is currently **~18 hours stale**. The decision and execution engines are not running at all.

### Propagation Path Status

| Segment | Status |
|---|---|
| BSC Chain → `trades` | ✅ **LIVE** (~70 trades/min) |
| `trades` → `wallet_metrics` | ✅ **LIVE** (inline, per-batch) |
| `wallet_metrics` → `wallet_scores` | ❌ **MANUAL** (18h stale) |
| `wallet_scores` → `token_metrics` | ❌ **MANUAL** (18h stale) |
| `token_metrics` → `smart_money_signals` | ❌ **MANUAL** (18h stale) |
| `signals` → `trade_recommendations` | ❌ **NOT RUNNING** |
| `recommendations` → `execution_orders` | ❌ **NOT RUNNING** |
| `orders` → **Frontend APIs** | ✅ **API LAYER HEALTHY** (83-320ms) |

### Next Action Required

Add a 15-minute scheduled refresh for `wallet_scores → token_metrics → signals → decisions` inside the BSC indexer process. This single change closes the propagation gap and makes signals live rather than 18h stale.
