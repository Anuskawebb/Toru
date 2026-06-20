# Database Reference — Toru

**Supabase PostgreSQL**, region `ap-southeast-1`  
**Pooler:** pgbouncer transaction mode — port 6543, `prepare: false` required  
**ORM:** Drizzle ORM in `packages/db/src/schema/` (schema source of truth)  
**Query client:** raw postgres.js in `client/app/api/` routes  

---

## Connection

```
Host:     aws-1-ap-southeast-1.pooler.supabase.com
Port:     6543
DB:       postgres
User:     postgres.xjqdytwhybgisgycqueo
SSL:      required (rejectUnauthorized: false for pgbouncer)
```

For migrations and scripts use direct connection (port 5432, no pooler).  
For API routes use pgbouncer (port 6543, `?pgbouncer=true`).

---

## Tables

### `indexer_state`

Checkpoint for the BSC indexer. One row per chain.

| Field | Type | Notes |
|---|---|---|
| `chain` | varchar PK | `'bsc'` |
| `last_block_number` | bigint | Last processed block |
| `updated_at` | timestamp | |

**Used by:** `indexer/src/index.ts` — read on startup, updated after each batch

---

### `trades`

Every wallet swap event captured from BSC DEX pools.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `tx_hash` | varchar(66) | |
| `block_number` | bigint | |
| `timestamp` | timestamp | Block time |
| `wallet` | varchar(42) | Lowercase, 0x-prefixed |
| `dex` | varchar(50) | e.g. `'pancakeswap-v3'` |
| `pair_address` | varchar(42) | Pool contract |
| `token_in_address` | varchar(42) | Sell token |
| `token_out_address` | varchar(42) | Buy token |
| `token_in_symbol` | varchar(50) | May be empty |
| `token_out_symbol` | varchar(50) | May be empty |
| `amount_in` | text | Raw BigInt string |
| `amount_out` | text | Raw BigInt string |

**Unique constraint:** `(tx_hash, wallet, token_in_address, token_out_address, amount_in, amount_out, dex)` — deduplication on re-index.

**Downstream:** `wallet_metrics` (incremental), `wallet_scores`, `token_metrics` (both batch)

**Current size:** Growing at ~70 trades/min during backfill

---

### `wallet_metrics`

Behavioral statistics per wallet, derived from `trades`. Updated incrementally per indexer batch.

| Field | Type | Notes |
|---|---|---|
| `wallet` | varchar PK | |
| `trade_count` | integer | Total trades seen |
| `buy_count` | integer | token_out is not stablecoin |
| `sell_count` | integer | token_in is not stablecoin |
| `unique_tokens` | integer | Distinct non-stablecoin tokens touched |
| `first_seen` | timestamp | Block time of first trade |
| `last_seen` | timestamp | Block time of most recent trade |
| `active_days` | integer | COUNT(DISTINCT DATE(timestamp)) |
| `current_open_positions` | integer | Net buy tokens not yet sold |
| `last_updated` | timestamp | |

**Updated by:** `packages/db/src/repositories/wallet-metrics.ts` via `updateFromNewTrades`  
**Read by:** `wallet_scores` rebuild

---

### `wallet_scores`

Composite quality score per wallet. Batch rebuild using `PERCENT_RANK()` window functions over all wallets.

| Field | Type | Notes |
|---|---|---|
| `wallet` | varchar PK | |
| `activity_score` | numeric(5,2) | PERCENT_RANK by trade_count × 100 |
| `conviction_score` | numeric(5,2) | (current_open_positions / unique_tokens) × 100 |
| `breadth_score` | numeric(5,2) | PERCENT_RANK by unique_tokens × 100 |
| `consistency_score` | numeric(5,2) | Repeated focus score |
| `rank_score` | numeric(5,2) | 40% activity + 30% conviction + 20% breadth + 10% consistency |
| `rank_position` | integer | 1 = highest rank_score across all wallets |
| `classification` | varchar | `elite` / `accumulator` / `scout` / `degen` / `noise` |
| `trade_count` | integer | Snapshot from wallet_metrics |
| `unique_tokens` | integer | Snapshot |
| `last_updated` | timestamp | |

**Classification thresholds:**
- `elite`: rank_score ≥ 80
- `accumulator`: rank_score ≥ 60
- `scout`: rank_score ≥ 40
- `degen`: rank_score ≥ 20
- `noise`: rank_score < 20

**Script:** `packages/db/scripts/rebuild-wallet-scores.ts`  
**Current count:** 1,710 wallets  
**Rebuild time:** ~3–5s

---

### `token_metrics`

Aggregated per-token statistics. Depends on `wallet_scores` being current.

| Field | Type | Notes |
|---|---|---|
| `token_address` | varchar PK | BSC contract address |
| `token_symbol` | varchar | May be hex if unresolved |
| `token_decimals` | integer | |
| `trade_count` | integer | Total trades involving this token |
| `buy_trades` | integer | Trades where token was purchased |
| `sell_trades` | integer | Trades where token was sold |
| `unique_traders` | integer | Distinct wallets touching this token |
| `unique_buyers` | integer | |
| `unique_sellers` | integer | |
| `holder_count` | integer | Net buyers still holding (approx) |
| `quality_holder_count` | integer | Holders with rank_score ≥ QUALITY_HOLDER_THRESHOLD |
| `last_updated` | timestamp | |

**Script:** `packages/db/scripts/rebuild-token-metrics.ts`  
**Current count:** 412 tokens

---

### `smart_money_signals`

Core signal table. One row per token. The primary output of the analytics pipeline.

| Field | Type | Notes |
|---|---|---|
| `token_address` | varchar PK | |
| `token_symbol` | varchar | May be hex if CMC not integrated |
| `quality_entry_count_1h` | integer | Quality wallets that bought in last 1h |
| `quality_entry_count_4h` | integer | Last 4h — primary velocity metric |
| `quality_exit_count_1h` | integer | Quality wallets that sold in last 1h |
| `quality_exit_count_4h` | integer | Last 4h |
| `net_accumulation_flow` | integer | entry_4h − exit_4h |
| `quality_holder_count` | integer | Current quality holders |
| `holder_count` | integer | Total holders |
| `quality_concentration_pct` | numeric | quality_holder_count / holder_count × 100 |
| `avg_quality_rank_score` | numeric | Average rank_score of quality holders |
| `accumulator_holder_count` | integer | Holders classified as `accumulator` |
| `accumulation_score` | numeric | 0–100, composite |
| `signal_tier` | varchar | STRONG / MODERATE / WEAK / NOISE |
| `trend_direction` | varchar | INCREASING / STABLE / DECREASING / UNKNOWN |
| `meets_minimum_holders` | boolean | quality_holder_count ≥ 3 AND holder_count ≥ 10 |
| `narrative` | text | AI-generated summary string |
| `computed_at` | timestamp | When last rebuilt |

**Score formula:**
```sql
accumulation_score = (
  PERCENT_RANK() OVER (ORDER BY quality_entry_count_4h) * 25
  + PERCENT_RANK() OVER (ORDER BY quality_concentration_pct) * 20
  + PERCENT_RANK() OVER (ORDER BY avg_quality_rank_score) * 20
  + PERCENT_RANK() OVER (ORDER BY net_accumulation_flow) * 35
) * 100
```

**Signal tier cutoffs:**
- STRONG: score ≥ 70
- MODERATE: score ≥ 40
- WEAK: score ≥ 20
- NOISE: score < 20

**Script:** `packages/db/scripts/rebuild-smart-money-signals.ts`  
**Current count:** 46 tokens with signals, 6 meeting minimum holders  
**Rebuild time:** ~1–2s

---

### `trade_recommendations`

Decision engine output. One row per signal evaluation that resulted in an actionable recommendation.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `agent_wallet` | varchar | Which agent made this decision |
| `token_address` | varchar | Target token |
| `token_symbol` | varchar | |
| `action` | varchar | `BUY` or `SELL` |
| `position_size_pct` | numeric | Recommended % of portfolio |
| `estimated_usd` | numeric | Dollar value at decision time |
| `entry_price_usd` | numeric | Token price at decision time |
| `stop_loss_pct` | numeric | Risk limit |
| `take_profit_pct` | numeric | Target exit |
| `confidence` | numeric | 0.0–1.0 (displayed as 0–100) |
| `signal_tier` | varchar | STRONG / MODERATE / WEAK |
| `risk_tier` | varchar | CONSERVATIVE / MODERATE / AGGRESSIVE / SPECULATIVE |
| `reasons` | text[] | Array of decision rationale strings |
| `blockers` | text[] | Why a trade was rejected (non-null if blocked) |
| `status` | varchar | PENDING / EXECUTED / REJECTED / EXPIRED |
| `decided_at` | timestamp | |

**Written by:** `packages/agent-core/src/decision/decision-engine.ts`  
**Read by:** `/api/agent` (recent decisions), execution engine (PENDING queue)

---

### `execution_orders`

Orders created by the execution engine from approved recommendations.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `agent_id` | varchar | Agent identifier string |
| `agent_wallet` | varchar | |
| `decision_trace_id` | varchar | Correlation ID through the decision pipeline |
| `recommendation_id` | uuid FK → `trade_recommendations.id` | |
| `token_address` | varchar | |
| `token_symbol` | varchar | |
| `action` | varchar | BUY or SELL |
| `amount_usd` | numeric | Dollar value to trade |
| `entry_price_usd` | numeric | |
| `slippage_limit_pct` | numeric | Max acceptable slippage |
| `status` | varchar | PENDING / PROCESSING / FILLED / FAILED / CANCELLED |
| `created_at` | timestamp | |

**Written by:** `packages/agent-core/src/execution/execution-engine.ts`  
**Read by:** `/api/execution-center`, `/api/orders`, `/api/tokens/[address]/activity`

---

### `execution_transactions`

On-chain transaction records for filled orders.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `order_id` | uuid FK → `execution_orders.id` | |
| `tx_hash` | varchar | BSC transaction hash |
| `status` | varchar | PENDING / SUCCESS / FAILED |
| `gas_used` | numeric | |
| `actual_amount_usd` | numeric | Actual execution value |
| `executed_at` | timestamp | |

**Written by:** `packages/agent-core/src/execution/executor.ts` (or mock-executor.ts)  
**Read by:** `/api/execution-center`, `/api/executions`

---

### `agent_positions`

Open and closed positions for each agent.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `agent_wallet` | varchar | |
| `token_address` | varchar | |
| `token_symbol` | varchar | |
| `recommendation_id` | uuid FK → `trade_recommendations.id` | |
| `entry_price_usd` | numeric | |
| `position_size_usd` | numeric | Dollar value at open |
| `position_size_pct` | numeric | % of portfolio at open |
| `stop_loss_pct` | numeric | |
| `take_profit_pct` | numeric | |
| `unrealized_pnl_pct` | numeric | Live P&L percentage |
| `status` | varchar | OPEN / CLOSED |
| `opened_at` | timestamp | |
| `closed_at` | timestamp | |

**Written by:** execution engine on fill + valuation engine on price update  
**Read by:** `/api/positions`, `/api/portfolio`

---

### `portfolio_state`

One row per agent wallet. Live portfolio snapshot.

| Field | Type | Notes |
|---|---|---|
| `agent_wallet` | varchar PK | |
| `portfolio_usd` | numeric | Total portfolio value |
| `stablecoin_usd` | numeric | Cash/USDT balance |
| `token_exposure_usd` | numeric | Value locked in open positions |
| `buying_power_usd` | numeric | Available capital (stablecoin − reserved) |
| `starting_capital_usd` | numeric | Original deposit — never changes |
| `peak_portfolio_usd` | numeric | All-time high (for drawdown calculation) |
| `drawdown_pct` | numeric | (peak − current) / peak × 100 |
| `rolling_loss_pct_24h` | numeric | 24h realized loss as % of portfolio |
| `cash_reserve_pct` | numeric | stablecoin / portfolio × 100 |
| `open_positions` | integer | COUNT(agent_positions WHERE status=OPEN) |
| `valuation_confidence` | numeric | 0–100, data quality of price observations |
| `updated_at` | timestamp | |

**Written by:** `packages/agent-core/src/portfolio/portfolio-state-service.ts`  
**Read by:** `/api/portfolio`, `/api/agent`, `/api/execution-center`

---

### `price_observations`

VWAP price data points for tokens. Written by the price observation service from swap events.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `token_address` | varchar | |
| `price_usd` | numeric | Observed price |
| `volume_usd` | numeric | Trade volume |
| `observed_at` | timestamp | |
| `source` | varchar | e.g. `'pancakeswap-v3'` |

**Used by:** `packages/agent-core/src/valuation/price-aggregator.ts` for VWAP computation

---

## Table Dependency Order

For a clean rebuild, execute in this order:

```
1. trades           (source of truth — do not truncate)
2. wallet_metrics   (derived from trades — incremental or full rebuild)
3. wallet_scores    (requires wallet_metrics — full rebuild)
4. token_metrics    (requires trades + wallet_scores — full rebuild)
5. smart_money_signals (requires token_metrics + wallet_scores — full rebuild)
6. trade_recommendations (output of decision engine — generated, not rebuilt)
7. execution_orders      (output of execution engine)
8. execution_transactions (output of executor)
9. agent_positions        (output of execution engine + valuation)
10. portfolio_state       (output of portfolio valuation engine)
```

Scripts for steps 3–5 are in `packages/db/scripts/`:
```bash
cd packages/db
npx ts-node scripts/rebuild-wallet-scores.ts
npx ts-node scripts/rebuild-token-metrics.ts
npx ts-node scripts/rebuild-smart-money-signals.ts
```

---

## Relationships

```
trades ─────────────────────────────────────────┐
  │                                             │
  ▼ (group by wallet)                           ▼ (group by token)
wallet_metrics ──► wallet_scores         token_metrics
                      │                       │
                      └──────────────────────►│
                                              ▼
                                    smart_money_signals
                                              │
                                              ▼ (decision engine)
                                    trade_recommendations
                                              │
                                              ▼ (execution engine)
                                      execution_orders
                                              │
                                              ▼ (executor / TWAK)
                                   execution_transactions
                                              │
                                              ▼ (on fill)
                                      agent_positions
                                              │
                                              ▼ (valuation engine)
                                      portfolio_state
```
