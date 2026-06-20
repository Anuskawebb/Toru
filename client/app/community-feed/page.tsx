import TopNavigation from '@/components/navigation/top-nav'
import { fetchActivity, fetchSignals, ActivityEvent, SignalItem } from '@/lib/api'
import { Heart, MessageCircle, Repeat2, Share, TrendingUp, Users, Flame } from 'lucide-react'

export const dynamic = 'force-dynamic'

const postTypeConfig: Record<string, { label: string; color: string }> = {
  smart_money_entry: { label: 'Smart Money Entry', color: 'bg-green-positive/10 text-green-positive' },
  smart_money_exit: { label: 'Smart Money Exit', color: 'bg-red-negative/10 text-red-negative' },
  agent_strategy: { label: 'Agent Strategy', color: 'bg-orange-accent/10 text-orange-accent' },
  market_insight: { label: 'Market Insight', color: 'bg-purple-500/10 text-purple-400' },
  signal_upgrade: { label: 'Signal Upgrade', color: 'bg-green-positive/10 text-green-positive' },
  signal_downgrade: { label: 'Signal Downgrade', color: 'bg-red-negative/10 text-red-negative' },
  'smart-money': { label: 'Smart Money', color: 'bg-blue-500/10 text-blue-400' },
  signal: { label: 'Signal', color: 'bg-green-positive/10 text-green-positive' },
  agent: { label: 'Agent Strategy', color: 'bg-orange-accent/10 text-orange-accent' },
  risk: { label: 'Risk Alert', color: 'bg-red-negative/10 text-red-negative' },
  whale: { label: 'Whale Alert', color: 'bg-blue-500/10 text-blue-400' },
}

function getConfig(type: string) {
  return postTypeConfig[type] ?? { label: type, color: 'bg-muted text-muted-foreground' }
}

// Generate a short avatar label from title
function avatarLabel(title: string): string {
  const words = title.trim().split(' ')
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return title.slice(0, 2).toUpperCase()
}

export default async function CommunityFeedPage() {
  const [{ events }, { signals }] = await Promise.all([
    fetchActivity({ limit: 20 }),
    fetchSignals({ limit: 4 }),
  ])

  return (
    <>
      <TopNavigation />
      <main className="min-h-screen bg-background">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 p-6 max-w-7xl mx-auto">
          {/* Left Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Trending Topics */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                <TrendingUp size={18} />
                Trending Topics
              </h3>
              <div className="space-y-3">
                {['#SmartMoney', '#BinanceOutflow', '#BullishSignal', '#TechnicalAnalysis', '#CryptoNews'].map((topic) => (
                  <button key={topic} className="w-full text-left px-3 py-2 rounded hover:bg-secondary transition-colors">
                    <div className="font-medium text-foreground text-sm">{topic}</div>
                    <div className="text-xs text-muted-foreground">24.5K posts</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Trending Tokens — real data from /api/signals */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                <Flame size={18} />
                Trending Tokens
              </h3>
              <div className="space-y-3">
                {signals.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No signal data</div>
                ) : (
                  signals.map((sig) => (
                    <button key={sig.token} className="w-full text-left px-3 py-2 rounded hover:bg-secondary transition-colors">
                      <div className="flex justify-between items-center">
                        <div className="font-medium text-foreground">${sig.token}</div>
                        <span className={`text-xs px-2 py-1 rounded font-semibold ${
                          sig.signal.includes('Buy')
                            ? 'bg-green-positive/10 text-green-positive'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {sig.score}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Top Contributors */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                <Users size={18} />
                Top Contributors
              </h3>
              <div className="space-y-3">
                {[
                  { name: 'SmartMoney Tracker', followers: '12K' },
                  { name: 'Whale Monitor', followers: '8.5K' },
                  { name: 'Toru Alpha', followers: '15K' },
                ].map((contributor) => (
                  <button key={contributor.name} className="w-full text-left px-3 py-2 rounded hover:bg-secondary transition-colors">
                    <div className="font-medium text-foreground text-sm">{contributor.name}</div>
                    <div className="text-xs text-muted-foreground">{contributor.followers} followers</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Center Feed — real events from /api/activity */}
          <div className="lg:col-span-2 space-y-4">
            {events.length === 0 ? (
              <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground">
                No activity events found
              </div>
            ) : (
              events.map((event) => {
                const config = getConfig(event.type)
                return (
                  <div key={event.id} className="bg-card border border-border rounded-lg p-6 hover:border-border transition-colors">
                    {/* Post Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex gap-3 flex-1">
                        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                          <span className="font-bold text-foreground text-xs">{avatarLabel(event.title)}</span>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">Toru Intelligence</span>
                            <span className={`text-xs px-2 py-0.5 rounded font-semibold ${config.color}`}>
                              {config.label}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(event.timestamp).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Post Content */}
                    <div className="mb-4">
                      <p className="text-sm font-semibold text-foreground mb-1">{event.title}</p>
                      <p className="text-sm text-foreground leading-relaxed">{event.description}</p>
                    </div>

                    {/* Engagement */}
                    <div className="flex items-center justify-between pt-4 border-t border-border text-xs text-muted-foreground">
                      <button className="flex items-center gap-2 px-3 py-2 rounded hover:bg-secondary transition-colors">
                        <Heart size={16} />
                        <span>0</span>
                      </button>
                      <button className="flex items-center gap-2 px-3 py-2 rounded hover:bg-secondary transition-colors">
                        <MessageCircle size={16} />
                        <span>0</span>
                      </button>
                      <button className="flex items-center gap-2 px-3 py-2 rounded hover:bg-secondary transition-colors">
                        <Repeat2 size={16} />
                        <span>0</span>
                      </button>
                      <button className="flex items-center gap-2 px-3 py-2 rounded hover:bg-secondary transition-colors">
                        <Share size={16} />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Right Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Most Discussed Assets */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-bold text-foreground mb-4">Most Discussed</h3>
              <div className="space-y-3">
                {signals.slice(0, 3).map((sig) => (
                  <div key={sig.token} className="bg-secondary rounded-lg p-3">
                    <div className="flex justify-between items-center mb-2">
                      <div className="font-semibold text-foreground">${sig.token}</div>
                      <div className="text-xs text-muted-foreground">{sig.score}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{sig.signal}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Community Stats */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-bold text-foreground mb-4">Community Stats</h3>
              <div className="space-y-4">
                <div>
                  <div className="text-2xl font-bold text-orange-accent mb-1">289K</div>
                  <div className="text-xs text-muted-foreground">Active Members</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-positive mb-1">54K</div>
                  <div className="text-xs text-muted-foreground">Posts Today</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-orange-accent mb-1">12.4M</div>
                  <div className="text-xs text-muted-foreground">Total Engagements</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
