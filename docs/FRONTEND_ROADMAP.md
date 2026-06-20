# Frontend Roadmap — Toru

**Polish priorities, ordered by impact per page.**  
This document covers work to do **now**, using data already in the database. Phase 8B–8E items are not included — they require external integrations.

---

## Priority 1 — Dashboard (`/`)

The entry point. Currently half-real: signals and activity are live, but portfolio KPIs and the agent status banner are hardcoded.

### Tasks

**1a. Wire portfolio KPIs to real data**

Replace hardcoded numbers with `fetchPortfolio()` output.

- "Total Portfolio Value" → `portfolio.totalValue`
- "Today's P&L" → `portfolio.rollingLossPct24h` (sign-inverted: negative = loss)
- "Open Positions" → `portfolio.openPositions`
- "Drawdown" → `portfolio.drawdownPct`
- File: `client/app/page.tsx`

**1b. Dynamic agent status banner**

The banner currently shows a hardcoded message. Replace with:
- If `portfolio.openPositions > 0`: "Agent is managing {n} active positions"
- If `portfolio.drawdownPct > 15`: "Agent is in risk-reduction mode"
- Default: "Agent is monitoring {portfolio.monitoringTokens} signals"

**1c. Remove TradingChart or replace with static placeholder**

`components/chart/trading-chart.tsx` uses `addCandlestickSeries()` which is no longer in the LightweightCharts v5 API (it's `addCandlestickSeries` → `addSeries` with SeriesType). Two options:
- Quick fix: Replace chart with a stats summary card using portfolio data
- Correct fix: Update to LightweightCharts v5 API — `chart.addSeries(LightweightCharts.CandlestickSeries)` — still requires OHLCV data

**Estimated effort:** 2–3 hours

---

## Priority 2 — Token Intelligence (`/token-intelligence`)

Currently fully mocked. The live `/api/tokens/{address}` endpoint returns everything this page needs.

### Tasks

**2a. Replace mock import with real data**

```typescript
// Remove:
import { tokenIntelligenceData } from '@/lib/mock-data-advanced'

// Replace with:
import { fetchSignals } from '@/lib/api'
const { signals } = await fetchSignals({ signalTier: 'STRONG', limit: 1 })
const topSignal = signals[0]
if (topSignal) {
  const { token } = await fetchToken(topSignal.tokenAddress)
}
```

**2b. Map real fields to UI components**

| UI Field | Real Source |
|---|---|
| Token name | `token.tokenSymbol` |
| Score | `token.toroScore` |
| Signal tier | `token.signalTier` |
| Smart wallets entering | `token.smartMoneyActivity.walletsEntering` |
| Net flow | `token.smartMoneyActivity.netFlow` |
| Quality holders | `token.qualityHolderCount` |
| Narrative | `token.narrative` |
| Score breakdown bars | `token.scoreBreakdown.*` |

**2c. Handle no-data state**

If signals are empty (engine not running), show a clear empty state instead of crashing.

**Estimated effort:** 2–4 hours

---

## Priority 3 — Agent Intelligence (`/agent-intelligence`)

Currently a static JSX placeholder — no data, no API call.

### Tasks

**3a. Wire to `/api/agent`**

```typescript
import { fetchAgent } from '@/lib/api'
const { status, decisions, recommendations } = await fetchAgent()
```

**3b. Render real decisions feed**

`decisions[]` contains recent trade decisions with action, token, reasons, confidence, and timestamps. Map each item to the existing card layout. Show "No recent decisions — decision engine is not running" if empty.

**3c. Render real recommendations**

`recommendations[]` contains PENDING items (currently empty, but will populate when decision engine runs). Show each with: action badge, token, confidence bar, stop-loss, take-profit, allocation.

**3d. Agent reasoning panel**

For each decision, `reasons[]` is a text array. Render them as a bulleted list inside the reasoning panel. The `blockers[]` array shows why a signal was rejected — render these with a different color.

**Estimated effort:** 3–5 hours

---

## Priority 4 — Trade Details (`/trade-details`)

Currently mocked with `tradeExplainabilityData`. Should show real explanation for the most recent executed trade recommendation.

### Tasks

**4a. Fetch most recent executed recommendation**

```typescript
// Use /api/agent decisions array, filter for Executed status
const { decisions } = await fetchAgent()
const latestTrade = decisions.find(d => d.status === 'Executed')
```

**4b. Map to page layout**

| UI Section | Data Source |
|---|---|
| Token + action header | `decision.token`, `decision.action` |
| Confidence gauge | `decision.confidence` |
| Allocation | `decision.allocation` |
| Reasoning steps | `decision.reasons[]` |
| Signal tier | From `/api/signals?search={token}` |
| Smart wallet context | From `/api/tokens/{address}` |

**4c. Handle empty state gracefully**

If no executed trades exist yet, show a clear message explaining that trades will appear here once the execution engine places its first order.

**Estimated effort:** 3–5 hours

---

## Priority 5 — Community (`/community`) Research Tab

The feed and discussions tabs are already wired. Only the research tab uses mock data.

### Tasks

**5a. Generate research content from signals**

Since no CMS or CMC integration exists yet, generate pseudo-articles from signal data:

```typescript
const { signals } = await fetchSignals({ signalTier: 'STRONG', limit: 5 })
// Each STRONG signal becomes a "research article":
const articles = signals.map(s => ({
  title: `Smart Money is Accumulating ${s.token}`,
  body: `${s.smartWallets} quality wallets entered in the last 4h. Score: ${s.score}.`,
  timestamp: s.computedAt,
}))
```

This removes the last `mockResearchArticles` import from this page.

**5b. Fix Discussions tab**

Currently shows a static token list. Replace with the top 5 signals from `/api/signals`. Each becomes a "discussion thread" for that token.

**Estimated effort:** 1–2 hours

---

## Priority 6 — News (`/news`)

Fully mocked. Short path to removing the mock: generate "news" from signals and activity events.

### Tasks

**6a. Replace `mockResearchArticles` with generated content**

Same approach as Community research tab (Priority 5a). Fetch top STRONG/MODERATE signals and format each as a news card. Signal `narrative` field is the article body — it's already written by the signals engine.

**Estimated effort:** 1 hour

---

## Priority 7 — Token Detail (`/token/[symbol]`) Chart

The page is mostly real. The chart component is broken.

### Tasks

**7a. Fix TradingChart component**

`addCandlestickSeries` is not a method in LightweightCharts v5. Options:

Option A (fastest): Remove the chart, show signal score visualization instead  
Option B: Update to v5 API — `chart.addSeries(LightweightCharts.CandlestickSeries)` then call `series.setData()`  
Option C (correct but requires data): Keep chart, add OHLCV data source (Phase 8D — CMC)

Recommendation: Option A now, Option C in Phase 8D.

**7b. Resolve hex token addresses**

When `tokenSymbol` is a hex address (e.g. `0xbb4cdb...`), show a truncated address badge instead. Add a `resolvedSymbol` utility that checks if a string looks like an address and formats it as `0xbb4c...` in that case.

**Estimated effort:** 1–2 hours

---

## Priority 8 — Dashboard Agent Status (real-time feel)

Small, high-impact visual improvements to the existing dashboard.

### Tasks

**8a. Show signal freshness**

On the Signals Tab and Top Opportunities cards, show relative time since `computedAt`: "Updated 6 minutes ago". Use a client-side `timeAgo` utility.

**8b. Show wallet count in Live Intelligence header**

`/api/agent` returns `status.trackedWallets` — show "Monitoring 1,710 wallets" in the header of the Live Intelligence card.

**8c. Show signal tier distribution on Markets page**

Show a small summary bar at the top of the table: "6 STRONG · 15 MODERATE · 25 WEAK" to give context before users filter.

**Estimated effort:** 1–2 hours

---

## Won't Do Until External Integration

These items are intentionally deferred — they require data sources that don't exist in the DB today:

| Feature | Dependency |
|---|---|
| Price charts (OHLCV) | CMC API or Binance WebSocket (Phase 8D) |
| 24h price change % | CMC or DEX price history |
| Market cap, volume | CMC metadata |
| Onboarding wallet creation | TWAK (Phase 8B) |
| Agent Marketplace data | BNB AI SDK (Phase 8C) |
| Realtime signal updates | SSE/WebSocket + scheduler (Phase 8A.5) |
| News articles | CMC news feed (Phase 8D) |
| Token logo images | CMC logo API (Phase 8D) |
| On-chain agent identity display | BNB AI SDK (Phase 8C) |
