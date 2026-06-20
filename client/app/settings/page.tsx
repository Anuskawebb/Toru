import TopNavigation from '@/components/navigation/top-nav'
import ThemeToggle from '@/components/theme-toggle'
import { Shield, Bell, Zap, Wallet, Code, Link as LinkIcon, Trash2, Pause, Play, Copy } from 'lucide-react'

export default function SettingsPage() {
  const sections = ['General', 'Agents', 'Wallets', 'Notifications', 'Risk', 'Security', 'Appearance', 'Integrations']

  return (
    <>
      <TopNavigation />
      <main className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">Settings & Agent Management</h1>
            <p className="text-muted-foreground">Configure your agents, wallets, and preferences</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Sidebar Navigation */}
            <div className="lg:col-span-1">
              <div className="bg-card border border-border rounded-lg p-4 sticky top-24">
                <nav className="space-y-2">
                  {sections.map((section) => (
                    <button key={section} className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                      section === 'Agents'
                        ? 'bg-secondary text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-secondary'
                    }`}>
                      {section}
                    </button>
                  ))}
                </nav>
              </div>
            </div>

            {/* Main Content */}
            <div className="lg:col-span-3 space-y-8">
              {/* Agent Management Section */}
              <div className="bg-card border border-border rounded-lg p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                    <Zap size={20} />
                    Agent Management
                  </h2>
                  <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity font-medium text-sm">
                    Create Agent
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    {
                      name: 'Toru Alpha',
                      status: 'Running',
                      strategy: 'Trend Following',
                      risk: 'Balanced',
                      wallet: '0x7f3a...9c2d',
                      value: '$125,450',
                    },
                    {
                      name: 'Toru Beta',
                      status: 'Paused',
                      strategy: 'Mean Reversion',
                      risk: 'Conservative',
                      wallet: '0x8a4b...2e3f',
                      value: '$45,200',
                    },
                  ].map((agent) => (
                    <div key={agent.name} className="border border-border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="font-bold text-foreground">{agent.name}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              agent.status === 'Running'
                                ? 'bg-green-positive/10 text-green-positive'
                                : 'bg-muted text-muted-foreground'
                            }`}>
                              {agent.status}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-foreground">{agent.value}</div>
                          <div className="text-xs text-muted-foreground">Portfolio</div>
                        </div>
                      </div>
                      
                      <div className="space-y-2 text-sm mb-4">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Strategy</span>
                          <span className="text-foreground">{agent.strategy}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Risk Level</span>
                          <span className="text-foreground">{agent.risk}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Wallet</span>
                          <div className="flex items-center gap-1">
                            <span className="text-foreground font-mono text-xs">{agent.wallet}</span>
                            <button className="p-1 hover:bg-secondary rounded">
                              <Copy size={14} className="text-muted-foreground" />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-4 border-t border-border">
                        <button className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded bg-secondary hover:opacity-80 transition-opacity text-sm font-medium">
                          {agent.status === 'Running' ? <Pause size={16} /> : <Play size={16} />}
                          {agent.status === 'Running' ? 'Pause' : 'Resume'}
                        </button>
                        <button className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded border border-border hover:bg-secondary transition-colors text-sm font-medium">
                          <Copy size={16} />
                          Clone
                        </button>
                        <button className="px-3 py-2 rounded border border-border hover:bg-red-negative/10 text-red-negative transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Wallet Management */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                  <Wallet size={20} />
                  Wallet Management
                </h2>

                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Connected Wallets</h3>
                    <div className="bg-secondary border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-foreground">0x7f3a...9c2d</div>
                          <div className="text-sm text-muted-foreground">MetaMask • $524,300 USDC</div>
                        </div>
                        <LinkIcon size={18} className="text-orange-accent" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Agent Wallets</h3>
                    <div className="space-y-2">
                      {['0x8a4b...2e3f (Toru Alpha)', '0x9b5c...3f4g (Toru Beta)'].map((wallet) => (
                        <div key={wallet} className="bg-secondary border border-border rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div className="font-mono text-sm text-foreground">{wallet}</div>
                            <button className="p-1 hover:bg-border rounded">
                              <Copy size={14} className="text-muted-foreground" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Risk Controls */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                  <Shield size={20} />
                  Risk Controls
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[
                    { label: 'Max Drawdown', value: 15, unit: '%' },
                    { label: 'Max Daily Loss', value: 5, unit: '%' },
                    { label: 'Max Portfolio Exposure', value: 80, unit: '%' },
                    { label: 'Max Position Size', value: 25, unit: '%' },
                  ].map((control) => (
                    <div key={control.label}>
                      <label className="block text-sm font-medium text-foreground mb-2">{control.label}</label>
                      <div className="flex gap-3 items-center">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          defaultValue={control.value}
                          className="flex-1 h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
                        />
                        <input
                          type="number"
                          defaultValue={control.value}
                          className="w-16 px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground"
                        />
                        <span className="text-sm text-muted-foreground">{control.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notification Settings */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                  <Bell size={20} />
                  Notifications
                </h2>

                <div className="space-y-4">
                  {[
                    { platform: 'Email', description: 'Receive alerts via email' },
                    { platform: 'Telegram', description: 'Receive alerts via Telegram bot' },
                    { platform: 'Push Notifications', description: 'Browser push notifications' },
                  ].map((notif) => (
                    <div key={notif.platform} className="border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="font-medium text-foreground">{notif.platform}</div>
                          <div className="text-sm text-muted-foreground">{notif.description}</div>
                        </div>
                        <input type="checkbox" defaultChecked className="w-5 h-5" />
                      </div>
                      {notif.platform === 'Email' && (
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {['Trade Alerts', 'Risk Alerts', 'Execution Alerts', 'Portfolio Alerts'].map((type) => (
                            <label key={type} className="flex items-center gap-2">
                              <input type="checkbox" defaultChecked className="w-4 h-4" />
                              <span className="text-muted-foreground">{type}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Security Settings */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                  <Shield size={20} />
                  Security
                </h2>

                <div className="space-y-4">
                  <div className="border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="font-medium text-foreground">Two-Factor Authentication</div>
                        <div className="text-sm text-muted-foreground">Secure your account with 2FA</div>
                      </div>
                      <input type="checkbox" defaultChecked className="w-5 h-5" />
                    </div>
                  </div>

                  <div className="border border-border rounded-lg p-4">
                    <div className="font-medium text-foreground mb-3">API Keys</div>
                    <div className="bg-secondary rounded p-3 font-mono text-xs text-muted-foreground overflow-x-auto">
                      sk_live_abc123def456ghi789jkl012mno345
                    </div>
                    <button className="mt-3 px-4 py-2 bg-secondary hover:opacity-80 rounded-lg font-medium text-sm transition-opacity">
                      Regenerate
                    </button>
                  </div>
                </div>
              </div>

              {/* Appearance Settings */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-xl font-bold text-foreground mb-6">Appearance</h2>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">Theme</label>
                  <div className="inline-block">
                    <ThemeToggle />
                  </div>
                  <p className="text-sm text-muted-foreground mt-3">Your theme preference is saved automatically</p>
                </div>
              </div>

              {/* Integrations */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                  <Code size={20} />
                  Integrations
                </h2>

                <div className="space-y-4">
                  {[
                    { name: 'CoinMarketCap Agent Hub', status: 'connected' },
                    { name: 'Trust Wallet Agent Kit', status: 'connected' },
                    { name: 'BNB AI Agent SDK', status: 'connected' },
                    { name: 'WalletConnect', status: 'connected' },
                  ].map((integration) => (
                    <div key={integration.name} className="border border-border rounded-lg p-4 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-foreground">{integration.name}</div>
                        <div className={`text-xs mt-1 ${
                          integration.status === 'connected' ? 'text-green-positive' : 'text-muted-foreground'
                        }`}>
                          {integration.status === 'connected' ? '✓ Connected' : 'Not connected'}
                        </div>
                      </div>
                      <button className={`px-4 py-2 rounded-lg font-medium text-sm transition-opacity ${
                        integration.status === 'connected'
                          ? 'bg-secondary hover:opacity-80'
                          : 'bg-primary text-primary-foreground hover:opacity-90'
                      }`}>
                        {integration.status === 'connected' ? 'Disconnect' : 'Connect'}
                      </button>
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
