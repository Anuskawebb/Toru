import TopNavigation from '@/components/navigation/top-nav'
import TradingChart from '@/components/chart/trading-chart'
import SignalScoreCard from '@/components/shared/signal-score-card'
import RiskBadge from '@/components/shared/risk-badge'
import { fetchSignals, fetchToken, SignalItem, TokenData } from '@/lib/api'
import { mockTokenDetail } from '@/lib/mock-data'
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

function tierToRisk(tier: string): 'Low' | 'Medium' | 'High' {
  if (tier === 'STRONG') return 'Low'
  if (tier === 'MODERATE') return 'Medium'
  return 'High'
}

function tierToSignal(tier: string): 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell' {
  if (tier === 'STRONG') return 'Strong Buy'
  if (tier === 'MODERATE') return 'Buy'
  if (tier === 'WEAK') return 'Hold'
  return 'Sell'
}

export default async function TokenDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params

  // Step 1: look up token address via signals search
  const { signals } = await fetchSignals({ search: symbol, limit: 1 })
  const sigMatch: SignalItem | undefined = signals[0]

  // Step 2: fetch full token intelligence if address found
  let tokenData: TokenData | null = null
  if (sigMatch?.tokenAddress) {
    const result = await fetchToken(sigMatch.tokenAddress)
    tokenData = result.token
  }

  // Fall back to mock if nothing found
  const fallback = mockTokenDetail

  // Derived display values
  const signalScore = tokenData?.toroScore ?? sigMatch?.score ?? fallback.signalScore
  const riskTier = tokenData ? tierToRisk(tokenData.signalTier) : (sigMatch ? sigMatch.risk : fallback.riskTier)
  const signalStatus = tokenData ? tierToSignal(tokenData.signalTier) : (sigMatch ? sigMatch.signal : fallback.signalStatus)
  const confidence = tokenData?.smartMoneyActivity.convictionScore ?? sigMatch?.confidence ?? fallback.confidence
  const smartWalletsAccumulating = tokenData?.qualityHolderCount ?? sigMatch?.smartWallets ?? fallback.smartWalletsAccumulating
  const smartWalletsExiting = tokenData?.smartMoneyActivity.walletsExiting ?? fallback.smartWalletsSelling
  const netFlow = tokenData?.smartMoneyActivity.netFlow ?? fallback.netAccumulation

  const scoreBreakdown = tokenData?.scoreBreakdown ?? {
    wallet: 93,
    flow: 88,
    smartMoney: 91,
    liquidity: 50,
    risk: 60,
  }

  const name = tokenData?.narrative ?? fallback.name

  return (
    <div className="flex flex-col h-screen bg-white">
      <TopNavigation />

      <div className="flex-1 overflow-auto">
        {/* Hero Section */}
        <div className="border-b border-gray-200 p-6">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
                  <span className="text-2xl font-bold text-gray-950">{symbol[0]}</span>
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-gray-950">{symbol}</h1>
                  <p className="text-gray-500 mt-1">{name}</p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-6">
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Price</div>
                  <div className="text-2xl font-bold text-gray-950">${fallback.price.toFixed(2)}</div>
                  <div className={`text-sm mt-1 flex items-center gap-1 ${fallback.change24h >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {fallback.change24h >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                    {Math.abs(fallback.change24h).toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Market Cap</div>
                  <div className="text-2xl font-bold text-gray-950">
                    ${(fallback.marketCap / 1000000000).toFixed(2)}B
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Volume 24H</div>
                  <div className="text-2xl font-bold text-gray-950">
                    ${(fallback.volume24h / 1000000).toFixed(0)}M
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Score</div>
                  <div className="text-2xl font-bold text-gray-950">{signalScore}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto p-6">
          {/* Signal Score Card */}
          <div className="mb-6">
            <SignalScoreCard
              score={signalScore}
              risk={riskTier}
              signal={signalStatus}
              confidence={confidence}
            />
          </div>

          {/* Chart */}
          <div className="bg-white rounded-lg border border-gray-200 mb-6" style={{ height: '600px' }}>
            <TradingChart />
          </div>

          {/* Smart Money Card */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-950 mb-6">Smart Money Intelligence</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-4 border-b border-gray-200">
                  <span className="text-sm text-gray-600">Smart Wallets Accumulating</span>
                  <span className="text-lg font-semibold text-green-700">{smartWalletsAccumulating}</span>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-gray-200">
                  <span className="text-sm text-gray-600">Smart Wallets Selling</span>
                  <span className="text-lg font-semibold text-red-700">{smartWalletsExiting}</span>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-gray-200">
                  <span className="text-sm text-gray-600">24H Inflow</span>
                  <span className="text-lg font-semibold text-green-700">
                    ${(fallback.flow24hInflow / 1000).toFixed(0)}K
                  </span>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-gray-200">
                  <span className="text-sm text-gray-600">24H Outflow</span>
                  <span className="text-lg font-semibold text-red-700">
                    ${(fallback.flow24hOutflow / 1000).toFixed(0)}K
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-sm font-medium text-gray-950">Net Accumulation</span>
                  <span className={`text-xl font-bold ${netFlow >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {netFlow >= 0 ? '+' : ''}${Math.abs(netFlow / 1000).toFixed(0)}K
                  </span>
                </div>
              </div>
            </div>

            {/* Agent Recommendation Card */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-950 mb-6">Toru Recommendation</h3>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Action</div>
                  <div className={`text-2xl font-bold ${signalStatus.includes('Buy') ? 'text-green-700' : 'text-red-700'}`}>
                    {signalStatus}
                  </div>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-gray-200">
                  <span className="text-sm text-gray-600">Suggested Allocation</span>
                  <span className="text-lg font-semibold text-gray-950">8%</span>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-gray-200">
                  <span className="text-sm text-gray-600">Stop Loss</span>
                  <span className="text-lg font-semibold text-red-700">6%</span>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-gray-200">
                  <span className="text-sm text-gray-600">Take Profit</span>
                  <span className="text-lg font-semibold text-green-700">15%</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-sm font-medium text-gray-950">Confidence</span>
                  <span className="text-xl font-bold text-gray-950">{confidence}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Signal Breakdown */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-950 mb-6">Signal Composition</h3>
            <div className="space-y-4">
              {[
                { label: 'Wallet Quality', value: scoreBreakdown.wallet },
                { label: 'Net Flow', value: scoreBreakdown.flow },
                { label: 'Smart Money', value: scoreBreakdown.smartMoney },
                { label: 'Liquidity', value: scoreBreakdown.liquidity },
                { label: 'Risk Score', value: scoreBreakdown.risk },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium text-gray-950">{item.label}</span>
                    <span className="text-sm font-semibold text-gray-950">{Math.round(item.value)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, item.value))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
