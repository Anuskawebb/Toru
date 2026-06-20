# Project Overview — Toru

**BNB AI Trading Agent Hackathon Submission**

---

## What Toru Is

Toru is a crypto intelligence and autonomous trading platform. It monitors smart-money wallet behaviour on BSC, scores wallets by conviction and execution quality, generates token signals, and executes trades through a self-custodial agent wallet — without requiring users to share keys.

### Core thesis

```
Smart Money Intelligence
+
AI Decision Making
+
Self-Custodial Execution
```

Users follow smart wallets. The system watches those wallets on-chain, extracts accumulation patterns, scores them, generates signals, and either recommends or autonomously executes copy trades on the user's behalf.

---

## Architecture Pipeline

```
BSC (Binance Smart Chain)
  ↓  eth_getLogs polling every 12s
Indexer (indexer/)
  ↓  INSERT INTO trades
Trades table
  ↓  inline after each batch
Wallet Metrics  (wallet_metrics)
  ↓  scheduled rebuild every 15–30 min
Wallet Scores   (wallet_scores)
  ↓  after wallet scores
Token Metrics   (token_metrics)
  ↓  after token metrics
Smart Money Signals (smart_money_signals)
  ↓  decision engine
Trade Recommendations (trade_recommendations)
  ↓  execution engine
Execution Orders / Transactions (execution_orders, execution_transactions)
  ↓  Phase 8B: TWAK on-chain swap
Agent Positions / Portfolio (agent_positions, portfolio_state)
  ↓
Frontend APIs  (client/app/api/*)
  ↓
Frontend       (client/)
```

---

## Sponsor Stack

### CoinMarketCap Agent Hub (Phase 8D)

**Role: Data & market intelligence layer.**

CMC provides verified price feeds, market cap, volume, token metadata, and trending token lists. In Phase 8D, Toru will replace placeholder price data and unresolved token symbols with CMC's canonical data. CMC Agent Hub also enables the explainability layer — Toru can attribute signals to market context that CMC quantifies.

- Token symbols currently stored as raw hex addresses in `smart_money_signals` will resolve via CMC metadata API
- Market cap and 24h volume will supplement the accumulation score
- Trending lists from CMC will cross-validate internally detected smart-money signals

### Trust Wallet Agent Kit (Phase 8B)

**Role: Execution layer — on-chain swap execution.**

TWAK is the execution bridge between Toru's decision engine and BSC liquidity pools. When the decision engine approves a trade recommendation, TWAK submits the swap transaction from the agent's self-custodial wallet. The user never shares private keys — TWAK holds and signs transactions on behalf of the agent wallet it manages.

- Currently: execution engine writes to `execution_orders` / `execution_transactions` (mock executor path)
- Phase 8B: replace `mock-executor.ts` with TWAK calls
- Supports BEP-20 token swaps on PancakeSwap and other BSC DEXes

### BNB AI Agent SDK (Phase 8C)

**Role: Agent identity, orchestration, and on-chain registration.**

BNB AI Agent SDK gives each Toru agent an on-chain identity (ERC-8004 compatible). Agents are registered with capabilities, metadata, and the vault they manage. This makes Toru agents verifiable, composable with other BNB ecosystem agents, and auditable on-chain.

- `AgentIdentityRegistry` contract already deployed on Mantle Sepolia (`0xF00ba1db267E1D4E8eBcE4405f5B8015426C6968`)
- `contracts/web3/scripts/registerSubAgents.ts` registers copy-score and risk-management sub-agents
- Phase 8C: migrate to BNB chain, wire SDK into agent lifecycle (create → fund → activate → track)

---

## User Journey

```
User lands on Toru
  ↓
Review Smart Money Signals  (Markets page — live data)
  ↓
Create Agent                (Onboarding flow)
  ↓
Fund Agent Wallet           (TWAK-managed wallet, Phase 8B)
  ↓
Choose Strategy             (Conservative / Balanced / Aggressive)
  ↓
Choose Risk Parameters      (stop loss %, max allocation %, max drawdown %)
  ↓
Agent Monitors Signals      (continuous — analytics pipeline)
  ↓
Agent Makes Decisions       (decision engine — trade_recommendations)
  ↓
Autonomous Execution        (TWAK swap — Phase 8B)
  ↓
Portfolio Tracking          (portfolio_state, agent_positions)
```

### Operating Modes

**Autonomous Mode** — Agent monitors signals, makes decisions, and executes swaps without user approval. Bounded by the user's configured risk parameters (stop-loss, max allocation per token, max drawdown).

**Assisted Mode** — Agent generates recommendations and queues them, but waits for the user to approve each trade before execution. User sees the signal rationale before confirming.

**Manual Mode** — Agent only provides intelligence (signals, rankings, activity feed). The user makes all trading decisions independently. No agent wallet interaction.

---

## Repository Structure

```
Aether-mantle/
├── client/          Next.js 16 frontend + API layer
├── indexer/         BSC trade indexer (eth_getLogs polling)
├── watcher/         Mantle copy-trade watcher (separate chain)
├── packages/
│   ├── db/          Drizzle ORM schema, repositories, analytics services
│   └── agent-core/  Decision engine, execution engine, portfolio valuation
├── contracts/       Solidity contracts (VaultManager, AgentIdentityRegistry, aUSD)
├── landing/         Marketing landing page
└── docs/            This directory
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.2.6, TypeScript, Tailwind CSS |
| API | Next.js Route Handlers (`app/api/*/route.ts`) |
| Database client | postgres.js 3.x (raw SQL, pgbouncer-compatible) |
| ORM | Drizzle ORM (packages/db) |
| Database | Supabase PostgreSQL (ap-southeast-1) |
| Indexer | viem, TypeScript, BSC HTTP polling |
| Agent core | TypeScript, packages/agent-core |
| Contracts | Solidity, Hardhat, Mantle Sepolia |
| Package manager | pnpm workspaces |

---

## Current Status (June 2026)

| Component | Status |
|---|---|
| BSC Indexer | ✅ Live, remote server |
| Analytics Pipeline | ✅ Working (manual schedule today, automation pending) |
| Smart Money Signals | ✅ 46 tokens with real scores |
| Frontend API Layer | ✅ All 10 endpoints live, 83–320ms |
| Frontend Pages | ✅ Core pages wired to real data |
| Decision Engine | ⚠️ Code complete, not scheduled |
| Execution Engine | ⚠️ Code complete, not scheduled |
| TWAK Integration | 🔲 Phase 8B |
| BNB AI Agent SDK | 🔲 Phase 8C |
| CMC Agent Hub | 🔲 Phase 8D |
