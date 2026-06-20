import TopNavigation from '@/components/navigation/top-nav'
import { tokenIntelligenceData } from '@/lib/mock-data-advanced'
import { TrendingUp, AlertCircle, BarChart3, Zap, ArrowUpRight, ArrowDownLeft } from 'lucide-react'

export default function TokenIntelligencePage() {
  const { toroScore, scoreBreakdown, smartMoneyActivity, signalBreakdown, recommendation, riskAnalysis, recentTransactions } = tokenIntelligenceData

  return (
    <>
      <TopNavigation />
      <main className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Token Header */}
          <div className="mb-8 bg-card border border-border rounded-lg p-6">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Token</div>
                <div className="text-2xl font-bold text-foreground">CAKE</div>
                <div className="text-xs text-muted-foreground">PancakeSwap</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Price</div>
                <div className="text-2xl font-bold text-foreground">$2.42</div>
                <div className="text-xs text-green-positive">+5.2% 24h</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Market Cap</div>
                <div className="text-2xl font-bold text-foreground">$750M</div>
                <div className="text-xs text-muted-foreground">Rank: #187</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">24h Volume</div>
                <div className="text-2xl font-bold text-foreground">$125M</div>
                <div className="text-xs text-muted-foreground">2.1% of cap</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Liquidity</div>
                <div className="text-2xl font-bold text-foreground">$48M</div>
                <div className="text-xs text-muted-foreground">DEX: 6.4%</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
            {/* Left Column - Toru Score & Breakdown */}
            <div className="lg:col-span-1 space-y-6">
              {/* Toru Score */}
              <div className="bg-card border border-border rounded-lg p-6">
                <div className="text-center mb-6">
                  <div className="text-sm text-muted-foreground mb-2">TORO SCORE</div>
                  <div className="text-5xl font-bold text-orange-accent mb-1">{toroScore}</div>
                  <div className="text-sm text-muted-foreground">/100 - Strong Buy</div>
                </div>

                <div className="space-y-4">
                  {Object.entries(scoreBreakdown).map(([key, value]) => (
                    <div key={key}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-medium text-foreground capitalize">{key}</span>
                        <span className="text-xs font-semibold text-foreground">{value}</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-accent"
                          style={{ width: `${value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommendation Card */}
              <div className={`bg-card border-2 rounded-lg p-6 ${recommendation === 'BUY' ? 'border-green-positive' : 'border-red-negative'}`}>
                <div className="text-center">
                  <div className="text-sm text-muted-foreground mb-2">RECOMMENDATION</div>
                  <div className={`text-3xl font-bold mb-3 ${recommendation === 'BUY' ? 'text-green-positive' : 'text-red-negative'}`}>
                    {recommendation}
                  </div>
                  <div className="text-xs text-muted-foreground">Confidence: 87%</div>
                </div>
              </div>
            </div>

            {/* Middle & Right Columns */}
            <div className="lg:col-span-2 space-y-6">
              {/* Smart Money Activity */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                  <TrendingUp size={20} />
                  Smart Money Activity
                </h2>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-secondary rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowUpRight size={16} className="text-green-positive" />
                      <span className="text-xs text-muted-foreground">Entering</span>
                    </div>
                    <div className="text-2xl font-bold text-foreground">{smartMoneyActivity.walletsEntering.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Smart Wallets</div>
                  </div>
                  <div className="bg-secondary rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowDownLeft size={16} className="text-red-negative" />
                      <span className="text-xs text-muted-foreground">Exiting</span>
                    </div>
                    <div className="text-2xl font-bold text-foreground">{smartMoneyActivity.walletsExiting.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Smart Wallets</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Net Flow (24h)</div>
                    <div className="text-xl font-bold text-green-positive">${(smartMoneyActivity.netFlow / 1000000).toFixed(2)}M</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Conviction Score</div>
                    <div className="text-xl font-bold text-orange-accent">{smartMoneyActivity.convictionScore}%</div>
                  </div>
                </div>
              </div>

              {/* Risk Analysis */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                  <AlertCircle size={20} />
                  Risk Analysis
                </h2>

                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(riskAnalysis).map(([key, value]) => (
                    <div key={key} className="bg-secondary rounded-lg p-3">
                      <div className="text-xs text-muted-foreground capitalize mb-1">{key.replace(/([A-Z])/g, ' $1')}</div>
                      <div className={`text-sm font-semibold ${
                        value === 'Low' ? 'text-green-positive' :
                        value === 'Medium' ? 'text-orange-accent' :
                        'text-red-negative'
                      }`}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Signal Breakdown */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                  <Zap size={20} />
                  Signal Breakdown
                </h2>

                <div className="space-y-3">
                  {signalBreakdown.map((signal, i) => (
                    <div key={i} className="border-l-2 border-orange-accent pl-4 py-2">
                      <div className="flex items-start justify-between mb-1">
                        <span className="text-sm text-foreground">{signal.reason}</span>
                        <span className={`text-xs font-semibold px-2 py-1 rounded ${
                          signal.sentiment === 'positive' ? 'bg-green-positive/10 text-green-positive' : 'bg-red-negative/10 text-red-negative'
                        }`}>
                          {signal.weight}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Smart Money Transactions */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
              <BarChart3 size={20} />
              Recent Smart Money Transactions
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Hash</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Wallet</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Action</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Amount</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Price</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Confidence</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTransactions.map((tx) => (
                    <tr key={tx.id} className="border-b border-border hover:bg-secondary transition-colors">
                      <td className="py-3 px-4 font-mono text-xs text-orange-accent">{tx.id}</td>
                      <td className="py-3 px-4 font-mono text-xs text-foreground">{tx.wallet}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-1 rounded text-xs font-semibold bg-green-positive/10 text-green-positive">
                          {tx.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-foreground">{(tx.amount / 1000).toFixed(0)}K</td>
                      <td className="py-3 px-4 text-foreground">${tx.price.toFixed(2)}</td>
                      <td className="py-3 px-4 font-semibold text-orange-accent">{tx.confidence}%</td>
                      <td className="py-3 px-4 text-muted-foreground">{tx.timestamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
