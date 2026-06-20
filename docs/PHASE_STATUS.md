# Phase Status — Toru

**Last updated:** 2026-06-19

---

## Completed

### Phase 1 — Position Engine

Built the foundational trade tracking layer.

- `trades` table schema and indexing
- `wallet_positions` derived from trade history (net buys/sells per wallet/token)
- `PositionRepository` with `applyTrade`, `applyTrades`, `rebuildWallet`, `rebuildAll`
- `indexer_state` checkpoint table for incremental block processing
- Deduplication via unique trade index `(tx_hash, wallet, token_in, token_out, amount_in, amount_out, dex)`

---

### Phase 2 — Wallet Metrics Engine

Compute behavioral statistics per wallet from raw trade history.

- `wallet_metrics` table with trade_count, buy/sell counts, unique_tokens, active_days, open_positions
- `WalletMetricsRepository` with `rebuildWallet` and `rebuildAll`
- Incremental update path: `updateFromNewTrades` updates only affected wallets per indexing batch
- `rebuild-wallet-metrics.ts` one-shot backfill script

---

### Phase 3 — Wallet Scoring Engine

Rank wallets by trading quality using window functions.

- `wallet_scores` table with composite `rank_score`
- Score components: activity (40%), conviction (30%), breadth (20%), consistency (10%)
- `classification` labels: elite / accumulator / scout / degen / noise
- `PERCENT_RANK()` over all wallets — batch-only, not incremental
- `WalletScoresRepository.rebuildAll()` and `rebuild-wallet-scores.ts`
- **Current data:** 1,710 wallets scored

---

### Phase 4 — Token Intelligence Engine

Aggregate wallet-level intelligence into per-token signals.

- `token_metrics` table: holder counts, quality holders, buy/sell ratios, unique traders
- `QUALITY_HOLDER_THRESHOLD` filter (rank_score ≥ threshold to count as quality)
- `token_intel_snapshots` for historical signal tracking
- `TokenMetricsRepository.rebuildAll()` and `rebuild-token-metrics.ts`
- **Current data:** 412 tokens with metrics

---

### Phase 5 — Smart Money Signals

Generate actionable trading signals from wallet + token intelligence.

- `smart_money_signals` table with 24 fields
- Accumulation score formula: 35% net flow + 25% entry velocity + 20% concentration + 20% avg rank
- Signal tiers: STRONG / MODERATE / WEAK / NOISE
- 4-hour temporal window for entry/exit velocity
- `meets_minimum_holders` noise floor (quality ≥ 3 AND total ≥ 10)
- `SmartMoneySignalsRepository.rebuildAll()` CTE-chain SQL
- **Current data:** 46 tokens with real signals, 6 meeting minimum holders

---

### Phase 6 — Analytics & Risk Engine

Risk-aware decision context alongside signals.

- `RiskEngine` with portfolio risk assessment (drawdown limits, exposure caps, open risk)
- `price_observations` for VWAP price aggregation
- `PriceObservationService` and `PriceAggregator`
- Signal bundle validation against portfolio state
- Integration test suite: `validate-e2e-pipeline.ts` (28 checks, all passing)

---

### Phase 7 — Decision Engine + Execution Prerequisites

Full decision pipeline from signals to trade recommendations.

- `trade_recommendations` table with full lifecycle fields
- `DecisionEngine` with signal ranking, risk filtering, capital allocation
- `CapitalAllocator` enforcing position size limits
- `ExecutionPlanner` for pre-execution validation
- `PortfolioStateService` and `PortfolioValuationEngine`
- `execution_orders` and `execution_transactions` schema

---

### Phase 8A — Execution Infrastructure

Execution engine and agent portfolio tracking.

- `ExecutionEngine` processing recommendation queue into orders
- `executor.ts` (real) and `mock-executor.ts` (simulation)
- `agent_positions` table for open/closed position tracking
- `portfolio_state` single-row snapshot with drawdown, exposure, P&L tracking
- Agent identity on-chain: `AgentIdentityRegistry` deployed on Mantle Sepolia
- `registerSubAgents.ts` — registers copy-score and risk-management agents
- Validation suite: `validate-execution-engine.ts` (47 checks, all passing)

---

### Phase 8A (API + Frontend) — Toru API Layer & Data Integration

Complete API layer and frontend data wiring (completed in this session).

- 10 Next.js Route Handler endpoints, all querying live PostgreSQL
- `globalThis.__toroSql` pool singleton — eliminates 25s cold-start per route
- Wrong Supabase project fixed (`ap-northeast-1` → `ap-southeast-1`)
- All null-safe date handling across routes
- **All 10 endpoints returning real data at 83–320ms**
- Frontend pages wired: markets, portfolio, agent, execution-center, assets, community, community-feed, token detail
- Components wired: top-opportunities, live-intelligence, signals-tab
- `FRONTEND_API_MAPPING.md` and `LIVE_DATA_PIPELINE_REPORT.md` produced

---

## In Progress

### Phase 8A.5 — Live Analytics Automation

**Goal:** Close the propagation gap between the indexer and frontend-visible signals.

**Problem:** `wallet_scores`, `token_metrics`, and `smart_money_signals` have no scheduler. They were last rebuilt 18h before this session. Only `wallet_metrics` is updated automatically (inline in the indexer batch).

**Planned implementation:**

Add a `setInterval` (15–30 min) inside the BSC indexer process:

```typescript
setInterval(async () => {
  await WalletScoresService.rebuildAll()      // ~3-5s
  await TokenMetricsService.rebuildAll()     // ~2-4s
  await SmartMoneySignalsRepository.rebuildAll() // ~1-2s
  await DecisionEngine.run()                 // fast
}, 15 * 60 * 1000)
```

**Status:** Designed, not yet implemented.

---

## Next

### Phase 8B — Trust Wallet Agent Kit (TWAK) Execution

Replace `mock-executor.ts` with real on-chain swap execution via TWAK.

- TWAK manages the agent's self-custodial wallet (user never shares keys)
- When execution engine approves an order, TWAK signs and submits the BSC swap
- `execution_transactions.tx_hash` populated with real on-chain hash
- PancakeSwap V3 as primary DEX router
- Slippage protection from `execution_orders.slippage_limit_pct`

**Requires:** TWAK SDK integration, agent wallet funding, BSC RPC config

---

## Future

### Phase 8C — BNB AI Agent SDK

Give each Toru agent a verifiable on-chain identity in the BNB ecosystem.

- Migrate agent registry from Mantle Sepolia to BNB chain
- Wire BNB AI Agent SDK into agent lifecycle: create → fund → activate → pause → close
- Each agent publishes its capabilities, risk parameters, and performance metrics on-chain
- Composability: other BNB agents can query Toru agents' signals

---

### Phase 8D — CoinMarketCap Agent Hub

Replace placeholder and unresolved token data with CMC's canonical dataset.

- Token symbols: resolve hex addresses → real symbols via CMC metadata API
- Price data: supplement signal scoring with CMC 24h volume and market cap
- Trending tokens: cross-validate internal signals against CMC trending lists
- Explainability: attribute signal scores to CMC-sourced market context

---

### Phase 8E — Explainability Layer

Make every signal and recommendation understandable to non-technical users.

- Per-signal explanation: "3 elite wallets entered in 4h. Net inflow of 12 quality wallets. Accumulation score 82."
- Per-recommendation explanation: "BUY PIEVERSE — strong smart-money conviction (score 82). Risk: MODERATE. Stop-loss at 8%."
- Trade history with reasoning: `trade_recommendations.reasons[]` surfaced in UI
- AI narrative generation: extend `smart_money_signals.narrative` field
- CMC price context integration (Phase 8D dependency)
