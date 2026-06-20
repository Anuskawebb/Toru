# Architecture — Toru

---

## Services

### Frontend (`client/`)

Next.js 16.2.6 app with App Router. Serves the UI and doubles as the API layer via Route Handlers (`app/api/*/route.ts`). No separate Express/Fastify backend exists — the Next.js server handles all API traffic.

- **Port:** 3001 (dev), 3000 (prod)
- **DB access:** postgres.js singleton (`client/lib/db.ts`) with globalThis cache to prevent cold-start per route bundle
- **Typed helpers:** `client/lib/api.ts` — fetch wrappers used by both server and client components

### API Layer (`client/app/api/`)

Ten Route Handler endpoints, all `force-dynamic`, querying Supabase PostgreSQL directly via postgres.js. No ORM in the API layer — raw SQL for performance and pgbouncer compatibility.

See `API_REFERENCE.md` for full endpoint documentation.

### Indexer (`indexer/`)

BSC trade indexer. Polls BSC via `eth_getLogs` in 12s cycles, chunked in 10,000-block windows. Detects wallet swaps across tracked DEX pools, writes to `trades` and updates `wallet_metrics` incrementally.

- **Chain:** BSC Mainnet (chain ID 56)
- **Checkpoint:** `indexer_state` table (`chain = 'bsc'`)
- **Ingest rate:** ~70 trades/minute during live backfill
- **Deployment:** Remote server (not running locally in dev)

### Watcher (`watcher/`)

Separate process for Mantle Mainnet. Monitors leader wallets trading on Agni Finance and FusionX pools. When a tracked leader swaps, the watcher triggers copy-trade execution on Mantle Sepolia via the keeper wallet. Separate from the BSC analytics pipeline.

- **Chain:** Mantle Mainnet (chain ID 5000) + Mantle Sepolia testnet (5003)
- **Pools:** USDe/WMNT, USDT/WMNT, USDC/WMNT, USDT/WETH, USDT/mETH, WMNT/WETH
- **Contract:** `VaultManager` at `0xEA364cB5D11F5e05cb654fC2a87BA90bb1592efc` (Mantle Sepolia)

### Analytics Worker (missing — see `PHASE_STATUS.md`)

Currently no standalone analytics worker. The three rebuild scripts (`rebuild-wallet-scores.ts`, `rebuild-token-metrics.ts`, `rebuild-smart-money-signals.ts`) run manually. Phase 8A.5 goal: add a `setInterval` inside the indexer or a standalone worker to run these every 15–30 minutes.

### Agent Core (`packages/agent-core/`)

TypeScript library containing the decision engine, execution engine, portfolio valuation, and risk engine. Currently called via scripts — not running as a live service.

```
packages/agent-core/src/
├── decision/
│   ├── decision-engine.ts        Main entry point
│   ├── decision-ranking.ts       Signal ranking and filtering
│   ├── capital-allocator.ts      Position sizing
│   ├── execution-planner.ts      Pre-execution checks
│   └── trade-recommendation-types.ts
├── execution/
│   ├── execution-engine.ts       Order lifecycle management
│   ├── executor.ts               Real swap executor (TWAK in 8B)
│   └── mock-executor.ts          Simulation mode
├── portfolio/
│   ├── portfolio-state-service.ts
│   ├── portfolio-valuation-engine.ts
│   └── portfolio-types.ts
├── position/
│   └── position-registry-service.ts
├── risk/
│   └── risk-engine.ts
└── valuation/
    ├── price-aggregator.ts
    ├── price-observation-service.ts
    └── price-service.ts
```

---

## Database Tables

**Connection:** Supabase PostgreSQL, `ap-southeast-1` region  
**Pooler:** pgbouncer transaction mode, port 6543  
**ORM:** Drizzle (packages/db), raw postgres.js in API routes

### Trading Domain

#### `trades`

Raw swap events from BSC. Every wallet interaction with a tracked DEX pool.

| Field | Type | Description |
|---|---|---|
| `id` | serial PK | Auto-increment |
| `tx_hash` | varchar(66) | Transaction hash |
| `block_number` | bigint | BSC block number |
| `timestamp` | timestamp | Block time |
| `wallet` | varchar(42) | Trader wallet (lowercase) |
| `dex` | varchar(50) | DEX identifier |
| `pair_address` | varchar(42) | Pool contract |
| `token_in_address` | varchar(42) | Sell token |
| `token_out_address` | varchar(42) | Buy token |
| `token_in_symbol` | varchar(50) | Sell token symbol |
| `token_out_symbol` | varchar(50) | Buy token symbol |
| `amount_in` | text | Raw amount (BigInt string) |
| `amount_out` | text | Raw amount (BigInt string) |

**Unique index:** `(tx_hash, wallet, token_in, token_out, amount_in, amount_out, dex)`

#### `execution_orders`

Agent-initiated trade orders. Written by the execution engine when a recommendation is approved.

| Field | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `agent_wallet` | varchar | Agent's wallet address |
| `recommendation_id` | uuid FK | Links to `trade_recommendations` |
| `token_address` | varchar | Target token |
| `token_symbol` | varchar | |
| `action` | varchar | BUY or SELL |
| `amount_usd` | numeric | Dollar value |
| `entry_price_usd` | numeric | Price at order creation |
| `slippage_limit_pct` | numeric | Max slippage tolerance |
| `status` | varchar | PENDING / PROCESSING / FILLED / FAILED / CANCELLED |
| `created_at` | timestamp | |

#### `execution_transactions`

On-chain transaction records for filled orders. One-to-one with `execution_orders` in the successful path.

| Field | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `order_id` | uuid FK | Links to `execution_orders` |
| `tx_hash` | varchar | On-chain transaction hash |
| `status` | varchar | PENDING / SUCCESS / FAILED |
| `gas_used` | numeric | |
| `executed_at` | timestamp | |

---

### Intelligence Domain

#### `wallet_metrics`

Computed per-wallet trading statistics. Updated incrementally by the indexer after each trade batch.

| Field | Type | Description |
|---|---|---|
| `wallet` | varchar PK | Lowercase address |
| `trade_count` | integer | Total trades observed |
| `buy_count` | integer | |
| `sell_count` | integer | |
| `unique_tokens` | integer | Distinct tokens traded |
| `first_seen` | timestamp | |
| `last_seen` | timestamp | |
| `active_days` | integer | |
| `current_open_positions` | integer | |
| `last_updated` | timestamp | |

#### `wallet_scores`

Composite behavioral score per wallet. Rebuilt in batch using `PERCENT_RANK()` window functions — cannot be updated incrementally. Requires full scan of `wallet_metrics`.

| Field | Type | Description |
|---|---|---|
| `wallet` | varchar PK | |
| `activity_score` | numeric(5,2) | PERCENT_RANK by trade_count × 100 |
| `conviction_score` | numeric(5,2) | (open_positions / unique_tokens) × 100 |
| `breadth_score` | numeric(5,2) | PERCENT_RANK by unique_tokens × 100 |
| `consistency_score` | numeric(5,2) | Repeated token focus metric |
| `rank_score` | numeric(5,2) | Composite: 40% activity, 30% conviction, 20% breadth, 10% consistency |
| `rank_position` | integer | 1 = top wallet |
| `classification` | varchar | elite / accumulator / scout / degen / noise |
| `last_updated` | timestamp | |

#### `token_metrics`

Aggregated per-token statistics from `trades` + `wallet_scores`. Batch-rebuilt after wallet scores are current.

| Field | Type | Description |
|---|---|---|
| `token_address` | varchar PK | |
| `token_symbol` | varchar | |
| `trade_count` | integer | Total trades for this token |
| `unique_traders` | integer | |
| `holder_count` | integer | Current holders (net buys − sells) |
| `quality_holder_count` | integer | Holders with rank_score ≥ threshold |
| `buy_trades` | integer | |
| `sell_trades` | integer | |
| `last_updated` | timestamp | |

#### `smart_money_signals`

Core signal table. One row per token. Computed from `wallet_positions`, `wallet_scores`, `token_metrics` in a single CTE-chain SQL pass.

| Field | Type | Description |
|---|---|---|
| `token_address` | varchar PK | |
| `token_symbol` | varchar | May be hex address if unresolved |
| `accumulation_score` | numeric | 0–100 composite score |
| `signal_tier` | varchar | STRONG / MODERATE / WEAK / NOISE |
| `quality_entry_count_4h` | integer | Smart wallets entering in 4h |
| `quality_exit_count_4h` | integer | Smart wallets exiting in 4h |
| `net_accumulation_flow` | integer | Entries minus exits |
| `quality_holder_count` | integer | |
| `holder_count` | integer | |
| `quality_concentration_pct` | numeric | % of holders that are quality wallets |
| `avg_quality_rank_score` | numeric | Avg rank_score of quality holders |
| `accumulator_holder_count` | integer | Holders classified as accumulators |
| `trend_direction` | varchar | INCREASING / STABLE / DECREASING / UNKNOWN |
| `meets_minimum_holders` | boolean | Quality holders ≥ 3 AND total ≥ 10 |
| `narrative` | text | AI-generated signal summary |
| `computed_at` | timestamp | |

**Score formula:**
```
accumulation_score =
  PERCENT_RANK(quality_entry_count_4h) × 25
  + PERCENT_RANK(quality_concentration_pct) × 20
  + PERCENT_RANK(avg_quality_rank_score) × 20
  + PERCENT_RANK(net_accumulation_flow) × 35
```

---

### Portfolio Domain

#### `portfolio_state`

Single row per agent wallet. Current portfolio snapshot.

| Field | Type | Description |
|---|---|---|
| `agent_wallet` | varchar PK | |
| `portfolio_usd` | numeric | Total value (stablecoin + tokens) |
| `stablecoin_usd` | numeric | Cash equivalent |
| `token_exposure_usd` | numeric | Value in open positions |
| `buying_power_usd` | numeric | Available to deploy |
| `starting_capital_usd` | numeric | Initial deposit (preserved for P&L calc) |
| `peak_portfolio_usd` | numeric | All-time high |
| `drawdown_pct` | numeric | Current drawdown from peak |
| `rolling_loss_pct_24h` | numeric | 24h rolling loss as % of portfolio |
| `open_positions` | integer | |
| `valuation_confidence` | numeric | Price data quality score |

#### `agent_positions`

Open and closed trading positions taken by the agent.

| Field | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `agent_wallet` | varchar | |
| `token_address` | varchar | |
| `token_symbol` | varchar | |
| `recommendation_id` | uuid FK | Source recommendation |
| `entry_price_usd` | numeric | Price at open |
| `position_size_usd` | numeric | Dollar value |
| `position_size_pct` | numeric | % of portfolio |
| `stop_loss_pct` | numeric | |
| `take_profit_pct` | numeric | |
| `unrealized_pnl_pct` | numeric | Current gain/loss % |
| `status` | varchar | OPEN / CLOSED |
| `opened_at` | timestamp | |
| `closed_at` | timestamp | |

---

### Recommendations Domain

#### `trade_recommendations`

Agent decision output. Created by the decision engine, consumed by the execution engine.

| Field | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `agent_wallet` | varchar | |
| `token_address` | varchar | |
| `token_symbol` | varchar | |
| `action` | varchar | BUY or SELL |
| `position_size_pct` | numeric | Recommended allocation |
| `estimated_usd` | numeric | Dollar value |
| `entry_price_usd` | numeric | |
| `stop_loss_pct` | numeric | |
| `take_profit_pct` | numeric | |
| `confidence` | numeric | 0.0–1.0 decimal |
| `signal_tier` | varchar | Source signal tier |
| `risk_tier` | varchar | CONSERVATIVE / MODERATE / AGGRESSIVE / SPECULATIVE |
| `reasons` | text[] | Decision rationale array |
| `blockers` | text[] | Why a trade was rejected |
| `status` | varchar | PENDING / EXECUTED / REJECTED / EXPIRED |
| `decided_at` | timestamp | |

---

## Current Data Flow

```
BSC Chain
  ↓  [automated — remote server]
indexer/src/index.ts polls eth_getLogs
  ↓  INSERT, ON CONFLICT IGNORE
trades table (raw swaps)
  ↓  inline per batch
wallet_metrics (incremental update per wallet)
  ↓  [manual today — run rebuild scripts]
wallet_scores (PERCENT_RANK batch rebuild)
  ↓
token_metrics (aggregation from trades + scores)
  ↓
smart_money_signals (CTE-chain SQL, one pass)
  ↓  [not yet scheduled]
decision-engine.ts → trade_recommendations
  ↓  [not yet scheduled]
execution-engine.ts → execution_orders → execution_transactions
  ↓
Frontend APIs (client/app/api/*)
  ↓  83–320ms response time
Frontend pages (client/app/*)
```

---

## Connection Details

```
DATABASE_URL=postgresql://postgres.xjqdytwhybgisgycqueo:...
             @aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres
             ?pgbouncer=true
```

The pooler uses **transaction mode** — each query borrows a connection from pgbouncer for its duration. `prepare: false` is required. The `globalThis.__toroSql` singleton in `client/lib/db.ts` prevents Turbopack from creating isolated pools per route bundle.
