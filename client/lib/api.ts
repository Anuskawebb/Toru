/**
 * Typed fetch helpers for the Toro API.
 *
 * Server components must use absolute URLs (process.env.NEXT_PUBLIC_API_URL).
 * Client components use relative paths (/api/...) — base() returns '' in the browser.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignalItem {
  tokenAddress: string
  token: string
  score: number
  risk: 'Low' | 'Medium' | 'High'
  signal: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell'
  confidence: number
  smartWallets: number
  trend: 'Increasing' | 'Stable' | 'Decreasing'
  change24h: number
  netAccumulationFlow: number
  signalTier: string
  computedAt: string
}

export interface PortfolioData {
  totalValue: number
  stablecoinUsd: number
  tokenExposureUsd: number
  buyingPowerUsd: number
  drawdownPct: number
  rollingLossPct24h: number
  cashReservePct: number
  totalExposurePct: number
  openRiskPct: number
  openPositions: number
  unrealizedPnlUsd: number
  agentWallet: string
  updatedAt: string
}

export interface PortfolioActivity {
  action: string
  token: string
  amountUsd: number
  entryPriceUsd: number
  createdAt: string
}

export interface PositionItem {
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
}

export interface AgentStatus {
  monitoringTokens: number
  trackedWallets: number
  signalsGenerated: number
  recommendationsActive: number
  agentStatus: string
  portfolioUsd: number | null
}

export interface AgentDecision {
  action: string
  token: string
  reason: string
  confidence: number
  allocation: string
  status: string
  decidedAt: string
}

export interface AgentRecommendation {
  token: string
  action: string
  risk: string
  allocation: string
  stopLoss: string
  takeProfit: string
  confidence: number
  status: string
}

export interface AgentData {
  status: AgentStatus
  decisions: AgentDecision[]
  recommendations: AgentRecommendation[]
}

export interface ExecutionStats {
  ordersProcessed: number
  ordersFilled: number
  ordersFailed: number
  ordersPending: number
  ordersProcessing: number
  successRate: number
  openPositions: number
  portfolioUsd: number
  drawdownPct: number
  openRiskPct: number
}

export interface QueueItem {
  id: string
  token: string
  action: string
  amountUsd: number
  status: string
  txHash: string | null
  txStatus: string | null
  createdAt: string
}

export interface ExecutionCenterData {
  stats: ExecutionStats
  queue: QueueItem[]
}

export interface ActivityEvent {
  id: string
  type: 'smart-money' | 'signal' | 'agent' | 'risk' | 'whale'
  title: string
  description: string
  timestamp: string
}

export interface TokenData {
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
}

// ---------------------------------------------------------------------------
// Base URL helper
// ---------------------------------------------------------------------------

function base(): string {
  return typeof window === 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000')
    : ''
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

export async function fetchSignals(params?: {
  limit?: number
  offset?: number
  search?: string
  riskTier?: string
  signalTier?: string
}): Promise<{ signals: SignalItem[]; total: number }> {
  try {
    const q = new URLSearchParams()
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    if (params?.search) q.set('search', params.search)
    if (params?.riskTier) q.set('riskTier', params.riskTier)
    if (params?.signalTier) q.set('signalTier', params.signalTier)
    const res = await fetch(`${base()}/api/signals?${q}`, { cache: 'no-store' })
    if (!res.ok) return { signals: [], total: 0 }
    return await res.json()
  } catch {
    return { signals: [], total: 0 }
  }
}

export async function fetchPortfolio(): Promise<{
  portfolio: PortfolioData | null
  activity: PortfolioActivity[]
}> {
  try {
    const res = await fetch(`${base()}/api/portfolio`, { cache: 'no-store' })
    if (!res.ok) return { portfolio: null, activity: [] }
    return await res.json()
  } catch {
    return { portfolio: null, activity: [] }
  }
}

export async function fetchPositions(params?: {
  status?: 'OPEN' | 'CLOSED'
  limit?: number
  offset?: number
}): Promise<{ positions: PositionItem[]; total: number }> {
  try {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    const res = await fetch(`${base()}/api/positions?${q}`, { cache: 'no-store' })
    if (!res.ok) return { positions: [], total: 0 }
    return await res.json()
  } catch {
    return { positions: [], total: 0 }
  }
}

export async function fetchAgent(): Promise<AgentData> {
  const empty: AgentData = {
    status: {
      monitoringTokens: 0,
      trackedWallets: 0,
      signalsGenerated: 0,
      recommendationsActive: 0,
      agentStatus: 'Unknown',
      portfolioUsd: null,
    },
    decisions: [],
    recommendations: [],
  }
  try {
    const res = await fetch(`${base()}/api/agent`, { cache: 'no-store' })
    if (!res.ok) return empty
    return await res.json()
  } catch {
    return empty
  }
}

export async function fetchExecutionCenter(): Promise<ExecutionCenterData> {
  const empty: ExecutionCenterData = {
    stats: {
      ordersProcessed: 0,
      ordersFilled: 0,
      ordersFailed: 0,
      ordersPending: 0,
      ordersProcessing: 0,
      successRate: 0,
      openPositions: 0,
      portfolioUsd: 0,
      drawdownPct: 0,
      openRiskPct: 0,
    },
    queue: [],
  }
  try {
    const res = await fetch(`${base()}/api/execution-center`, { cache: 'no-store' })
    if (!res.ok) return empty
    return await res.json()
  } catch {
    return empty
  }
}

export async function fetchActivity(params?: {
  limit?: number
  type?: string
}): Promise<{ events: ActivityEvent[] }> {
  try {
    const q = new URLSearchParams()
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.type) q.set('type', params.type)
    const res = await fetch(`${base()}/api/activity?${q}`, { cache: 'no-store' })
    if (!res.ok) return { events: [] }
    return await res.json()
  } catch {
    return { events: [] }
  }
}

export async function fetchToken(address: string): Promise<{ token: TokenData | null }> {
  try {
    const res = await fetch(`${base()}/api/tokens/${address}`, { cache: 'no-store' })
    if (!res.ok) return { token: null }
    return await res.json()
  } catch {
    return { token: null }
  }
}

// ---------------------------------------------------------------------------
// Agent Wallet (Phase 8B.2)
// ---------------------------------------------------------------------------

export interface AgentWallet {
  agentId:       string
  walletAddress: string
  status:        string
  accountType:   string
  createdAt:     string | null
}

export interface WalletBalance {
  nativeBalance: string
  nativeSymbol:  string
  usdValue:      string | null
  tokens:        unknown[]
  funded:        boolean
}

export interface WalletAsset {
  symbol:   string
  balance:  string
  usdValue: string
}

export interface WalletPortfolio {
  totalValueUsd: string
  assets:        WalletAsset[]
}

export async function fetchAgentWallet(agentId: string): Promise<{ account: AgentWallet | null }> {
  try {
    const res = await fetch(`${base()}/api/agents/${agentId}/wallet`, { cache: 'no-store' })
    if (res.status === 404) return { account: null }
    if (!res.ok) return { account: null }
    const data = await res.json()
    return { account: data }
  } catch {
    return { account: null }
  }
}

export async function ensureAgentWallet(agentId: string): Promise<{ account: AgentWallet | null }> {
  try {
    const res = await fetch(`${base()}/api/agents/${agentId}/wallet`, {
      method: 'POST',
      cache:  'no-store',
    })
    if (!res.ok) return { account: null }
    const data = await res.json()
    return { account: data }
  } catch {
    return { account: null }
  }
}

export async function fetchWalletBalance(agentId: string): Promise<WalletBalance> {
  const empty: WalletBalance = { nativeBalance: '0', nativeSymbol: 'BNB', usdValue: null, tokens: [], funded: false }
  try {
    const res = await fetch(`${base()}/api/agents/${agentId}/wallet/balance`, { cache: 'no-store' })
    if (!res.ok) return empty
    return await res.json()
  } catch {
    return empty
  }
}

export async function fetchWalletPortfolio(agentId: string): Promise<WalletPortfolio> {
  const empty: WalletPortfolio = { totalValueUsd: '0', assets: [] }
  try {
    const res = await fetch(`${base()}/api/agents/${agentId}/wallet/portfolio`, { cache: 'no-store' })
    if (!res.ok) return empty
    return await res.json()
  } catch {
    return empty
  }
}
