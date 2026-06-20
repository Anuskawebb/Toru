# Agent Handoff — Toru

**Context package for AI coding agents entering this codebase.**  
Read this before writing any code. It answers the questions you would otherwise spend 20 tool calls figuring out.

---

## What is Toru?

Toru is a crypto intelligence and autonomous trading platform. It watches smart-money wallets on BSC, scores them, generates token accumulation signals, and (eventually) executes trades via a self-custodial agent wallet. The frontend is a Next.js 16 app that also hosts the API layer.

---

## Monorepo Structure

```
Aether-mantle/
├── client/         Next.js 16 app (frontend + API)
├── indexer/        BSC trade indexer
├── watcher/        Mantle copy-trade watcher (different chain)
├── packages/
│   ├── db/         Drizzle schema, repositories, analytics scripts
│   └── agent-core/ Decision engine, execution engine, portfolio
├── contracts/      Solidity (Mantle Sepolia)
├── landing/        Marketing site
└── docs/           This directory
```

Working directory for frontend tasks: `client/`  
Dev server: `pnpm dev --port 3001` (from `client/`)

---

## The Database

**Supabase PostgreSQL, ap-southeast-1 region.**  
Connection is in `client/.env.local` as `DATABASE_URL`.

The correct project is `postgres.xjqdytwhybgisgycqueo` (ap-southeast-1). There is a dead project at `ap-northeast-1` (SomniaHackathon) — if you see that URL, it's wrong.

Client-side: `client/lib/db.ts` exports a `postgres.Sql` singleton via `globalThis.__toroSql`. This singleton is **required** — without it, Turbopack creates one connection pool per route bundle, causing 25-second cold-starts on every endpoint.

Do NOT create a new `postgres(url)` call in any file. Import `sql` from `@/lib/db`.

---

## Key Tables

| Table | Purpose | Updated By |
|---|---|---|
| `trades` | Raw BSC swap events | Indexer (automated) |
| `wallet_metrics` | Per-wallet stats | Indexer, inline per batch |
| `wallet_scores` | Quality score 0–100 | `rebuild-wallet-scores.ts` (manual/scheduled) |
| `token_metrics` | Per-token aggregates | `rebuild-token-metrics.ts` |
| `smart_money_signals` | Token signals (PK: token_address) | `rebuild-smart-money-signals.ts` |
| `trade_recommendations` | Agent decisions | decision-engine.ts (not running) |
| `execution_orders` | Trade orders | execution-engine.ts (not running) |
| `execution_transactions` | On-chain tx records | executor.ts (not running) |
| `agent_positions` | Open/closed positions | execution-engine.ts (not running) |
| `portfolio_state` | Portfolio snapshot | portfolio-state-service.ts (not running) |

**`smart_money_signals` primary key is `token_address`, not `id`.** This is non-obvious and has caused bugs before.

---

## The API Layer

10 Route Handlers in `client/app/api/`. All are `force-dynamic`.

| Endpoint | Primary Table | Used By |
|---|---|---|
| `GET /api/signals` | `smart_money_signals` | Markets, Dashboard, Community Feed |
| `GET /api/portfolio` | `portfolio_state` + `agent_positions` | Portfolio |
| `GET /api/positions` | `agent_positions` | Assets, Portfolio |
| `GET /api/orders` | `execution_orders` | Execution Center |
| `GET /api/executions` | `execution_transactions` | Execution Center |
| `GET /api/agent` | 4 tables aggregated | Agent |
| `GET /api/execution-center` | `execution_orders` + `portfolio_state` | Execution Center |
| `GET /api/activity` | `trade_recommendations` + `execution_transactions` + `smart_money_signals` | Dashboard, Community |
| `GET /api/tokens/[address]` | `smart_money_signals` | Token Detail |
| `GET /api/tokens/[address]/activity` | `execution_orders` | Token Detail |

Typed fetch helpers in `client/lib/api.ts`. Use these in pages:
```typescript
import { fetchSignals, fetchPortfolio, fetchAgent, fetchActivity, fetchToken } from '@/lib/api'
```

---

## What's Live vs. Empty

### Live Data (real rows in DB)

- `trades`: active (70/min)
- `wallet_metrics`: 1,710 wallets
- `wallet_scores`: 1,710 wallets
- `token_metrics`: 412 tokens
- `smart_money_signals`: 46 tokens (6 meeting noise floor)
- `portfolio_state`: 1 row (real values)
- `agent_positions`: 2 open positions (real)

### Empty (correct schema, no rows yet)

- `trade_recommendations`: 0 rows — decision engine not scheduled
- `execution_orders`: 0 rows — execution engine not scheduled
- `execution_transactions`: 0 rows
- `price_observations`: may have some rows from valuation engine tests

### What this means for you

Pages that fetch from empty tables will render "empty state" correctly — no crashes. But don't add artificial fallback data. The empty state is accurate.

---

## What's Mocked in the Frontend

| File | Mock Source | Phase to Replace |
|---|---|---|
| `app/token-intelligence/page.tsx` | `tokenIntelligenceData` | Now — use `/api/tokens/{addr}` |
| `app/agent-intelligence/page.tsx` | Static JSX | Now — use `/api/agent` |
| `app/trade-details/page.tsx` | `tradeExplainabilityData` | Now (partial) + Phase 8E |
| `app/agent-marketplace/page.tsx` | `agentMarketplaceData` | Phase 8C (BNB AI SDK) |
| `app/news/page.tsx` | `mockResearchArticles` | Now — generate from signals |
| `app/community/page.tsx` (research tab) | `mockResearchArticles` | Now — generate from signals |
| `app/page.tsx` (dashboard KPIs) | Hardcoded values | Now — use `/api/portfolio` |
| `components/chart/trading-chart.tsx` | Broken stub | Phase 8D or remove |

---

## Do Not Touch

These things exist and work. Don't refactor them unless the user explicitly asks:

- `client/lib/db.ts` — the `globalThis.__toroSql` singleton. This is critical for Next.js Turbopack. Do not simplify it.
- `client/app/api/signals/route.ts` — working correctly, tested
- `client/app/api/portfolio/route.ts` — working correctly, tested
- `client/app/api/agent/route.ts` — working correctly, tested
- `packages/db/src/repositories/` — all repositories are complete and tested
- `packages/agent-core/src/` — all engines are complete and tested (just not scheduled)
- The `smart_money_signals` score formula (CTE chain in rebuild script) — took significant effort to calibrate

---

## Current Phase

**Phase 8A.5 — Live Analytics Automation** (in progress)

All previous phases (1–8A) are complete. The pipeline runs end-to-end but the analytics rebuild (wallet_scores → token_metrics → smart_money_signals) is not scheduled — it runs manually. The next concrete task is adding a scheduler inside the BSC indexer process.

See `PHASE_STATUS.md` for what's done, what's next, and what's future.

---

## Known Issues

### TradingChart is broken

`client/components/chart/trading-chart.tsx` calls `addCandlestickSeries()` which doesn't exist in LightweightCharts v5. It renders a blank area. Fastest fix: remove the chart component and show a stats card instead. Correct fix: update to v5 API (`chart.addSeries(LightweightCharts.CandlestickSeries)`).

### Token symbols appear as hex addresses

`smart_money_signals.token_symbol` is stored as a hex address for tokens where the BSC indexer couldn't resolve the symbol from the DEX event. The UI should detect this (check if symbol starts with `0x`) and display a truncated address instead of pretending it's a symbol. CoinMarketCap integration (Phase 8D) will resolve these properly.

### Analytics data goes stale

Without a scheduler, signal data can be 18–30h old after a session. To refresh manually:
```bash
cd packages/db
npx ts-node scripts/rebuild-wallet-scores.ts
npx ts-node scripts/rebuild-token-metrics.ts
npx ts-node scripts/rebuild-smart-money-signals.ts
```

### Decision and execution engines are not running

`trade_recommendations`, `execution_orders`, and `execution_transactions` are empty. The code is complete but has no scheduler. Pages that show "empty state" in these areas are correct, not broken.

---

## Common Tasks — Where to Look

**Add a new API endpoint:**  
Copy `client/app/api/signals/route.ts` as a template. Use `sql` from `@/lib/db`. Add `export const dynamic = 'force-dynamic'`. Add a typed helper to `client/lib/api.ts`.

**Add a new page:**  
Look at `client/app/markets/page.tsx` for a client component with `useEffect` + fetch, or `client/app/execution-center/page.tsx` for a server component with direct `await fetchX()`.

**Add a new analytics signal:**  
Edit `packages/db/src/repositories/smart-money-signals.ts` (the CTE chain SQL). Run the rebuild script to test. The schema uses `ON CONFLICT (token_address) DO UPDATE` — it's idempotent.

**Run the decision engine once:**  
```bash
cd packages/agent-core
npx ts-node src/decision/decision-engine.ts
```

**Run the execution engine against existing recommendations:**  
```bash
cd packages/agent-core
npx ts-node src/execution/execution-engine.ts
```

**Re-check DB connection:**  
Create a route at `/api/test` that runs `SELECT 1`. If it fails, check `client/.env.local`. The URL must contain `xjqdytwhybgisgycqueo` (ap-southeast-1 project).

---

## Environment Variables

`client/.env.local`:
```
DATABASE_URL="postgresql://postgres.xjqdytwhybgisgycqueo:{password}@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

Do not commit this file. The password is in `packages/.env` under the same key — both should match.

---

## AGENTS.md Instruction

The root `AGENTS.md` says: "This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code."

This means: do not assume standard Next.js 14 App Router conventions apply. Check the actual version behavior. Key differences in this version:
- Route Handlers use `NextRequest`/`NextResponse` from `next/server`
- Server components can be async functions that `await` data directly
- `force-dynamic` is required to opt out of static rendering for data-fetching routes
- Turbopack is the default bundler in dev — module isolation per route bundle is a real concern (hence `globalThis.__toroSql`)
