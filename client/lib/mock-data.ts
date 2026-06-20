export interface Token {
  symbol: string
  name: string
  price: number
  change24h: number
  marketCap: number
  volume24h: number
  logoUrl: string
}

export interface Signal {
  token: string
  score: number
  risk: 'Low' | 'Medium' | 'High'
  signal: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell'
  confidence: number
  change24h: number
  smartWallets: number
  trend: 'Increasing' | 'Stable' | 'Decreasing'
}

export interface TokenDetail extends Token {
  signalScore: number
  riskTier: 'Low' | 'Medium' | 'High'
  signalStatus: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell'
  confidence: number
  smartWalletsAccumulating: number
  smartWalletsSelling: number
  flow24hInflow: number
  flow24hOutflow: number
  netAccumulation: number
}

export const mockTokens: Token[] = [
  {
    symbol: 'CAKE',
    name: 'PancakeSwap',
    price: 2.45,
    change24h: 5.2,
    marketCap: 750000000,
    volume24h: 125000000,
    logoUrl: '/icons/cake.svg',
  },
  {
    symbol: 'DOGE',
    name: 'Dogecoin',
    price: 0.18,
    change24h: -2.1,
    marketCap: 26000000000,
    volume24h: 1200000000,
    logoUrl: '/icons/doge.svg',
  },
  {
    symbol: 'FLOKI',
    name: 'Floki Inu',
    price: 0.0000287,
    change24h: 12.5,
    marketCap: 2400000000,
    volume24h: 80000000,
    logoUrl: '/icons/floki.svg',
  },
  {
    symbol: 'BONK',
    name: 'Bonk',
    price: 0.0000128,
    change24h: 8.3,
    marketCap: 1100000000,
    volume24h: 45000000,
    logoUrl: '/icons/bonk.svg',
  },
  {
    symbol: 'PENGU',
    name: 'Pudgy Penguins',
    price: 1.8,
    change24h: 3.7,
    marketCap: 540000000,
    volume24h: 22000000,
    logoUrl: '/icons/pengu.svg',
  },
  {
    symbol: 'PEPE',
    name: 'Pepe',
    price: 0.00000625,
    change24h: 15.2,
    marketCap: 2700000000,
    volume24h: 320000000,
    logoUrl: '/icons/pepe.svg',
  },
  {
    symbol: 'SHIB',
    name: 'Shiba Inu',
    price: 0.0000089,
    change24h: 1.8,
    marketCap: 5300000000,
    volume24h: 280000000,
    logoUrl: '/icons/shib.svg',
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    price: 3250.0,
    change24h: 2.3,
    marketCap: 390000000000,
    volume24h: 15000000000,
    logoUrl: '/icons/eth.svg',
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    price: 109534.23,
    change24h: 6.86,
    marketCap: 2150000000000,
    volume24h: 32000000000,
    logoUrl: '/icons/btc.svg',
  },
  {
    symbol: 'USDT',
    name: 'Tether',
    price: 1.0,
    change24h: 0.0,
    marketCap: 120000000000,
    volume24h: 80000000000,
    logoUrl: '/icons/usdt.svg',
  },
]

export const mockSignals: Signal[] = [
  {
    token: 'CAKE',
    score: 92,
    risk: 'Medium',
    signal: 'Strong Buy',
    confidence: 91,
    change24h: 5.2,
    smartWallets: 14,
    trend: 'Increasing',
  },
  {
    token: 'FLOKI',
    score: 87,
    risk: 'High',
    signal: 'Buy',
    confidence: 84,
    change24h: 12.5,
    smartWallets: 9,
    trend: 'Increasing',
  },
  {
    token: 'BONK',
    score: 78,
    risk: 'High',
    signal: 'Buy',
    confidence: 71,
    change24h: 8.3,
    smartWallets: 6,
    trend: 'Stable',
  },
  {
    token: 'PEPE',
    score: 85,
    risk: 'High',
    signal: 'Strong Buy',
    confidence: 88,
    change24h: 15.2,
    smartWallets: 12,
    trend: 'Increasing',
  },
  {
    token: 'DOGE',
    score: 65,
    risk: 'Medium',
    signal: 'Hold',
    confidence: 62,
    change24h: -2.1,
    smartWallets: 4,
    trend: 'Decreasing',
  },
  {
    token: 'PENGU',
    score: 72,
    risk: 'Medium',
    signal: 'Buy',
    confidence: 68,
    change24h: 3.7,
    smartWallets: 7,
    trend: 'Stable',
  },
  {
    token: 'ETH',
    score: 68,
    risk: 'Low',
    signal: 'Hold',
    confidence: 75,
    change24h: 2.3,
    smartWallets: 18,
    trend: 'Stable',
  },
  {
    token: 'SHIB',
    score: 52,
    risk: 'High',
    signal: 'Sell',
    confidence: 55,
    change24h: 1.8,
    smartWallets: 2,
    trend: 'Decreasing',
  },
]

export const mockTokenDetail: TokenDetail = {
  symbol: 'CAKE',
  name: 'PancakeSwap',
  price: 2.45,
  change24h: 5.2,
  marketCap: 750000000,
  volume24h: 125000000,
  logoUrl: '/icons/cake.svg',
  signalScore: 92,
  riskTier: 'Medium',
  signalStatus: 'Strong Buy',
  confidence: 91,
  smartWalletsAccumulating: 14,
  smartWalletsSelling: 2,
  flow24hInflow: 124000,
  flow24hOutflow: 32000,
  netAccumulation: 92000,
}

export const mockPortfolio = {
  totalValue: 12452,
  pnlToday: 4.8,
  pnlWeek: 8.2,
  pnlMonth: 12.5,
  drawdown: 2.1,
  dailyLoss: 0.8,
  holdings: [
    { token: 'CAKE', amount: 150, value: 367.5, pnl: 18.5, allocation: 3 },
    { token: 'DOGE', amount: 5000, value: 900, pnl: -32, allocation: 7.2 },
    { token: 'ETH', amount: 2, value: 6500, pnl: 245, allocation: 52.1 },
    { token: 'USDT', amount: 3500, value: 3500, pnl: 0, allocation: 28.1 },
  ],
}

export const mockPortfolioActivity = [
  { action: 'BUY', token: 'CAKE', amount: 50, price: 2.35, timestamp: 'Today 14:32' },
  { action: 'SELL', token: 'DOGE', amount: 1000, price: 0.18, timestamp: 'Today 10:15' },
  { action: 'STOP LOSS', token: 'FLOKI', amount: 250000, price: 0.000027, timestamp: 'Yesterday 09:42' },
  { action: 'TAKE PROFIT', token: 'PEPE', amount: 500000, price: 0.0000068, timestamp: 'Yesterday 16:20' },
]

export const mockCommunityPosts = [
  {
    id: 1,
    type: 'smart-money',
    title: 'Smart Wallet #12 accumulated CAKE',
    description: '+$124,000 inflow in 2 hours',
    timestamp: '5 minutes ago',
  },
  {
    id: 2,
    type: 'signal',
    title: 'Signal upgraded from 84 to 92',
    description: 'CAKE signal strength increased due to accumulation',
    timestamp: '12 minutes ago',
  },
  {
    id: 3,
    type: 'agent',
    title: 'Risk engine approved position',
    description: 'Portfolio headroom available for new allocation',
    timestamp: '28 minutes ago',
  },
  {
    id: 4,
    type: 'whale',
    title: 'Whale entered position',
    description: 'Large holder initiated PEPE accumulation',
    timestamp: '45 minutes ago',
  },
]

export const mockResearchArticles = [
  {
    id: 1,
    title: 'Why CAKE Conviction Increased',
    summary: 'Deep analysis of smart wallet accumulation patterns and on-chain signals.',
    source: 'Toro Intelligence',
    timestamp: '2 hours ago',
  },
  {
    id: 2,
    title: 'Whale Accumulation Analysis',
    summary: 'Tracking major holder movements across DEX platforms.',
    source: 'On-Chain Research',
    timestamp: '5 hours ago',
  },
  {
    id: 3,
    title: 'Market Rotation Report',
    summary: 'Capital flowing from large cap to mid cap tokens this week.',
    source: 'Market Analysis',
    timestamp: '1 day ago',
  },
]

export const agentStatus = {
  monitoringTokens: 412,
  trackedWallets: 1710,
  signalsGenerated: 414,
  recommendationsActive: 6,
  status: 'Active',
}

export const mockAgentDecisions = [
  {
    action: 'BUY',
    token: 'CAKE',
    reason: 'Strong wallet accumulation',
    confidence: 91,
    allocation: '8%',
    timestamp: '2 minutes ago',
  },
  {
    action: 'WATCH',
    token: 'FLOKI',
    reason: 'Monitoring signal strength',
    confidence: 78,
    allocation: '-',
    timestamp: '8 minutes ago',
  },
  {
    action: 'REJECT',
    token: 'BONK',
    reason: 'Insufficient conviction',
    confidence: 42,
    allocation: '-',
    timestamp: '15 minutes ago',
  },
  {
    action: 'SELL',
    token: 'DOGE',
    reason: 'Decreasing signal trend',
    confidence: 65,
    allocation: 'Exit',
    timestamp: '22 minutes ago',
  },
]

export const mockRecommendations = [
  {
    token: 'CAKE',
    action: 'BUY',
    risk: 'Medium',
    allocation: '8%',
    stopLoss: '6%',
    takeProfit: '15%',
    confidence: 91,
    status: 'Pending',
  },
  {
    token: 'PEPE',
    action: 'BUY',
    risk: 'High',
    allocation: '5%',
    stopLoss: '8%',
    takeProfit: '20%',
    confidence: 88,
    status: 'Pending',
  },
  {
    token: 'FLOKI',
    action: 'BUY',
    risk: 'High',
    allocation: '3%',
    stopLoss: '7%',
    takeProfit: '18%',
    confidence: 84,
    status: 'Active',
  },
]

export const mockAssets = [
  { token: 'CAKE', value: 367.5, pnl: 18.5, allocation: 3 },
  { token: 'DOGE', value: 900, pnl: -32, allocation: 7.2 },
  { token: 'ETH', value: 6500, pnl: 245, allocation: 52.1 },
  { token: 'USDT', value: 3500, pnl: 0, allocation: 28.1 },
  { token: 'FLOKI', value: 215, pnl: 85, allocation: 1.7 },
  { token: 'PEPE', value: 320, pnl: 142, allocation: 2.6 },
]

export function getTokenBySymbol(symbol: string): Token | undefined {
  return mockTokens.find((t) => t.symbol === symbol)
}

export function getSignalByToken(token: string): Signal | undefined {
  return mockSignals.find((s) => s.token === token)
}
