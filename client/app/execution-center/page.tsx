import TopNavigation from '@/components/navigation/top-nav'
import { fetchExecutionCenter, fetchAgentWallet, fetchWalletBalance, fetchWalletPortfolio } from '@/lib/api'
import { Check, Clock, AlertCircle, X, Activity, Copy, Wallet, TrendingUp } from 'lucide-react'

export const dynamic = 'force-dynamic'

const AGENT_ID = process.env.TORO_AGENT_ID ?? 'toro-agent-001'

export default async function ExecutionCenterPage() {
  const [{ stats, queue }, { account }, balance, portfolio] = await Promise.all([
    fetchExecutionCenter(),
    fetchAgentWallet(AGENT_ID),
    fetchWalletBalance(AGENT_ID),
    fetchWalletPortfolio(AGENT_ID),
  ])

  return (
    <>
      <TopNavigation />
      <main className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">Execution Center</h1>
            <p className="text-muted-foreground">Real-time trading execution and order management</p>
          </div>

          {/* Top Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-8">
            {[
              { label: 'Orders Processed', value: String(stats.ordersProcessed) },
              { label: 'Filled Orders', value: String(stats.ordersFilled) },
              { label: 'Failed Orders', value: String(stats.ordersFailed) },
              { label: 'Success Rate', value: `${stats.successRate}%` },
              { label: 'Avg Time', value: '2.3s' },
              { label: 'Open Positions', value: String(stats.openPositions) },
            ].map((metric) => (
              <div key={metric.label} className="bg-card border border-border rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">{metric.label}</div>
                <div className="text-lg font-bold text-foreground">{metric.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-8">
            {/* Execution Queue */}
            <div className="lg:col-span-3">
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-lg font-bold text-foreground mb-4">Execution Queue</h2>

                {/* Tabs */}
                <div className="flex gap-2 mb-6 border-b border-border">
                  {['Pending', 'Processing', 'Filled', 'Failed'].map((tab) => (
                    <button key={tab} className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                      tab === 'Processing'
                        ? 'border-orange-accent text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}>
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Orders Table */}
                <div className="space-y-2">
                  {queue.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">No orders found</div>
                  ) : (
                    queue.map((order) => (
                      <div key={order.id} className="border border-border rounded-lg p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1">
                          <div className="font-bold text-foreground w-16">{order.token}</div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              order.action === 'BUY' ? 'bg-green-positive/10 text-green-positive' : 'bg-red-negative/10 text-red-negative'
                            }`}>
                              {order.action}
                            </span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            ${order.amountUsd?.toFixed(2) ?? '—'}
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="w-24">
                            <div className="flex items-center justify-center">
                              {order.status === 'FILLED' && <Check size={18} className="text-green-positive" />}
                              {order.status === 'PROCESSING' && <Activity size={18} className="text-orange-accent animate-pulse" />}
                              {order.status === 'PENDING' && <Clock size={18} className="text-muted-foreground" />}
                              {order.status === 'FAILED' && <X size={18} className="text-red-negative" />}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground w-28 text-right">
                            {new Date(order.createdAt).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* System Health */}
            <div className="space-y-6">
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="font-bold text-foreground mb-4">System Health</h3>
                <div className="space-y-3">
                  {[
                    { service: 'Execution Engine', status: 'healthy' },
                    { service: 'Risk Engine', status: 'healthy' },
                    { service: 'Portfolio Engine', status: 'healthy' },
                    { service: 'TWAK Adapter', status: 'healthy' },
                    { service: 'CMC Agent Hub', status: 'healthy' },
                    { service: 'BNB Agent SDK', status: 'degraded' },
                  ].map((sys) => (
                    <div key={sys.service} className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{sys.service}</span>
                      <div className={`w-2 h-2 rounded-full ${
                        sys.status === 'healthy' ? 'bg-green-positive' : 'bg-orange-accent'
                      }`} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Risk Alerts */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                  <AlertCircle size={18} />
                  Risk Alerts
                </h3>
                <div className="space-y-2 text-sm">
                  {[
                    { alert: `Drawdown: -${stats.drawdownPct.toFixed(1)}%`, severity: stats.drawdownPct > 5 ? 'warning' : 'info' },
                    { alert: `Exposure: ${stats.openRiskPct.toFixed(1)}%`, severity: 'info' },
                    { alert: `Open positions: ${stats.openPositions}`, severity: 'info' },
                  ].map((item, idx) => (
                    <div key={idx} className={`p-2 rounded border ${
                      item.severity === 'warning'
                        ? 'bg-orange-accent/10 border-orange-accent/30'
                        : 'bg-secondary border-border'
                    }`}>
                      <div className="text-xs">{item.alert}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Agent Wallet Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">

            {/* Wallet Card */}
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <Wallet size={18} className="text-orange-accent" />
                <h3 className="font-bold text-foreground">Agent Wallet</h3>
              </div>
              {account ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Status</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      account.status === 'ACTIVE'
                        ? 'bg-green-positive/10 text-green-positive'
                        : 'bg-orange-accent/10 text-orange-accent'
                    }`}>
                      {account.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Type</span>
                    <span className="text-xs text-foreground font-mono">{account.accountType}</span>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Wallet Address</div>
                    <div className="flex items-center gap-2 bg-secondary rounded p-2">
                      <span className="text-xs font-mono text-foreground truncate flex-1">
                        {account.walletAddress}
                      </span>
                      <button
                        onClick={undefined}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        title="Copy address"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No wallet configured.
                  <br />
                  <span className="text-xs">Ensure TWAK sidecar is running.</span>
                </div>
              )}
            </div>

            {/* Balance Card */}
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={18} className="text-orange-accent" />
                <h3 className="font-bold text-foreground">Balance</h3>
              </div>
              {balance.funded ? (
                <div className="space-y-3">
                  <div>
                    <div className="text-2xl font-bold text-foreground">
                      {parseFloat(balance.nativeBalance).toFixed(4)} {balance.nativeSymbol}
                    </div>
                    {balance.usdValue && (
                      <div className="text-sm text-muted-foreground mt-1">
                        ≈ ${parseFloat(balance.usdValue).toLocaleString()} USD
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-4 p-2 bg-green-positive/10 border border-green-positive/20 rounded">
                    <Check size={14} className="text-green-positive" />
                    <span className="text-xs text-green-positive font-medium">Ready For Trading</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-2xl font-bold text-foreground">0 BNB</div>
                  <div className="p-3 bg-orange-accent/10 border border-orange-accent/20 rounded">
                    <div className="text-xs font-medium text-orange-accent mb-2">Fund Wallet to Start Trading</div>
                    {account && (
                      <div className="flex items-center gap-2 bg-background/50 rounded p-2 mt-2">
                        <span className="text-xs font-mono text-muted-foreground truncate flex-1">
                          {account.walletAddress}
                        </span>
                        <Copy size={12} className="shrink-0 text-muted-foreground" />
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-2">
                      Send BNB to the address above to enable trading.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Portfolio Card */}
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <Activity size={18} className="text-orange-accent" />
                <h3 className="font-bold text-foreground">Portfolio</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Total Value</div>
                  <div className="text-2xl font-bold text-foreground">
                    ${parseFloat(portfolio.totalValueUsd || '0').toLocaleString()}
                  </div>
                </div>
                {portfolio.assets.length > 0 ? (
                  <div className="space-y-2 mt-2">
                    {portfolio.assets.slice(0, 4).map((asset: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{asset.symbol ?? asset.chain ?? '—'}</span>
                        <span className="text-foreground font-mono text-xs">
                          {parseFloat(asset.balance ?? asset.amount ?? '0').toFixed(4)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground mt-2">No token holdings</div>
                )}
              </div>
            </div>
          </div>

          {/* Execution Timeline */}
          <div className="bg-card border border-border rounded-lg p-6 mb-8">
            <h2 className="text-lg font-bold text-foreground mb-6">Execution Timeline</h2>
            <div className="space-y-4 relative pl-8">
              {queue.slice(0, 5).map((order, idx) => (
                <div key={idx} className="flex gap-4 items-start">
                  <div className="absolute left-0 w-6 h-6 rounded-full bg-secondary border-2 border-orange-accent flex items-center justify-center text-xs font-bold text-orange-accent">
                    {order.action === 'BUY' ? '↑' : '↓'}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-foreground">
                      {order.action} {order.token} — ${order.amountUsd?.toFixed(2) ?? '—'}
                    </div>
                    <div className="text-sm text-muted-foreground">{order.status}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(order.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Execution Logs */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-lg font-bold text-foreground mb-4">Execution Logs</h2>
            <div className="bg-secondary rounded-lg p-4 font-mono text-xs text-muted-foreground space-y-1 max-h-64 overflow-y-auto">
              {queue.slice(0, 8).map((order, idx) => (
                <div key={idx}>
                  <span className={order.status === 'FILLED' || order.status === 'PROCESSING' ? 'text-green-positive' : 'text-orange-accent'}>
                    [{new Date(order.createdAt).toLocaleTimeString()}]
                  </span>
                  {' '}{order.action} {order.token} — ${order.amountUsd?.toFixed(2) ?? '—'} [{order.status}]
                </div>
              ))}
              {queue.length === 0 && <div>No execution logs available</div>}
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
