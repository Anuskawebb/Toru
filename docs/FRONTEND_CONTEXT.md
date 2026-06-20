# Frontend Context — Toru

**For frontend developers, AI coding agents, and new Claude sessions.**

Directory: `client/`  
Framework: Next.js 16.2.6, App Router, TypeScript, Tailwind CSS  
Dev server: `pnpm dev --port 3001` (run from `client/`)

---

## Quick Start

```bash
cd client
pnpm install
# Copy env (ask team for values)
cp .env.example .env.local
# or use the real DB (ap-southeast-1 Supabase):
echo 'DATABASE_URL="postgresql://postgres.xjqdytwhybgisgycqueo:..."' > .env.local
pnpm dev --port 3001
```

The API layer runs inside Next.js — no separate backend to start.

---

## Existing Pages

### Dashboard (`/`) — `app/page.tsx`

**Purpose:** Overview of portfolio, signals, and agent activity. Entry point for returning users.

**Status: PARTIAL**

| Widget | Status | Source |
|---|---|---|
| Top Opportunities (bottom card) | REAL | `/api/signals` |
| Live Intelligence (bottom card) | REAL | `/api/activity` |
| Signals Tab (sidebar) | REAL | `/api/signals` |
| Portfolio value KPIs | MOCK | Hardcoded |
| Chart | MOCK | No price data |
| Agent status banner | MOCK | Hardcoded |

**API Endpoints:** `/api/signals`, `/api/activity`

---

### Markets (`/markets`) — `app/markets/page.tsx`

**Purpose:** Browse all tracked tokens with smart-money scores, filter by tier and risk.

**Status: REAL**

| Widget | Status | Source |
|---|---|---|
| Token signal table | REAL | `/api/signals` |
| Search & filter | REAL | Client-side on API response |
| Signal tier badges | REAL | Derived from `signal_tier` |
| Score bars | REAL | `accumulation_score` |
| 24h change | MOCK | Not in DB (no price history) |

**API Endpoints:** `GET /api/signals?limit=50&search=&signalTier=`

**Notes:**
- Token symbols may display as hex addresses for tokens not yet resolved by metadata service
- `change24h` field is always 0 — requires CMC price history (Phase 8D)

---

### Portfolio (`/portfolio`) — `app/portfolio/page.tsx`

**Purpose:** User's portfolio overview — total value, open positions, P&L, recent activity.

**Status: REAL**

| Widget | Status | Source |
|---|---|---|
| Total portfolio value | REAL | `/api/portfolio` → `portfolio_state` |
| Today's P&L | REAL | `rolling_loss_pct_24h` (sign-inverted for display) |
| Open positions count | REAL | `open_positions` from portfolio_state |
| Drawdown | REAL | `drawdown_pct` |
| Holdings table | REAL | `/api/positions?status=OPEN` |
| Recent activity | REAL | `/api/portfolio` → execution_orders |
| Price chart | MOCK | No price history in DB |

**API Endpoints:** `GET /api/portfolio`, `GET /api/positions?status=OPEN`

---

### Agent (`/agent`) — `app/agent/page.tsx`

**Purpose:** Agent dashboard — monitoring stats, recent decisions, active recommendations.

**Status: REAL**

| Widget | Status | Source |
|---|---|---|
| Monitoring tokens count | REAL | COUNT(smart_money_signals) |
| Tracked wallets | REAL | COUNT(wallet_scores) |
| Signals generated | REAL | COUNT(smart_money_signals) |
| Active recommendations | REAL | COUNT(trade_recommendations WHERE PENDING) |
| Portfolio USD | REAL | portfolio_state |
| Drawdown | REAL | portfolio_state |
| Recent decisions feed | REAL | trade_recommendations (empty — engine not running) |
| Recommendations table | REAL | trade_recommendations PENDING (empty today) |
| Agent status badge | HARDCODED | Always shows "Active" |

**API Endpoints:** `GET /api/agent`

**Notes:** Decision feed and recommendations table are wired correctly but empty because the decision engine is not scheduled to run. Run `packages/agent-core/src/decision/decision-engine.ts` manually to populate.

---

### Execution Center (`/execution-center`) — `app/execution-center/page.tsx`

**Purpose:** View and monitor trade execution queue, transaction history, and execution stats.

**Status: REAL** (data correct — all zeros because execution engine not running)

| Widget | Status | Source |
|---|---|---|
| Orders processed | REAL | COUNT(execution_orders) |
| Orders filled / failed | REAL | Filtered counts |
| Success rate | REAL | Computed from counts |
| Open positions | REAL | portfolio_state |
| Execution queue table | REAL | execution_orders LEFT JOIN execution_transactions |
| Portfolio USD | REAL | portfolio_state |

**API Endpoints:** `GET /api/execution-center`

**Note:** This is an async server component with `force-dynamic`. All stats show real values — currently all zeros pending TWAK integration.

---

### Assets (`/assets`) — `app/assets/page.tsx`

**Purpose:** Current open positions held by the agent.

**Status: REAL**

| Widget | Status | Source |
|---|---|---|
| Open positions table | REAL | `/api/positions?status=OPEN` |
| Total value | REAL | Sum of positionSizeUsd |
| Total P&L | REAL | Sum of unrealizedPnlUsd |
| Best performer | REAL | Max unrealizedPnlPct |

**API Endpoints:** `GET /api/positions?status=OPEN`

**Notes:** Currently shows empty state (0 open positions) because the execution engine hasn't placed trades.

---

### Community (`/community`) — `app/community/page.tsx`

**Purpose:** Activity feed, discussion threads, research articles.

**Status: PARTIAL**

| Tab | Status | Source |
|---|---|---|
| Feed tab | REAL | `/api/activity` — merged timeline |
| Discussions tab | MOCK | Static token list |
| Research tab | MOCK | `mockResearchArticles` from lib/mock-data |

**API Endpoints:** `GET /api/activity?limit=10`

---

### Community Feed (`/community-feed`) — `app/community-feed/page.tsx`

**Purpose:** Twitter-style intelligence feed. Events from signals, executions, and recommendations.

**Status: REAL**

| Widget | Status | Source |
|---|---|---|
| Main feed | REAL | `/api/activity` (20 events) |
| Trending Tokens sidebar | REAL | `/api/signals` (top 4 by score) |
| Trending Topics | MOCK | Static hashtag list |
| Top Contributors | MOCK | Static names |
| Community Stats | MOCK | Hardcoded numbers |

**API Endpoints:** `GET /api/activity?limit=20`, `GET /api/signals?limit=4`

---

### Token Detail (`/token/[symbol]`) — `app/token/[symbol]/page.tsx`

**Purpose:** Per-token intelligence page — score breakdown, smart money activity, agent recommendation.

**Status: PARTIAL**

| Widget | Status | Source |
|---|---|---|
| Score + tier | REAL | `/api/signals?search={symbol}` + `/api/tokens/{address}` |
| Score breakdown bars | REAL | Computed from signal fields |
| Smart Wallets Accumulating | REAL | `quality_holder_count` |
| Net Accumulation flow | REAL | `net_accumulation_flow` |
| Agent recommendation | REAL | Derived from signal_tier |
| Price + Market Cap | MOCK | `mockTokenDetail` fallback |
| 24h Change | MOCK | No price history |
| Volume 24h | MOCK | No price history |
| TradingChart | BROKEN | `addCandlestickSeries` API mismatch |

**API Endpoints:** `GET /api/signals?search={symbol}&limit=1`, `GET /api/tokens/{address}`

---

### Token Intelligence (`/token-intelligence`) — `app/token-intelligence/page.tsx`

**Purpose:** Deep analysis view for a specific token (hardcoded to one token currently).

**Status: MOCK**

| Widget | Status | Source |
|---|---|---|
| All content | MOCK | `tokenIntelligenceData` from lib/mock-data-advanced |

**API Gap:** Should call `GET /api/tokens/{address}` for the top STRONG signal token. Replace `tokenIntelligenceData` with real data. See `fetchToken()` in `lib/api.ts`.

---

### Agent Intelligence (`/agent-intelligence`) — `app/agent-intelligence/page.tsx`

**Purpose:** Agent reasoning display — how decisions were made.

**Status: STATIC** (no mock, no API — structural placeholder)

| Widget | Status |
|---|---|
| All content | Static JSX, no data |

**API Gap:** Should call `GET /api/agent` for decisions and recommendations.

---

### Agent Marketplace (`/agent-marketplace`) — `app/agent-marketplace/page.tsx`

**Purpose:** Browse available agent strategies.

**Status: MOCK**

| Widget | Status | Source |
|---|---|---|
| Agent cards | MOCK | `agentMarketplaceData` from lib/mock-data-advanced |

**API Gap:** No DB equivalent exists yet. Phase 8C (BNB AI Agent SDK) will provide this.

---

### Trade Details (`/trade-details`) — `app/trade-details/page.tsx`

**Purpose:** Explainability view for a specific trade decision.

**Status: MOCK**

| Widget | Status | Source |
|---|---|---|
| All trade reasoning | MOCK | `tradeExplainabilityData` from lib/mock-data-advanced |

**API Gap:** Should fetch from `trade_recommendations.reasons[]` + signal data. Phase 8E (Explainability).

---

### News (`/news`) — `app/news/page.tsx`

**Purpose:** Research articles and market news.

**Status: MOCK**

| Widget | Status | Source |
|---|---|---|
| Articles | MOCK | `mockResearchArticles` from lib/mock-data |

**API Gap:** No equivalent in DB. Consider CMC news feed (Phase 8D).

---

### Onboarding (`/onboarding/step-1` through `step-6`) — `app/onboarding/`

**Purpose:** Multi-step agent creation wizard.

**Status: STATIC** (UI complete, no backend wiring)

Steps: Welcome → Strategy → Risk → Review → Fund Wallet → Activate

**API Gap:** Step 5 (Fund Wallet) needs TWAK wallet address. Steps need to persist choices to DB.

---

### Settings (`/settings`) — `app/settings/page.tsx`

**Purpose:** Agent configuration, notifications, wallet management.

**Status: STATIC** (no backend wiring)

---

### Airdrops, NFTs (`/airdrops`, `/nfts`)

**Status: STATIC** — placeholder pages, no data requirements defined.

---

## Mock Data Inventory

| Component | File | Mock Source | Replacement API |
|---|---|---|---|
| Markets token list | `app/markets/page.tsx` | ~~mockSignals~~ removed | `GET /api/signals` ✅ |
| Portfolio overview | `app/portfolio/page.tsx` | ~~mockPortfolio~~ removed | `GET /api/portfolio` ✅ |
| Agent stats | `app/agent/page.tsx` | ~~mockAgent~~ removed | `GET /api/agent` ✅ |
| Execution queue | `app/execution-center/page.tsx` | removed | `GET /api/execution-center` ✅ |
| Assets / positions | `app/assets/page.tsx` | removed | `GET /api/positions` ✅ |
| Community feed | `app/community/page.tsx` | removed | `GET /api/activity` ✅ |
| Trending tokens | `app/community-feed/page.tsx` | removed | `GET /api/signals` ✅ |
| Token detail | `app/token/[symbol]/page.tsx` | `mockTokenDetail` (price/mcap) | CMC API (Phase 8D) |
| Token intelligence page | `app/token-intelligence/page.tsx` | `tokenIntelligenceData` | `GET /api/tokens/{addr}` |
| Agent marketplace | `app/agent-marketplace/page.tsx` | `agentMarketplaceData` | BNB AI SDK (Phase 8C) |
| Trade details | `app/trade-details/page.tsx` | `tradeExplainabilityData` | `trade_recommendations` |
| News / Research | `app/news/page.tsx`, `community/page.tsx` | `mockResearchArticles` | CMC news (Phase 8D) |
| Top opportunities | `components/bottom-cards/top-opportunities.tsx` | removed | `GET /api/signals` ✅ |
| Live intelligence | `components/bottom-cards/live-intelligence.tsx` | removed | `GET /api/activity` ✅ |
| Signals tab | `components/tabs/signals-tab.tsx` | removed | `GET /api/signals` ✅ |
| TradingChart | `components/chart/trading-chart.tsx` | broken stub | No data source (needs OHLCV) |
| Dashboard KPIs | `app/page.tsx` | hardcoded numbers | `GET /api/portfolio` |
| Agent status badge | `app/agent/page.tsx` | hardcoded "Active" | `portfolio_state` |

---

## Realtime Candidates

These tables change frequently and are strong candidates for WebSocket or Server-Sent Events (SSE) once the pipeline is fully live:

| Table | Update Frequency | Frontend Use Case |
|---|---|---|
| `smart_money_signals` | Every 15–30 min (analytics rebuild) | Live signal scores on Markets page |
| `trade_recommendations` | On-demand (decision engine) | Real-time agent decision feed |
| `execution_orders` | On-demand (execution engine) | Execution queue updates |
| `agent_positions` | After each execution | Portfolio holdings |
| `portfolio_state` | After each position change | Portfolio value widget |

**Implementation approach:** Add SSE endpoint at `GET /api/stream` that pushes events from a Supabase Realtime subscription on these tables. No code exists for this yet.

---

## Component Map

```
client/
├── app/
│   ├── page.tsx                  Dashboard (PARTIAL)
│   ├── markets/page.tsx          Markets (REAL)
│   ├── portfolio/page.tsx        Portfolio (REAL)
│   ├── agent/page.tsx            Agent (REAL)
│   ├── execution-center/page.tsx Execution Center (REAL)
│   ├── assets/page.tsx           Assets (REAL)
│   ├── community/page.tsx        Community (PARTIAL)
│   ├── community-feed/page.tsx   Community Feed (REAL)
│   ├── token/[symbol]/page.tsx   Token Detail (PARTIAL)
│   ├── token-intelligence/page.tsx  Token Intelligence (MOCK)
│   ├── agent-intelligence/page.tsx  Agent Intelligence (STATIC)
│   ├── agent-marketplace/page.tsx   Agent Marketplace (MOCK)
│   ├── trade-details/page.tsx    Trade Details (MOCK)
│   ├── news/page.tsx             News (MOCK)
│   ├── onboarding/               Onboarding wizard (STATIC)
│   └── settings/page.tsx         Settings (STATIC)
├── components/
│   ├── navigation/top-nav.tsx
│   ├── navigation/sidebar.tsx
│   ├── bottom-cards/
│   │   ├── top-opportunities.tsx  (REAL — /api/signals)
│   │   └── live-intelligence.tsx  (REAL — /api/activity)
│   ├── tabs/
│   │   ├── signals-tab.tsx        (REAL — /api/signals)
│   │   └── feed-tab.tsx           (STATIC)
│   ├── chart/trading-chart.tsx    (BROKEN — API mismatch)
│   └── shared/
├── lib/
│   ├── db.ts          postgres.js singleton (globalThis cache)
│   ├── api.ts         typed fetch helpers + interfaces
│   └── mock-data.ts   remaining mock data (research articles)
└── app/api/           Route handlers — see API_REFERENCE.md
```
