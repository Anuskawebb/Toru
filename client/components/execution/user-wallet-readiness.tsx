'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useAuth } from '@/context/auth-context'
import WalletReadiness from '@/components/execution/wallet-readiness'
import { Loader2, LogIn, Bot, ArrowRight, TrendingUp, Shield, Zap, Plus } from 'lucide-react'

interface Agent {
  id:            string
  name:          string
  status:        string
  riskLevel:     string
  tradingMode:   string
  walletAddress: string | null
}

interface Profile {
  riskTolerance:     string | null
  goals:             string | null
  displayName:       string | null
}

const STRATEGY_MAP: Record<string, string> = {
  LOW_CAPITAL_PRESERVATION:     'Smart Money Conservative',
  MEDIUM_BALANCED_GROWTH:       'Smart Money Momentum',
  HIGH_AGGRESSIVE_GROWTH:       'Smart Money Aggressive',
  HIGH_SPECULATIVE:             'Meme & Narrative Alpha',
  LOW_BALANCED_GROWTH:          'Smart Money Conservative',
  MEDIUM_CAPITAL_PRESERVATION:  'Smart Money Conservative',
}

function recommendedStrategy(profile: Profile | null): string {
  if (!profile?.riskTolerance || !profile?.goals) return 'Smart Money Momentum'
  const key = `${profile.riskTolerance}_${profile.goals}`
  return STRATEGY_MAP[key] ?? 'Smart Money Momentum'
}

function WelcomeState({ profile }: { profile: Profile | null }) {
  const router    = useRouter()
  const { displayName } = useAuth()
  const firstName = displayName?.split(' ')[0] ?? profile?.displayName?.split(' ')[0] ?? null
  const strategy  = recommendedStrategy(profile)

  const riskLabel: Record<string, string> = { LOW: 'Conservative', MEDIUM: 'Balanced', HIGH: 'Aggressive' }
  const goalsLabel: Record<string, string> = {
    CAPITAL_PRESERVATION: 'Capital Preservation',
    BALANCED_GROWTH:      'Balanced Growth',
    AGGRESSIVE_GROWTH:    'Aggressive Growth',
    SPECULATIVE:          'Speculative',
  }

  return (
    <div className="bg-card border border-border rounded-xl p-8 mb-6">
      {/* Greeting */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-1">
          {firstName ? `Welcome back, ${firstName}.` : 'Welcome to Toru.'}
        </h2>
        <p className="text-sm text-muted-foreground">Your trading platform is ready.</p>
      </div>

      {/* Profile summary */}
      {profile && (profile.riskTolerance || profile.goals) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {profile.riskTolerance && (
            <div className="flex items-center gap-3 p-3 bg-secondary/60 rounded-lg">
              <Shield size={14} className="text-orange-accent shrink-0" />
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Risk Profile</div>
                <div className="text-xs font-semibold text-foreground">{riskLabel[profile.riskTolerance] ?? profile.riskTolerance}</div>
              </div>
            </div>
          )}
          {profile.goals && (
            <div className="flex items-center gap-3 p-3 bg-secondary/60 rounded-lg">
              <TrendingUp size={14} className="text-orange-accent shrink-0" />
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Goal</div>
                <div className="text-xs font-semibold text-foreground">{goalsLabel[profile.goals] ?? profile.goals}</div>
              </div>
            </div>
          )}
          <div className="sm:col-span-2 flex items-center gap-3 p-3 bg-orange-accent/5 border border-orange-accent/15 rounded-lg">
            <Zap size={14} className="text-orange-accent shrink-0" />
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Recommended Strategy</div>
              <div className="text-xs font-semibold text-foreground">{strategy}</div>
            </div>
          </div>
        </div>
      )}

      {/* No agent yet */}
      <div className="text-center py-6 border-t border-border mt-2">
        <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
          <Bot size={24} className="text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold text-foreground mb-2">You don&apos;t have any agents yet</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
          Create your first autonomous trading agent. It will execute trades based on your strategy — 24/7, on BSC.
        </p>
        <button
          onClick={() => router.push('/agents/new')}
          style={{ backgroundColor: 'var(--orange-accent)' }}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-semibold text-sm transition-opacity hover:opacity-90"
        >
          <Plus size={16} />
          Create Your First Agent
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

export default function UserWalletReadiness() {
  const router                     = useRouter()
  const { ready, authenticated, login } = usePrivy()
  const { userId, onboardingCompleted, loading: authLoading } = useAuth()

  const [agents,  setAgents]  = useState<Agent[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!userId) return
    const token = await (window as any).__privy_getToken?.()
    // Fall back to no-auth fetch (will get 401 if protected)
    const headers: HeadersInit = {}

    // Get token via the DOM event trick isn't reliable; use context instead
    // The fetch calls will pass the Privy JWT via Auth header
    // We use a different approach: import usePrivy's getAccessToken
    setLoading(false)
  }, [userId])

  useEffect(() => {
    if (!ready || authLoading) return
    if (!authenticated || !userId) { setLoading(false); return }
    if (!onboardingCompleted) { setLoading(false); return }

    void (async () => {
      // We need the token — get it via a custom event trick
      // Actually, we'll use the AuthContext getToken
      setLoading(false)
    })()
  }, [ready, authLoading, authenticated, userId, onboardingCompleted])

  if (!ready || authLoading || loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
        <Loader2 size={16} className="animate-spin" />
        Loading…
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="bg-card border border-border rounded-xl p-10 mb-6 text-center">
        <div className="w-12 h-12 rounded-xl bg-orange-accent/10 flex items-center justify-center mx-auto mb-4">
          <LogIn size={20} className="text-orange-accent" />
        </div>
        <h3 className="text-base font-semibold text-foreground mb-2">Sign in to continue</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">
          Sign in to view your agents, wallet readiness, and execution queue.
        </p>
        <button
          onClick={login}
          style={{ backgroundColor: 'var(--orange-accent)' }}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold transition-opacity hover:opacity-90"
        >
          <LogIn size={14} />
          Sign In
        </button>
      </div>
    )
  }

  return <AgentSectionInner />
}

function AgentSectionInner() {
  const { getToken } = useAuth()
  const router = useRouter()

  const [agents,  setAgents]  = useState<Agent[] | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const token = await getToken()
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}

      const [agentsRes, profileRes] = await Promise.allSettled([
        fetch('/api/agents',      { headers, cache: 'no-store' }),
        fetch('/api/me/profile',  { headers, cache: 'no-store' }),
      ])

      if (agentsRes.status === 'fulfilled' && agentsRes.value.ok) {
        const data = await agentsRes.value.json() as { agents: Agent[] }
        setAgents(data.agents)
      } else {
        setAgents([])
      }

      if (profileRes.status === 'fulfilled' && profileRes.value.ok) {
        const data = await profileRes.value.json() as { profile: Profile | null }
        setProfile(data.profile)
      }

      setLoading(false)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
        <Loader2 size={16} className="animate-spin" />
        Loading agents…
      </div>
    )
  }

  if (!agents || agents.length === 0) {
    return <WelcomeState profile={profile} />
  }

  // Show first active/funded agent; fallback to first in list
  const primaryAgent =
    agents.find((a) => a.status === 'ACTIVE') ??
    agents.find((a) => a.status === 'PENDING_FUNDING') ??
    agents[0]!

  // If agent has no wallet yet → link to setup page
  if (!primaryAgent.walletAddress) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 mb-6 text-center">
        <div className="w-12 h-12 rounded-xl bg-orange-accent/10 flex items-center justify-center mx-auto mb-4">
          <Bot size={22} className="text-orange-accent" />
        </div>
        <h3 className="text-base font-semibold text-foreground mb-1">{primaryAgent.name}</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Your agent is created but needs an execution account before it can trade.
        </p>
        <button
          onClick={() => router.push(`/agents/${primaryAgent.id}`)}
          style={{ backgroundColor: 'var(--orange-accent)' }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-semibold transition-opacity hover:opacity-90"
        >
          Complete Agent Setup
          <ArrowRight size={14} />
        </button>
      </div>
    )
  }

  return <WalletReadiness agentId={primaryAgent.id} />
}
