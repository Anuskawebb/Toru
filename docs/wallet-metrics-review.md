# Wallet Metrics Engine — Phase 2 Review

**Date:** 2026-06-18  
**Branch:** feat/db  
**Status:** Production-ready

---

## 1. What Was Built

A denormalized `wallet_metrics` table (one row per wallet) derived from `trades` and `wallet_positions`. The table is maintained incrementally during live block processing and can be fully rebuilt from source truth at any time.

### Files Added

| File | Role |
|---|---|
| `packages/db/src/schema/wallet-metrics.ts` | Drizzle table definition + field rationale |
| `packages/db/drizzle/0003_wallet_metrics.sql` | SQL migration |
| `packages/db/src/repositories/wallet-metrics-repository.ts` | All reads and writes |
| `packages/db/src/services/wallet-metrics-service.ts` | Facade (mirrors PositionBuilderService) |
| `packages/db/scripts/validate-wallet-metrics.ts` | Read-only validation suite |
| `packages/db/scripts/rebuild-wallet-metrics.ts` | One-shot full backfill |
| `docs/wallet-metrics-review.md` | This document |

### Integration Point in `indexer/src/index.ts`

```
Block
  → Insert Trades (RETURNING inserted hashes)
  → Update Positions (applyTrades for new trades only)
  → Update Wallet Metrics (rebuildWallets for affected wallets)
  → Upsert Tokens
  → Enqueue Discovery Queue
  → Save Checkpoint
```

---

## 2. Performance Results

### rebuildAll() — Full Backfill

| Metric | Value |
|---|---|
| Wallets rebuilt | 23,501 |
| Execution time | 8.2 s |
| Throughput | ~2,865 wallets/s |
| SQL statements | 1 (single CTE + INSERT) |

### Incremental update per block (20-block benchmark, blocks 104773040–059)

| Metric | Value |
|---|---|
| Avg swaps/block | 22 |
| metricsUpdateMs min | 141 ms |
| metricsUpdateMs max | 771 ms |
| metricsUpdateMs avg | ~295 ms |
| positionUpdateMs avg (comparison) | ~198 ms |
| Total block handler time avg | ~1.3 s |

The metrics step reads the **full trade history** for each affected wallet (not just the new trades), so it's slightly more expensive than `applyTrades` which only applies deltas. The overhead is ~100ms per block above position updates — acceptable at BSC's 3-second block time.

High-latency outliers (e.g., 771ms) occur when a block contains trades by high-frequency wallets (thousands of prior trades) whose per-wallet SQL scan is more expensive. Under normal conditions (avg 3.8 trades/wallet) the overhead is 150–300ms.

### Complexity

- rebuildWallets(n wallets): 1 SQL statement, 3 CTEs, scan bounded by `WHERE wallet IN (w1, w2, ...)` with index on `trades.wallet` and `wallet_positions.wallet`.
- rebuildAll(): same structure, unbounded scan — O(trades + positions).
- No N+1 patterns anywhere.

---

## 3. Trader Profile Capability — Deliverable 6

All five questions are answered by direct SELECT on `wallet_metrics` — no scanning raw trades.

### Q1: How many trades has a wallet made?

```sql
SELECT trade_count
FROM wallet_metrics
WHERE wallet = '0xabc...';
```

```typescript
const m = await WalletMetricsRepository.getWalletMetrics('0xabc...');
console.log(m?.tradeCount);
```

### Q2: How many unique tokens has it traded?

```sql
SELECT unique_tokens
FROM wallet_metrics
WHERE wallet = '0xabc...';
```

```typescript
const m = await WalletMetricsRepository.getWalletMetrics('0xabc...');
console.log(m?.uniqueTokens);
```

### Q3: How long has it been active?

```sql
SELECT
  first_seen,
  last_seen,
  active_days,
  last_seen - first_seen AS total_span
FROM wallet_metrics
WHERE wallet = '0xabc...';
```

### Q4: How many positions are currently open?

```sql
SELECT current_open_positions
FROM wallet_metrics
WHERE wallet = '0xabc...';
```

### Q5: When was it last active?

```sql
SELECT last_seen
FROM wallet_metrics
WHERE wallet = '0xabc...';
```

```typescript
const recent = await WalletMetricsRepository.getRecentlyActiveWallets(20);
```

### Leaderboard queries

```sql
-- Most active traders
SELECT wallet, trade_count, unique_tokens, last_seen
FROM wallet_metrics
ORDER BY trade_count DESC
LIMIT 20;

-- Traders still active (last 24h)
SELECT wallet, trade_count, last_seen
FROM wallet_metrics
WHERE last_seen > NOW() - INTERVAL '24 hours'
ORDER BY last_seen DESC;

-- Broadest market exposure
SELECT wallet, unique_tokens, trade_count
FROM wallet_metrics
ORDER BY unique_tokens DESC
LIMIT 20;

-- Most open positions
SELECT wallet, current_open_positions, unique_tokens
FROM wallet_metrics
ORDER BY current_open_positions DESC
LIMIT 20;
```

---

## 4. Current Capabilities Summary

| Question | Answered by |
|---|---|
| Who are the most active traders? | `ORDER BY trade_count DESC` |
| Which traders are still active? | `WHERE last_seen > NOW() - INTERVAL '24 hours'` |
| Which traders have broad market exposure? | `ORDER BY unique_tokens DESC` |
| Which traders maintain many open positions? | `ORDER BY current_open_positions DESC` |
| When did a wallet first appear? | `first_seen` |
| How many days has a wallet been active? | `active_days` |

All queries are index-supported (wallet PK, `last_seen` index, `trade_count` index).

---

## 5. How This Layer Enables Future Phases

### Trader Rankings (Phase 3)

`wallet_metrics` provides the non-financial dimensions of a ranking score:
- Activity volume (`trade_count`) — weights a trader's "signal density"
- Recency (`last_seen`, `active_days`) — filters stale/bot accounts
- Breadth (`unique_tokens`) — distinguishes generalist from specialist traders
- Positions (`current_open_positions`) — conviction indicator

A ranking score can be computed as a weighted combination of these fields without touching `trades` or `wallet_positions` at query time.

### Smart Money Scoring (Phase 3)

Smart money detection relies on behavioral signals over time. The current `wallet_metrics` row provides the baseline:
- High `trade_count` + high `unique_tokens` + many `active_days` → systematic operator
- Low `trade_count` + high `current_open_positions` → conviction accumulator
- Very high `trade_count` in few `active_days` → bot or MEV searcher

The schema was deliberately kept free of financial/PnL fields so that the smart money dimension can be added orthogonally in Phase 3 via a separate `wallet_scores` table that joins against this one.

### Conviction Scoring (Phase 3)

Conviction is `current_open_positions / unique_tokens` — how many tokens traded does the wallet currently hold? This ratio is computable directly from `wallet_metrics` fields. A wallet that trades 100 tokens but holds 80 net-long positions has high conviction. One that trades 100 tokens but holds 2 positions is a flipper.

### Token Intelligence (Phase 4)

`wallet_metrics` complements a future `token_metrics` table. Interesting wallets (high conviction, long active, broad exposure) can be used to construct a "smart money consensus" signal: which tokens are held by the most high-quality wallets? The query is:

```sql
SELECT wp.token_address, COUNT(*) AS quality_holder_count
FROM wallet_positions wp
JOIN wallet_metrics wm ON wm.wallet = wp.wallet
WHERE wp.net_amount::numeric > 0
  AND wm.trade_count > 50          -- meaningful activity threshold
  AND wm.active_days > 3           -- sustained participation
ORDER BY quality_holder_count DESC;
```

This requires no new tables — just the two Phase 1 + Phase 2 tables.

### Autonomous Agents (Phase 5)

An agent that decides whether to copy a trade needs to know:
1. Is the wallet active? (`last_seen`)
2. Is it experienced? (`trade_count`, `active_days`)
3. Does it maintain conviction? (`current_open_positions`)
4. Is it a generalist? (`unique_tokens`)

All four questions are answered with a single row lookup on `wallet_metrics`. Agents can run rule-based pre-filters entirely against this table (no full table scans) before invoking more expensive LLM reasoning about specific trades.

---

## 6. Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| `activeDays` is not incrementally maintained; computed from full history per-wallet | rebuildWallets cost scales with wallet history depth | Acceptable: query is indexed and wallets rarely trade in thousands of blocks |
| `currentOpenPositions` requires positions to be updated before metrics | Ordering guarantee in block handler ensures this | Documented in service layer |
| `buyCount = sellCount = tradeCount` in current swap model | These fields are structurally redundant today | Reserved for future trade types; documented in schema |
| No financial fields (volume, PnL, realized gains) | Cannot rank by profit | Deliberate — financial fields belong to Phase 3 |

---

## 7. Validation Results

Full validation suite (`validate-wallet-metrics.ts`) — run after initial backfill and after 20-block live indexing benchmark:

```
Total wallets : 23,605
Wallets sampled : 30
Field mismatches : 0
Missing rows : 0
Rebuild drifts : 0

✓ PASS — wallet_metrics consistent with trades + positions
```
