# Toro Frontend → API Mapping

## Overview

All routes are Next.js Route Handlers at `client/app/api/*`. They query the Toro PostgreSQL database directly via `postgres.js`. No separate backend service.

The fetch helper lives at `client/lib/api.ts` — server components call it via absolute URL (`NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'`); client components use relative `/api/...` paths.

---

## Full Page Mapping

### 1. Dashboard (`/`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| `TopOpportunities` | hardcoded array (BONK/DOGE/SHIB/PEPE) | `smart_money_signals` | `GET /api/signals?limit=4` | **Wired** |
| `LiveIntelligence` | hardcoded array (6 items) | `trade_recommendations`, `execution_transactions` | `GET /api/activity?limit=6` | **Wired** |
| `Sidebar/SignalsTab` | hardcoded array (5 items) | `smart_money_signals` | `GET /api/signals?limit=8` | **Wired** |
| `Sidebar/FeedTab` | hardcoded array | `trade_recommendations`, `execution_transactions` | `GET /api/activity` | Static (no change needed) |
| `Sidebar/WatchlistTab` | hardcoded price ticks | None | Static | Unchanged |

---

### 2. Markets (`/markets`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| Signal table (`SignalTable`) | `mockSignals` from `lib/mock-data` | `smart_money_signals` | `GET /api/signals?search=&riskTier=&signalTier=` | **Wired** |
| Search/filter logic | filters on `mockSignals` | — | Filters run client-side on API response | **Wired** |
| Right panel preview | `mockSignals[0]` | — | Uses selected item from API response | **Wired** |

---

### 3. Portfolio (`/portfolio`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| Portfolio Value | `mockPortfolio.totalValue` | `portfolio_state.portfolio_usd` | `GET /api/portfolio` | **Wired** |
| Today's PnL | `mockPortfolio.pnlToday` | `portfolio_state.rolling_loss_pct_24h` (negated) | `GET /api/portfolio` | **Wired** |
| Weekly PnL | `mockPortfolio.pnlWeek` | None (no weekly field in DB) | Static fallback (0) | Partial |
| Monthly PnL | `mockPortfolio.pnlMonth` | None (no monthly field in DB) | Static fallback (0) | Partial |
| Max Drawdown | `mockPortfolio.drawdown` | `portfolio_state.drawdown_pct` | `GET /api/portfolio` | **Wired** |
| Asset Allocation bars | hardcoded (ETH/Stablecoins/etc.) | `agent_positions.position_size_pct` | Static (positions don't map cleanly) | Static |
| Risk Allocation bars | hardcoded (Low/Med/High) | None | Static | Static |
| Exposure row | hardcoded values | `portfolio_state.*` | `GET /api/portfolio` | **Wired** |
| Holdings table | `mockPortfolio.holdings` | `agent_positions` | `GET /api/positions?status=OPEN` | **Wired** |
| Recent Activity | `mockPortfolioActivity` | `execution_orders` | `GET /api/portfolio` (activity field) | **Wired** |

---

### 4. Agent (`/agent`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| Monitoring Tokens card | `agentStatus.monitoringTokens` | `COUNT(smart_money_signals)` | `GET /api/agent` | **Wired** |
| Tracked Wallets card | `agentStatus.trackedWallets` | `COUNT(wallet_scores)` | `GET /api/agent` | **Wired** |
| Signals Generated card | `agentStatus.signalsGenerated` | `COUNT(smart_money_signals)` | `GET /api/agent` | **Wired** |
| Recommendations card | `agentStatus.recommendationsActive` | `COUNT(PENDING trade_recommendations)` | `GET /api/agent` | **Wired** |
| System Status card | `agentStatus.status` | Derived (`'Active'`) | `GET /api/agent` | **Wired** |
| Latest Decisions feed | `mockAgentDecisions` | `trade_recommendations` | `GET /api/agent` (decisions) | **Wired** |
| Risk Engine Monitor | hardcoded metrics | `portfolio_state.drawdown_pct` etc. | Static (no per-metric DB fields) | Static |
| Active Recommendations table | `mockRecommendations` | `trade_recommendations WHERE status='PENDING'` | `GET /api/agent` (recommendations) | **Wired** |
| Current Opportunity Analysis | hardcoded CAKE narrative | None | Static | Static |

---

### 5. Execution Center (`/execution-center`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| Orders Processed card | `487` hardcoded | `COUNT(execution_orders)` | `GET /api/execution-center` | **Wired** |
| Filled Orders card | `462` hardcoded | `COUNT WHERE status='FILLED'` | `GET /api/execution-center` | **Wired** |
| Failed Orders card | `8` hardcoded | `COUNT WHERE status='FAILED'` | `GET /api/execution-center` | **Wired** |
| Success Rate card | `94.9%` hardcoded | `filled/total*100` | `GET /api/execution-center` | **Wired** |
| Avg Time card | `2.3s` hardcoded | None | Static | Static |
| Open Positions card | `5` hardcoded | `portfolio_state.open_positions` | `GET /api/execution-center` | **Wired** |
| Execution Queue orders | 4 hardcoded rows | `execution_orders LEFT JOIN execution_transactions` | `GET /api/execution-center` (queue) | **Wired** |
| System Health | hardcoded statuses | None | Static | Static |
| Execution Timeline | hardcoded events | `execution_transactions` | Static (timeline not wired) | Static |
| Execution Logs | hardcoded log lines | None | Static | Static |

---

### 6. Token Detail (`/token/[symbol]`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| Token name/price | `mockTokenDetail` (always CAKE) | None (no price in DB) | Static | Static |
| Signal Score | `token.signalScore` | `smart_money_signals.accumulation_score` | `GET /api/signals?search={symbol}&limit=1` then `GET /api/tokens/{address}` | **Wired** |
| Risk / Signal status | `token.riskTier`, `token.signalStatus` | `signal_tier` | See above | **Wired** |
| Confidence | `token.confidence` | `avg_quality_rank_score` | See above | **Wired** |
| Smart Wallets Accumulating | `token.smartWalletsAccumulating` | `quality_holder_count` | See above | **Wired** |
| Smart Wallets Selling | `token.smartWalletsSelling` | `quality_exit_count_4h` | See above | Partial |
| 24H Inflow / Outflow | `token.flow24hInflow/Outflow` | None (only net flow in DB) | Static fallback | Static |
| Net Accumulation | `token.netAccumulation` | `net_accumulation_flow` | `GET /api/tokens/{address}` | **Wired** |
| Signal Composition bars | hardcoded 5 values | `smart_money_signals` score breakdown | `GET /api/tokens/{address}` (scoreBreakdown) | **Wired** |

---

### 7. Assets (`/assets`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| Total Value | computed from `mockAssets` | `SUM(position_size_usd)` | `GET /api/positions?status=OPEN` | **Wired** |
| Total PnL | computed from `mockAssets` | `SUM(unrealized_pnl_usd)` | `GET /api/positions?status=OPEN` | **Wired** |
| Best Performer | max `pnl` from `mockAssets` | max `unrealized_pnl_usd` | `GET /api/positions?status=OPEN` | **Wired** |
| Asset cards grid | `mockAssets` | `agent_positions WHERE status='OPEN'` | `GET /api/positions?status=OPEN` | **Wired** |

---

### 8. Community (`/community`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| Feed tab posts | `mockCommunityPosts` | `trade_recommendations`, `execution_transactions` | `GET /api/activity?limit=10` | **Wired** |
| Discussions tab | 6 hardcoded token names | None | Static | Static |
| Research tab featured | hardcoded | None | Static | Static |
| Research tab articles | `mockResearchArticles` | None | Static (no research table) | Static |

---

### 9. Community Feed (`/community-feed`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| Post feed (center column) | `communityPosts` from `mock-data-advanced` | `trade_recommendations`, `execution_transactions` | `GET /api/activity?limit=20` | **Wired** |
| Trending Tokens sidebar | hardcoded (CAKE/ETH/SOL/BNB) | `smart_money_signals` | `GET /api/signals?limit=4` | **Wired** |
| Trending Topics sidebar | hardcoded hashtags | None | Static | Static |
| Top Contributors sidebar | hardcoded names | None | Static | Static |
| Most Discussed (right) | hardcoded | None | Static | Static |
| Community Stats (right) | hardcoded counts | None | Static | Static |

---

### 10. Token Intelligence (`/token-intelligence`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| Toro Score gauge | `tokenIntelligenceData.toroScore` | `smart_money_signals.accumulation_score` | `GET /api/tokens/{address}` | Pending |
| Score breakdown bars | `tokenIntelligenceData.scoreBreakdown` | `smart_money_signals.*` | `GET /api/tokens/{address}` | Pending |
| Smart money activity | `tokenIntelligenceData.smartMoneyActivity` | `smart_money_signals.*` | `GET /api/tokens/{address}` | Pending |
| Recent transactions table | `tokenIntelligenceData.recentTransactions` | `execution_orders` | `GET /api/tokens/{address}/activity` | Pending |

---

### 11. Agent Intelligence (`/agent-intelligence`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| Agent summary cards | `agentStatus`, `agentMarketplaceData[0]` | `smart_money_signals`, `wallet_scores`, `portfolio_state` | `GET /api/agent` | Pending |
| Decision timeline | `mockAgentDecisions` | `trade_recommendations` | `GET /api/agent` (decisions) | Pending |
| Open positions | `mockPortfolio.holdings` | `agent_positions` | `GET /api/positions?status=OPEN` | Pending |

---

### 12. Trade Details (`/trade-details`)

| Component | Current Mock Data | DB Source | API Endpoint | Status |
|---|---|---|---|---|
| Trade header | `tradeExplainabilityData.trade` | `execution_orders` | `GET /api/orders/{id}` | Pending |
| Reasoning tree | `tradeExplainabilityData.reasoning` | `trade_recommendations.reasons` | `GET /api/orders/{id}` | Pending |
| Execution timeline | `tradeExplainabilityData.executionTimeline` | `execution_transactions` | `GET /api/executions?orderId={id}` | Pending |
| Transaction details | `tradeExplainabilityData.transactionDetails` | `execution_transactions` | `GET /api/executions?orderId={id}` | Pending |

---

### 13. Static / No DB Equivalent Pages

| Page | Mock Data Source | Notes |
|---|---|---|
| `/agent-marketplace` | `agentMarketplaceData` | No DB table for agent marketplace listings |
| `/news` | Hardcoded articles | No news feed DB table |
| `/nfts` | Hardcoded | No NFT DB table |
| `/airdrops` | Hardcoded | No airdrop DB table |
| `/settings` | No data | User preferences only |
| `/onboarding/*` | Form state | No DB queries |

---

## API Endpoint Contracts

### `GET /api/signals`
**Query params:** `limit` (default 20), `offset` (default 0), `search`, `riskTier` (Low/Medium/High), `signalTier` (STRONG/MODERATE/WEAK)

**Response:**
```ts
{
  signals: Array<{
    tokenAddress: string
    token: string          // tokenSymbol
    score: number          // accumulationScore rounded
    risk: 'Low' | 'Medium' | 'High'
    signal: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell'
    confidence: number     // 0-100
    smartWallets: number   // qualityHolderCount
    trend: 'Increasing' | 'Stable' | 'Decreasing'
    change24h: number      // qualityHolderChange24h
    netAccumulationFlow: number
    computedAt: string
  }>
  total: number
  meta: { timestamp: string }
}
```

**Source table:** `smart_money_signals`

---

### `GET /api/portfolio`
**Response:**
```ts
{
  portfolio: {
    totalValue: number         // portfolio_usd
    stablecoinUsd: number
    tokenExposureUsd: number
    buyingPowerUsd: number
    drawdownPct: number
    rollingLossPct24h: number
    cashReservePct: number
    totalExposurePct: number
    openRiskPct: number
    openPositions: number
    unrealizedPnlUsd: number   // computed from agent_positions
    agentWallet: string
    updatedAt: string
  } | null
  activity: Array<{
    action: string
    token: string
    amountUsd: number
    entryPriceUsd: number
    createdAt: string
  }>
  meta: { timestamp: string }
}
```

**Source tables:** `portfolio_state`, `execution_orders`

---

### `GET /api/positions`
**Query params:** `status` (OPEN|CLOSED, default OPEN), `limit`, `offset`

**Response:**
```ts
{
  positions: Array<{
    id: string
    token: string
    positionSizeUsd: number
    positionSizePct: number
    unrealizedPnlPct: number
    unrealizedPnlUsd: number
    entryPriceUsd: number
    currentPriceUsd: number
    stopLossPct: number
    takeProfitPct: number
    status: string
    openedAt: string
  }>
  total: number
  meta: { timestamp: string }
}
```

**Source table:** `agent_positions`

---

### `GET /api/agent`
**Response:**
```ts
{
  status: {
    monitoringTokens: number
    trackedWallets: number
    signalsGenerated: number
    recommendationsActive: number
    agentStatus: string      // always 'Active'
    portfolioUsd: number | null
  }
  decisions: Array<{
    action: string
    token: string
    reason: string
    confidence: number
    allocation: string
    status: string
    decidedAt: string
  }>
  recommendations: Array<{
    token: string
    action: string
    risk: string
    allocation: string
    stopLoss: string
    takeProfit: string
    confidence: number
    status: string
  }>
  meta: { timestamp: string }
}
```

**Source tables:** `smart_money_signals`, `wallet_scores`, `trade_recommendations`, `portfolio_state`

---

### `GET /api/execution-center`
**Response:**
```ts
{
  stats: {
    ordersProcessed: number
    ordersFilled: number
    ordersFailed: number
    ordersPending: number
    ordersProcessing: number
    successRate: number         // filled/processed * 100
    openPositions: number
    portfolioUsd: number
    drawdownPct: number
    openRiskPct: number
  }
  queue: Array<{
    id: string
    token: string
    action: string
    amountUsd: number
    status: string
    txHash: string | null
    txStatus: string | null
    createdAt: string
  }>
  meta: { timestamp: string }
}
```

**Source tables:** `execution_orders`, `execution_transactions`, `portfolio_state`

---

### `GET /api/tokens/[address]`
**Response:**
```ts
{
  token: {
    tokenAddress: string
    tokenSymbol: string
    toroScore: number
    signalTier: string
    scoreBreakdown: {
      wallet: number
      flow: number
      smartMoney: number
      liquidity: number
      risk: number
    }
    smartMoneyActivity: {
      walletsEntering: number
      walletsExiting: number
      netFlow: number
      convictionScore: number
    }
    qualityHolderCount: number
    narrative: string
    trendDirection: string
    computedAt: string
  } | null
  meta: { timestamp: string }
}
```

**Source table:** `smart_money_signals`

---

### `GET /api/activity`
**Query params:** `type` (all|trade|signal|agent), `limit` (default 20)

**Response:**
```ts
{
  events: Array<{
    id: string
    type: 'smart-money' | 'signal' | 'agent' | 'risk'
    title: string
    description: string
    timestamp: string
  }>
  meta: { timestamp: string }
}
```

**Source tables:** `trade_recommendations`, `execution_transactions`, `smart_money_signals`

---

## Signal → Risk/Action Tier Mapping

| `signal_tier` | `risk` | `signal` |
|---|---|---|
| STRONG | Low | Strong Buy |
| MODERATE | Medium | Buy |
| WEAK | High | Hold |
| NOISE | High | Sell |

---

## Implementation Notes

- All routes use `export const dynamic = 'force-dynamic'` (no cache)
- `DATABASE_URL` must be set in `client/.env.local`
- postgres.js connection uses `max: 5` pool size
- All errors return `{ error: string, code: string }` with appropriate HTTP status
- Null DB result (e.g., no portfolio row) returns `null` for the primary object, not 404
- Typed fetch helpers live in `client/lib/api.ts`; server components use absolute URL, client components use relative path
