# Token Metrics Engine — Phase 4 Review

**Date:** 2026-06-18  
**Branch:** feat/db  
**Status:** Production-ready

---

## 1. What Was Built

A denormalized `token_metrics` table (one row per token) derived from `trades`,
`wallet_positions`, and `wallet_scores`.  The table is rebuilt in batch after
scoring updates and provides the foundation for token-level intelligence queries.

### Files Added

| File | Role |
|---|---|
| `packages/db/src/schema/token-metrics.ts` | Drizzle table definition + field rationale |
| `packages/db/drizzle/0005_token_metrics.sql` | SQL migration |
| `packages/db/src/repositories/token-metrics-repository.ts` | All reads and writes |
| `packages/db/src/services/token-metrics-service.ts` | Façade (mirrors WalletMetricsService) |
| `packages/db/scripts/migrate-token-metrics.ts` | One-shot migration |
| `packages/db/scripts/rebuild-token-metrics.ts` | Full backfill script with summary output |
| `packages/db/scripts/validate-token-metrics.ts` | Read-only validation suite |
| `docs/token-metrics-review.md` | This document |

### Dependency Chain

```
trades
   ↓
wallet_positions
   ↓
wallet_metrics
   ↓
wallet_scores
   ↓
token_metrics   ← Phase 4
   ↓
(Phase 5) Smart Money Signals
```

`token_metrics` depends on `wallet_scores` (for `quality_holder_count`) which
itself depends on `wallet_metrics`.  Full refresh order:

```
1. PositionRepository.rebuildAll()
2. WalletMetricsRepository.rebuildAll()
3. WalletScoresRepository.rebuildAll()
4. TokenMetricsRepository.rebuildAll()
```

---

## 2. Quality Holder Threshold — Deliverable 2

**Threshold: `rank_score >= 80`**

Probed live distribution (23,605 wallets, 2026-06-18):

| Threshold | Wallets Selected | % of total | Positions held |
|---|---|---|---|
| rank_score >= 80 | 1,056 | 4.47% | **5,800** |
| rank_score >= 70 | 2,691 | 11.4% | — |
| rank_score >= 60 | 4,603 | 19.5% | — |
| rank_score > 15  | 10,619 | 45.0% | — |

**Rationale for 80:**
- Excludes the entire "retail" cohort (score ≈ 15, 93.6% of wallets) — these
  are single-trade wallets with no meaningful signal
- Wallets at rank_score ≥ 80 have meaningfully high scores in at least two of
  the four dimensions (activity, conviction, breadth, consistency)
- The 1,056 qualifying wallets collectively hold 5,800 open positions across
  559 distinct tokens — rich enough to surface signal, small enough to avoid noise
- The threshold is exported as `QUALITY_HOLDER_THRESHOLD = 80` for inspection
  and future adjustment without touching SQL

---

## 3. Performance Results — Deliverable 7

### rebuildAll() — Full Backfill

| Metric | Value |
|---|---|
| Tokens rebuilt | 2,690 |
| Execution time | 2.8 s (cold) / ~2.0 s (warm) |
| SQL statements | 1 (single CTE-chain + INSERT) |
| CTEs used | 6 (all_token_mentions, token_stats, active_stats, holder_stats, quality_holder_stats, token_meta, tokens_table) |
| Throughput | ~960 tokens/s |

### rebuildToken() — Single Token Rebuild

| Metric | Value |
|---|---|
| Execution time | < 100 ms |
| SQL statements | 1 (same CTE structure, filtered by token_address) |

### rebuildAll() vs rebuildToken()

`rebuildAll()` scans `trades` twice (tokenIn + tokenOut UNION ALL) and
`wallet_positions` once.  The dominant cost is `COUNT(DISTINCT wallet)` with
filter conditions inside a single scan — no sequential per-token queries.

`rebuildToken()` filters each CTE to a single token address, which hits the
indexed columns `token_in_address` and `token_out_address`.  It is fast enough
for targeted repair but cannot produce correct relative statistics (percentiles
would require all tokens present).

### Indexes Used

```sql
-- token_stats, active_stats: scan on trades
EXPLAIN shows: Parallel Seq Scan on trades (no beneficial index for UNION ALL
GROUP BY — the full scan is required for global stats)

-- holder_stats: wallet_positions.token_address_idx
-- quality_holder_stats: wallet_positions.token_address_idx + wallet_scores PK
-- rebuildToken: trades.token_in_address_idx + trades.token_out_address_idx
```

### Bottleneck

`quality_holder_stats` performs a nested-loop join:
```sql
FROM wallet_positions wp JOIN wallet_scores ws ON ws.wallet = wp.wallet
WHERE wp.net_amount::numeric > 0 AND ws.rank_score::numeric >= 80
```
The `::numeric` cast on `rank_score` (stored as `numeric(5,2)`) prevents index
use on the condition.  Adding `WHERE rank_score >= '80'::numeric` (without
cast) would allow index range scan on `wallet_scores_rank_score_idx`.  This
optimization is deferred; current 2.8 s rebuild time is acceptable.

---

## 4. Token Intelligence Queries — Deliverable 6

All queries hit `token_metrics` directly — no raw table scans.

### Most Traded Tokens (by total swap volume)

```sql
SELECT token_address, token_symbol, trade_count, unique_traders
FROM token_metrics
ORDER BY trade_count DESC
LIMIT 20;
```

```typescript
const tokens = await TokenMetricsRepository.getMostTradedTokens(20);
```

Live top-3: USDT (48,990), WBNB (34,441), CLO (3,239)

---

### Broadest Participation (by unique traders)

```sql
SELECT token_address, token_symbol, unique_traders, trade_count
FROM token_metrics
ORDER BY unique_traders DESC
LIMIT 20;
```

```typescript
const tokens = await TokenMetricsRepository.getTopTokensByTraders(20);
```

Live top-3: USDT (15,340 unique traders), WBNB (9,551), USDC (1,916)

---

### Most Quality Holders (primary smart-money signal)

```sql
SELECT token_address, token_symbol,
       quality_holder_count, holder_count,
       ROUND(quality_holder_count::numeric / NULLIF(holder_count, 0) * 100, 1) AS quality_pct
FROM token_metrics
ORDER BY quality_holder_count DESC
LIMIT 20;
```

```typescript
const tokens = await TokenMetricsRepository.getTopTokensByQualityHolders(20);
```

Live top-5:

| Token | quality_holder_count | holder_count | quality % |
|---|---|---|---|
| WBNB | 460 | 4,251 | 10.8% |
| USDT | 384 | 6,766 | 5.7% |
| USDC | 211 | 973 | 21.7% |
| BSB | 203 | 348 | 58.3% |
| CLO | 188 | 298 | 63.1% |

Insight: BSB and CLO have *fewer* total holders than WBNB/USDT but a much higher
fraction of quality holders — these are "smart money concentrated" tokens, which is
a stronger signal than raw holder count.

---

### Most Active Recently (by last trade timestamp)

```sql
SELECT token_address, token_symbol, last_seen, trade_count, unique_traders
FROM token_metrics
ORDER BY last_seen DESC
LIMIT 20;
```

```typescript
const tokens = await TokenMetricsRepository.getRecentlyActiveTokens(20);
```

---

### Emerging Tokens — Accumulation Signal Candidates

Tokens with high quality-holder concentration, recent first appearance, and
moderate (not dominant) total trader count.  No prices or PnL required.

```sql
SELECT
  tm.token_address,
  tm.token_symbol,
  tm.quality_holder_count,
  tm.unique_traders,
  ROUND(tm.quality_holder_count::numeric / NULLIF(tm.holder_count, 0) * 100, 1) AS quality_pct,
  tm.net_holders,
  tm.first_seen,
  tm.last_seen
FROM token_metrics tm
WHERE tm.quality_holder_count >= 5      -- at least 5 quality holders
  AND tm.unique_traders <= 500          -- not already a major token
  AND tm.net_holders > 0               -- more distinct buyers than sellers
  AND tm.first_seen > NOW() - INTERVAL '7 days'  -- recently appeared
ORDER BY quality_pct DESC
LIMIT 20;
```

Heuristic rationale:
- `quality_holder_count >= 5` — minimum signal threshold; one-off positions are noise
- `unique_traders <= 500` — avoids saturated tokens (USDT, WBNB) where quality ratio is diluted
- `net_holders > 0` — positive buy-side breadth; more distinct buying wallets than selling
- `first_seen > 7 days` — recency; new tokens with quality holder interest are "emerging"

With the current 4-hour dataset, `first_seen` filtering will return everything —
this query becomes meaningful once data spans multiple days.

---

## 5. Field Semantics Summary

| Field | Source | Semantic |
|---|---|---|
| `trade_count` | trades | Total appearances (buy side + sell side) |
| `buy_trades` | trades (tokenOut = this token) | How many times someone received this token |
| `sell_trades` | trades (tokenIn = this token) | How many times someone spent this token |
| `unique_traders` | trades DISTINCT wallet | Breadth of participation |
| `unique_buyers` | trades WHERE side=buy | Wallets that bought this token |
| `unique_sellers` | trades WHERE side=sell | Wallets that sold this token |
| `holder_count` | wallet_positions WHERE net_amount > 0 | Current net-long holders |
| `quality_holder_count` | wallet_positions JOIN wallet_scores WHERE rank_score >= 80 | Quality holders |
| `active_wallet_count` | trades WHERE timestamp > max_ts - 24h | Recency-bounded traders |
| `net_holders` | unique_buyers - unique_sellers | Buy-breadth minus sell-breadth (can be negative) |

### Why `net_holders` for WBNB is -1,072

WBNB is the base trading token on BSC.  Wallets typically:
1. Acquire WBNB from exchanges (not in our dataset)
2. Use WBNB to buy other tokens (WBNB = tokenIn → counted as "seller")
3. Sometimes receive WBNB from selling other tokens (WBNB = tokenOut → counted as "buyer")

In our dataset, 9,551 unique traders touched WBNB.  More distinct wallets
*sold* WBNB (used it as input) than *bought* WBNB (received it as output),
hence negative `net_holders`.  This is structurally expected for base-pair tokens.

Positive `net_holders` is the interesting signal: it means more distinct wallets
received a token than sold it — indicative of accumulation pressure.

---

## 6. How token_metrics Enables Future Phases

### Smart Money Signals (Phase 5)

The key join is already embedded in `quality_holder_count`.  Phase 5 extends this
into a time-series signal:

```sql
-- "Which tokens saw the most quality wallet entries in the last 48 hours?"
-- (requires time-stamped scoring history — not yet built)
SELECT wp.token_address, COUNT(DISTINCT wp.wallet) AS new_quality_entries
FROM wallet_positions wp
JOIN wallet_scores ws ON ws.wallet = wp.wallet
WHERE wp.first_trade_at > NOW() - INTERVAL '48 hours'
  AND wp.net_amount::numeric > 0
  AND ws.rank_score::numeric >= 80
GROUP BY wp.token_address
ORDER BY new_quality_entries DESC;
```

`token_metrics.quality_holder_count` is the static snapshot version of this query.
The Phase 5 signal layer adds the temporal dimension.

### Token Rankings

A composite token rank can be computed from `token_metrics` fields without touching
raw tables:

```sql
SELECT
  token_address,
  token_symbol,
  -- Normalize each dimension to 0-1 relative to max in dataset
  ROUND(unique_traders::numeric      / MAX(unique_traders)      OVER () * 40, 2) AS breadth_score,
  ROUND(quality_holder_count::numeric/ MAX(quality_holder_count) OVER () * 40, 2) AS quality_score,
  ROUND(trade_count::numeric         / MAX(trade_count)          OVER () * 20, 2) AS volume_score
FROM token_metrics
ORDER BY (breadth_score + quality_score + volume_score) DESC
LIMIT 20;
```

No additional tables needed.

### Accumulation Detection

Accumulation is indicated by:
- High `quality_holder_count` (smart money is in)
- High `net_holders` (more buyers than sellers at wallet level)
- Low `unique_sellers` relative to `unique_buyers`

A Phase 5 accumulation score query:

```sql
SELECT
  token_address,
  token_symbol,
  quality_holder_count,
  net_holders,
  ROUND(unique_buyers::numeric / NULLIF(unique_sellers, 0), 2) AS buy_sell_wallet_ratio,
  ROUND(quality_holder_count::numeric / NULLIF(holder_count, 0) * 100, 1) AS quality_concentration_pct
FROM token_metrics
WHERE quality_holder_count >= 3
ORDER BY quality_concentration_pct DESC, net_holders DESC
LIMIT 20;
```

`token_metrics` provides all four inputs directly.

### Agent Reasoning

An agent evaluating a new trade in token X can:
1. Lookup `token_metrics WHERE token_address = X` — single indexed row fetch, < 1ms
2. Read `quality_holder_count` — "do smart wallets hold this?"
3. Read `net_holders` — "is buy pressure net positive?"
4. Read `unique_traders` — "how broadly traded is this token?"
5. Read `last_seen` — "is this token recently active?"

All four questions are answered from one row with no joins.  This is the
primary design goal of `token_metrics` for the agent reasoning layer.

Example agent pre-filter (pseudocode):
```typescript
const tm = await TokenMetricsRepository.getTokenMetrics(tokenOut);
if (!tm || tm.qualityHolderCount < 3) return 'skip: no quality holder signal';
if (tm.netHolders < 0) return 'skip: sell pressure dominates';
if (tm.lastSeen < Date.now() - 7_days) return 'skip: stale token';
// → proceed to LLM reasoning with token context
```

### Community Token Pages

Each token page can render from `token_metrics` without raw table access:

| Page element | Field |
|---|---|
| "X traders" | `unique_traders` |
| "X holders" | `holder_count` |
| "Quality holders" badge | `quality_holder_count` |
| "Trending" flag | `active_wallet_count` relative to `unique_traders` |
| "Buy pressure" indicator | `net_holders > 0` |
| First seen / Last active | `first_seen`, `last_seen` |
| Total swaps | `trade_count` |
| Buy/sell split | `buy_trades`, `sell_trades` |

---

## 7. Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| `active_wallet_count` = `unique_traders` when dataset spans < 2 days | Recency signal is flat for current 4-hour dataset | Becomes meaningful with multi-day indexing |
| `quality_holder_count` join uses `::numeric` cast, blocking index on `rank_score` | ~0.5s overhead in rebuildAll | Future: store rank_score as float4 or avoid cast |
| `token_symbol` / `token_decimals` sourced from trades; bot tokens may have misleading symbols | Display inconsistencies for low-quality tokens | Phase 5: prefer verified tokens table; fallback chain is already correct |
| No volume or price data | Cannot rank by $ volume or market cap | Deliberate: no PnL/price in this phase |
| `rebuildAll` requires wallet_scores to be current | Stale scores → stale quality_holder_count | Documented call order; run scores rebuild first |

---

## 8. Validation Results

Full validation suite (`validate-token-metrics.ts`):

```
Total tokens: 2,690
Checks run: 12
Result: 12 PASS  0 FAIL

Coverage       — PASS: 2,690 token_metrics rows == 2,690 distinct tokens in trades
Arithmetic     — PASS: buy_trades + sell_trades == trade_count (all 2,690 rows)
Net holders    — PASS: net_holders == unique_buyers - unique_sellers (all rows)
Trade counts   — PASS: 30 random tokens verified against raw trades
Trader counts  — PASS: 30 random tokens verified
Holder count   — PASS: 30 random tokens verified against wallet_positions
Quality holders— PASS: 30 random tokens verified (threshold=80, direct join)
Timestamps     — PASS: 30 random tokens (TO_CHAR comparison, no TZ ambiguity)
rebuildToken   — PASS: 3 corrupted tokens restored to correct values
Idempotency    — PASS: two consecutive rebuildAll() produce identical top-5
```
