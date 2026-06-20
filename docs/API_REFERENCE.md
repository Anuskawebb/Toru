# API Reference — Toru

All endpoints are Next.js Route Handlers under `client/app/api/`.  
All routes are `force-dynamic` (no caching).  
All routes use postgres.js with the shared `globalThis.__toroSql` pool.

**Base URL (dev):** `http://localhost:3001/api`  
**Error shape:** `{ "error": "Internal server error", "code": "DB_ERROR" }` with HTTP 500

---

## GET /api/signals

Ranked list of smart-money token signals.

**Used by:** Markets page, Dashboard (Top Opportunities, Signals Tab), Community Feed

**Query params:**
| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 20 | Max results (capped at 100) |
| `offset` | number | 0 | Pagination offset |
| `search` | string | — | Filter by token symbol or address |
| `signalTier` | string | — | STRONG / MODERATE / WEAK / NOISE |

**Tables:** `smart_money_signals`  
**Filter:** `meets_minimum_holders = true`  
**Order:** `accumulation_score DESC`

**Response:**
```json
{
  "signals": [
    {
      "tokenAddress": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "token": "WBNB",
      "score": 71,
      "risk": "Medium",
      "signal": "Buy",
      "confidence": 83,
      "smartWallets": 18,
      "trend": "Stable",
      "change24h": 0,
      "netAccumulationFlow": 12,
      "signalTier": "MODERATE",
      "computedAt": "2026-06-19T07:59:21.057Z"
    }
  ],
  "total": 46,
  "meta": { "timestamp": "2026-06-19T13:00:00.000Z" }
}
```

**Tier → Risk mapping:**
- STRONG → Low / Strong Buy
- MODERATE → Medium / Buy
- WEAK → High / Hold
- NOISE → High / Sell

---

## GET /api/portfolio

Current portfolio state and recent execution activity.

**Used by:** Portfolio page

**Tables:** `portfolio_state`, `agent_positions`, `execution_orders`

**Response:**
```json
{
  "portfolio": {
    "totalValue": 9000,
    "stablecoinUsd": 5000,
    "tokenExposureUsd": 4000,
    "buyingPowerUsd": 5000,
    "startingCapitalUsd": 10000,
    "peakPortfolioUsd": 12000,
    "drawdownPct": 25,
    "rollingLossPct24h": 18.18,
    "cashReservePct": 55.56,
    "totalExposurePct": 44.44,
    "openRiskPct": 2.22,
    "openPositions": 2,
    "valuationConfidence": 63.7,
    "unrealizedPnlUsd": 0,
    "agentWallet": "0x1111...1111",
    "updatedAt": "2026-06-18T14:38:41.790Z"
  },
  "activity": [
    {
      "action": "BUY",
      "token": "WBNB",
      "amountUsd": 500,
      "entryPriceUsd": 650,
      "createdAt": "2026-06-18T10:00:00.000Z"
    }
  ],
  "meta": { "timestamp": "2026-06-19T13:00:00.000Z" }
}
```

Returns `"portfolio": null` if no portfolio_state row exists.

---

## GET /api/positions

Agent's open or closed positions.

**Used by:** Portfolio page, Assets page

**Query params:**
| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string | OPEN | OPEN / CLOSED / all |

**Tables:** `agent_positions`

**Response:**
```json
{
  "positions": [
    {
      "id": "uuid",
      "token": "WBNB",
      "positionSizeUsd": 2000,
      "positionSizePct": 22.2,
      "unrealizedPnlPct": -5.5,
      "unrealizedPnlUsd": -110,
      "entryPriceUsd": 650,
      "currentPriceUsd": null,
      "stopLossPct": 8,
      "takeProfitPct": 15,
      "status": "OPEN",
      "openedAt": "2026-06-18T10:00:00.000Z"
    }
  ],
  "total": 2,
  "meta": { "timestamp": "2026-06-19T13:00:00.000Z" }
}
```

Note: `unrealizedPnlUsd` is computed as `positionSizeUsd × unrealizedPnlPct / 100`.

---

## GET /api/orders

Execution orders created by the execution engine.

**Used by:** Execution Center (supplementary)

**Query params:**
| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string | — | Filter by order status |
| `limit` | number | 50 | |
| `offset` | number | 0 | |

**Tables:** `execution_orders`

**Response:**
```json
{
  "orders": [
    {
      "id": "uuid",
      "token": "WBNB",
      "action": "BUY",
      "amountUsd": 500,
      "entryPriceUsd": 650,
      "slippageLimitPct": 2,
      "status": "PENDING",
      "createdAt": "2026-06-18T10:00:00.000Z"
    }
  ],
  "total": 0,
  "meta": { "timestamp": "..." }
}
```

---

## GET /api/executions

On-chain transaction records for executed orders.

**Used by:** Execution Center (transaction history)

**Query params:**
| Param | Type | Description |
|---|---|---|
| `orderId` | string | Filter by specific order |
| `limit` | number | Default 50 |

**Tables:** `execution_transactions` JOIN `execution_orders`

**Response:**
```json
{
  "executions": [
    {
      "id": "uuid",
      "orderId": "uuid",
      "token": "WBNB",
      "action": "BUY",
      "amountUsd": 500,
      "txHash": "0x...",
      "status": "SUCCESS",
      "executedAt": "2026-06-18T10:05:00.000Z"
    }
  ],
  "total": 0,
  "meta": { "timestamp": "..." }
}
```

---

## GET /api/agent

Aggregated agent status, recent decisions, and pending recommendations.

**Used by:** Agent page

**Tables:** `smart_money_signals`, `wallet_scores`, `trade_recommendations`, `portfolio_state`

**Response:**
```json
{
  "status": {
    "monitoringTokens": 6,
    "trackedWallets": 1710,
    "signalsGenerated": 412,
    "recommendationsActive": 0,
    "agentStatus": "Active",
    "agentWallet": "0x1111...1111",
    "portfolioUsd": 9000,
    "openPositions": 2,
    "drawdownPct": 25
  },
  "decisions": [
    {
      "action": "BUY",
      "token": "WBNB",
      "reasons": ["Strong smart-money entry", "Score 82"],
      "reason": "Strong smart-money entry",
      "confidence": 87,
      "allocation": "8%",
      "status": "Executed",
      "decidedAt": "2026-06-18T10:00:00.000Z"
    }
  ],
  "recommendations": [
    {
      "token": "PIEVERSE",
      "action": "BUY",
      "risk": "Moderate",
      "allocation": "5%",
      "stopLoss": "8%",
      "takeProfit": "15%",
      "confidence": 82,
      "status": "Pending"
    }
  ],
  "meta": { "timestamp": "..." }
}
```

Note: `confidence` is stored as 0.0–1.0 in the DB and returned as 0–100 (integer) here.

---

## GET /api/execution-center

Aggregated execution statistics + order queue + portfolio summary.

**Used by:** Execution Center page

**Tables:** `execution_orders`, `execution_transactions`, `portfolio_state`

**Response:**
```json
{
  "stats": {
    "ordersProcessed": 0,
    "ordersFilled": 0,
    "ordersFailed": 0,
    "ordersPending": 0,
    "ordersProcessing": 0,
    "successRate": 0,
    "openPositions": 2,
    "portfolioUsd": 9000,
    "drawdownPct": 25,
    "openRiskPct": 2.22
  },
  "queue": [
    {
      "id": "uuid",
      "token": "WBNB",
      "action": "BUY",
      "amountUsd": 500,
      "entryPriceUsd": 650,
      "status": "PENDING",
      "txHash": null,
      "txStatus": null,
      "createdAt": "2026-06-18T10:00:00.000Z"
    }
  ],
  "meta": { "timestamp": "..." }
}
```

---

## GET /api/activity

Merged timeline of agent events — signal upgrades, executions, and recommendations.

**Used by:** Dashboard (Live Intelligence), Community, Community Feed, Agent page

**Query params:**
| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 20 | Max events (capped at 50) |
| `type` | string | all | Filter: smart-money / signal / agent / risk |

**Tables:** `trade_recommendations`, `execution_transactions` JOIN `execution_orders`, `smart_money_signals`

**Event types:**
- `smart-money` — token entered top opportunities (MODERATE signal)
- `signal` — STRONG conviction upgrade or WEAK/NOISE signal active
- `agent` — agent queued or executed a trade
- `risk` — failed execution or SELL action

**Response:**
```json
{
  "events": [
    {
      "id": "sig-0xbb4cdb...",
      "type": "signal",
      "title": "WBNB upgraded to STRONG conviction. Score: 71",
      "description": "18 quality holders. Trend: Stable",
      "timestamp": "2026-06-19T07:59:21.057Z"
    },
    {
      "id": "uuid",
      "type": "agent",
      "title": "Toru agent opened WBNB position ($500)",
      "description": "Transaction confirmed on chain",
      "timestamp": "2026-06-18T10:05:00.000Z"
    }
  ],
  "meta": { "timestamp": "..." }
}
```

---

## GET /api/tokens/[address]

Full intelligence profile for a specific token.

**Used by:** Token Detail page

**Path param:** `address` — BSC token contract address (case-insensitive)

**Tables:** `smart_money_signals`

**Response:**
```json
{
  "token": {
    "tokenAddress": "0xbb4cdb...",
    "tokenSymbol": "WBNB",
    "toroScore": 71,
    "signalTier": "MODERATE",
    "scoreBreakdown": {
      "wallet": 65,
      "flow": 52,
      "smartMoney": 45,
      "liquidity": 50,
      "risk": 65
    },
    "smartMoneyActivity": {
      "walletsEntering": 3,
      "walletsExiting": 1,
      "netFlow": 12,
      "convictionScore": 65
    },
    "qualityHolderCount": 18,
    "holderCount": 120,
    "accumulationScore": 71.3,
    "accumulatorHolderCount": 5,
    "narrative": "WBNB shows moderate smart-money signals...",
    "trendDirection": "STABLE",
    "meetsMinimumHolders": true,
    "computedAt": "2026-06-19T07:59:21.057Z"
  },
  "meta": { "timestamp": "..." }
}
```

Returns `"token": null` if address not found.

---

## GET /api/tokens/[address]/activity

Execution history for a specific token.

**Used by:** Token Detail page (activity tab, not yet wired in UI)

**Path param:** `address` — token contract address

**Tables:** `execution_orders` LEFT JOIN `trade_recommendations`

**Response:**
```json
{
  "activity": [
    {
      "orderId": "uuid",
      "action": "BUY",
      "amountUsd": 500,
      "entryPriceUsd": 650,
      "status": "FILLED",
      "confidence": 87,
      "createdAt": "2026-06-18T10:00:00.000Z"
    }
  ],
  "total": 0,
  "meta": { "timestamp": "..." }
}
```

---

## Typed Fetch Helpers (`client/lib/api.ts`)

For use in both server and client components:

```typescript
import { fetchSignals, fetchPortfolio, fetchPositions, fetchAgent,
         fetchExecutionCenter, fetchActivity, fetchToken } from '@/lib/api'

// Server component (async function)
const { signals } = await fetchSignals({ limit: 10, signalTier: 'STRONG' })

// Client component (useEffect)
useEffect(() => {
  fetchPortfolio().then(({ portfolio }) => setPortfolio(portfolio))
}, [])
```

The helper uses `''` as base URL in the browser and `process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'` on the server — works for both RSC and client components without configuration.
