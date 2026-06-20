import TopNavigation from '@/components/navigation/top-nav'
import { ChevronDown, TrendingUp, Target, AlertCircle, Clock, CheckCircle } from 'lucide-react'

export default function AgentIntelligencePage() {
  return (
    <>
      <TopNavigation />
      <main className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">Agent Intelligence & Explainability</h1>
            <p className="text-muted-foreground">Understand why your agent made each trading decision</p>
          </div>

          {/* Agent Overview KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Agent Name', value: 'Toru Alpha', icon: '🤖' },
              { label: 'Status', value: 'Running', icon: '▶️', highlight: true },
              { label: 'Portfolio Value', value: '$125,450', icon: '💰' },
              { label: 'Total PnL', value: '+$8,920', icon: '📈', positive: true },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-card border border-border rounded-lg p-4">
                <div className="text-sm text-muted-foreground mb-1">{kpi.label}</div>
                <div className={`text-2xl font-bold ${kpi.positive ? 'text-green-positive' : 'text-foreground'}`}>
                  {kpi.value}
                </div>
              </div>
            ))}
          </div>

          {/* Secondary Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Win Rate', value: '68%' },
              { label: 'Active Positions', value: '5' },
              { label: 'Signals Evaluated', value: '1,247' },
              { label: 'Trades Executed', value: '42' },
            ].map((metric) => (
              <div key={metric.label} className="bg-card border border-border rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">{metric.label}</div>
                <div className="text-xl font-bold text-foreground">{metric.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Decision Timeline */}
            <div className="lg:col-span-2">
              <div className="bg-card border border-border rounded-lg p-6 mb-8">
                <h2 className="text-lg font-bold text-foreground mb-6">Decision Timeline</h2>
                <div className="space-y-4">
                  {[
                    { token: 'CAKE', action: 'BUY', confidence: 92, size: '$5,000', score: 8.7, risk: 'Medium', time: '2 min ago' },
                    { token: 'SOL', action: 'SELL', confidence: 85, size: '$3,500', score: 7.2, risk: 'Low', time: '15 min ago' },
                    { token: 'DOGE', action: 'BUY', confidence: 78, size: '$2,800', score: 6.9, risk: 'High', time: '1 hour ago' },
                  ].map((decision, idx) => (
                    <div key={idx} className="border border-border rounded-lg p-4 hover:border-orange-accent transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="font-bold text-foreground">{decision.token}</div>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            decision.action === 'BUY' ? 'bg-green-positive/10 text-green-positive' : 'bg-red-negative/10 text-red-negative'
                          }`}>
                            {decision.action}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">{decision.time}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">Confidence</div>
                          <div className="font-semibold text-foreground">{decision.confidence}%</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Position</div>
                          <div className="font-semibold text-foreground">{decision.size}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Score</div>
                          <div className="font-semibold text-foreground">{decision.score}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Risk</div>
                          <div className="font-semibold text-foreground">{decision.risk}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Reasoning Trace */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-lg font-bold text-foreground mb-6">Reasoning Trace - CAKE BUY</h2>
                <div className="space-y-3">
                  <details className="border border-border rounded-lg p-4 open:bg-secondary group">
                    <summary className="flex items-center justify-between cursor-pointer font-semibold text-foreground">
                      <span>Smart Money Analysis</span>
                      <ChevronDown size={18} className="group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-positive" />
                        <span>Wallet accumulation detected</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-positive" />
                        <span>Wallet score increased to 94/100</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-positive" />
                        <span>Net inflow positive (+$2.3M)</span>
                      </div>
                    </div>
                  </details>

                  <details className="border border-border rounded-lg p-4 open:bg-secondary group">
                    <summary className="flex items-center justify-between cursor-pointer font-semibold text-foreground">
                      <span>Risk Engine Approval</span>
                      <ChevronDown size={18} className="group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-positive" />
                        <span>Risk score: 6.2/10 (Acceptable)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-positive" />
                        <span>Exposure within limits (4.2% of portfolio)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-positive" />
                        <span>Drawdown acceptable (-2.1%)</span>
                      </div>
                    </div>
                  </details>

                  <details className="border border-border rounded-lg p-4 open:bg-secondary group">
                    <summary className="flex items-center justify-between cursor-pointer font-semibold text-foreground">
                      <span>Market Context</span>
                      <ChevronDown size={18} className="group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-positive" />
                        <span>Price above VWAP (+3.2%)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-positive" />
                        <span>Liquidity healthy (30min avg volume: $48M)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle size={16} className="text-green-positive" />
                        <span>Sentiment positive (social score: 82)</span>
                      </div>
                    </div>
                  </details>

                  <div className="bg-secondary border border-border rounded-lg p-4 flex items-center gap-3">
                    <Target size={20} className="text-orange-accent" />
                    <div>
                      <div className="font-semibold text-foreground">Final Decision</div>
                      <div className="text-sm text-muted-foreground">Execute BUY order for CAKE at market</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="space-y-6">
              {/* Open Positions */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="font-bold text-foreground mb-4">Open Positions (5)</h3>
                <div className="space-y-3">
                  {[
                    { token: 'CAKE', entry: '$5.24', current: '$5.89', pnl: '+12.4%', risk: 'Medium' },
                    { token: 'SOL', entry: '$22.5', current: '$24.1', pnl: '+7.1%', risk: 'Low' },
                    { token: 'DOGE', entry: '$0.42', current: '$0.39', pnl: '-7.2%', risk: 'High' },
                  ].map((pos) => (
                    <div key={pos.token} className="border border-border rounded p-2 text-xs">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-semibold text-foreground">{pos.token}</span>
                        <span className={pos.pnl.startsWith('+') ? 'text-green-positive' : 'text-red-negative'}>
                          {pos.pnl}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-muted-foreground">
                        <div>
                          <div className="text-xs opacity-75">Entry</div>
                          <div>{pos.entry}</div>
                        </div>
                        <div>
                          <div className="text-xs opacity-75">Current</div>
                          <div>{pos.current}</div>
                        </div>
                        <div>
                          <div className="text-xs opacity-75">Risk</div>
                          <div>{pos.risk}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Activity */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="font-bold text-foreground mb-4">Recent Activity</h3>
                <div className="space-y-2 text-sm">
                  {[
                    { event: 'CAKE position +5%', time: '2 min ago' },
                    { event: 'SOL stop loss hit', time: '8 min ago' },
                    { event: 'DOGE buy signal', time: '1 hour ago' },
                  ].map((activity, idx) => (
                    <div key={idx} className="flex items-center justify-between text-muted-foreground hover:text-foreground">
                      <span>{activity.event}</span>
                      <span className="text-xs">{activity.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
