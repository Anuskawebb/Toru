'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  fetchAgentWallet,
  fetchWalletBalance,
  fetchWalletPortfolio,
  fetchReadiness,
  type AgentWallet,
  type WalletBalance,
  type WalletPortfolio,
  type ReadinessData,
} from '@/lib/api'
import {
  Check, X, Copy, Wallet, TrendingUp, Activity,
  AlertTriangle, Zap, RefreshCw, CircleDot, Play,
} from 'lucide-react'

const POLL_INTERVAL = 15_000

interface Props { agentId: string }

function copyText(t: string) { navigator.clipboard.writeText(t).catch(() => {}) }
function short(addr: string) { return `${addr.slice(0, 8)}…${addr.slice(-6)}` }

function CheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      {ok
        ? <span className="flex items-center gap-1.5 text-green-positive text-xs font-medium"><Check size={12} strokeWidth={2.5} /> Connected</span>
        : <span className="flex items-center gap-1.5 text-muted-foreground/60 text-xs"><X size={12} strokeWidth={2.5} /> Waiting</span>
      }
    </div>
  )
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {[0,1,2].map((i) => (
        <div key={i} className="bg-card border border-border rounded-xl p-5 animate-pulse">
          <div className="h-3 bg-secondary rounded w-1/3 mb-4" />
          <div className="h-7 bg-secondary rounded w-2/3 mb-2" />
          <div className="h-2.5 bg-secondary rounded w-1/2" />
        </div>
      ))}
    </div>
  )
}

export default function WalletReadiness({ agentId }: Props) {
  const [account,     setAccount]     = useState<AgentWallet | null>(null)
  const [balance,     setBalance]     = useState<WalletBalance | null>(null)
  const [portfolio,   setPortfolio]   = useState<WalletPortfolio | null>(null)
  const [readiness,   setReadiness]   = useState<ReadinessData | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [copied,      setCopied]      = useState(false)

  const refresh = useCallback(async () => {
    const [a, b, p, r] = await Promise.all([
      fetchAgentWallet(agentId),
      fetchWalletBalance(agentId),
      fetchWalletPortfolio(agentId),
      fetchReadiness(agentId),
    ])
    setAccount(a.account)
    setBalance(b)
    setPortfolio(p)
    setReadiness(r)
    setLastRefresh(new Date())
    setLoading(false)
  }, [agentId])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [refresh])

  const handleCopy = (text: string) => {
    copyText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <Skeleton />

  const isReady     = readiness?.readyForTrading ?? false
  const hasFunds    = readiness?.walletFunded    ?? false
  const hasWallet   = readiness?.walletCreated   ?? false
  const curBnb      = readiness?.currentBalanceBnb  ?? 0
  const minBnb      = readiness?.minimumRequiredBnb ?? 0.005
  const progressPct = Math.min(100, (curBnb / minBnb) * 100)

  return (
    <div className="mb-8 space-y-4">

      {/* ── Status banner ──────────────────────────────────────────── */}
      <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
        isReady
          ? 'bg-green-positive/5 border-green-positive/20'
          : hasFunds
            ? 'bg-orange-accent/5 border-orange-accent/20'
            : 'bg-secondary border-border'
      }`}>
        <div className="flex items-center gap-2.5">
          {isReady
            ? <><Zap size={14} className="text-green-positive" /><span className="font-semibold text-green-positive">Ready For Trading</span></>
            : hasWallet
              ? <><AlertTriangle size={14} className="text-orange-accent" /><span className="font-semibold text-orange-accent">Awaiting Funds</span><span className="text-muted-foreground hidden sm:inline">— fund your agent wallet with BNB to activate autonomous trading</span></>
              : <><CircleDot size={14} className="text-muted-foreground" /><span className="text-muted-foreground">Awaiting Wallet Setup</span></>
          }
        </div>
        <button onClick={refresh} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw size={11} />
          {lastRefresh ? lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
        </button>
      </div>

      {/* ── Three cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Wallet Card */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Wallet size={14} className="text-orange-accent" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Agent Wallet</span>
            </div>
            {account && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                account.status === 'ACTIVE'
                  ? 'bg-green-positive/10 text-green-positive'
                  : 'bg-orange-accent/10 text-orange-accent'
              }`}>{account.status}</span>
            )}
          </div>

          {account ? (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] text-muted-foreground mb-1.5">ADDRESS</div>
                <div className="flex items-center gap-2 bg-secondary rounded-lg px-3 py-2.5">
                  <span className="text-xs font-mono text-foreground flex-1 min-w-0 truncate">{short(account.walletAddress)}</span>
                  <button onClick={() => handleCopy(account.walletAddress)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    {copied ? <Check size={12} className="text-green-positive" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground font-mono break-all leading-relaxed">
                {account.walletAddress}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className={`w-1.5 h-1.5 rounded-full ${readiness?.twakConnected ? 'bg-green-positive' : 'bg-muted-foreground/40'}`} />
                TWAK {readiness?.twakConnected ? 'Connected' : 'Disconnected'}
              </div>
            </div>
          ) : (
            /* Empty state — no wallet */
            <div className="py-4 text-center">
              <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center mx-auto mb-3">
                <Wallet size={16} className="text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">No wallet yet</p>
              <p className="text-xs text-muted-foreground/60">Create your first trading agent to get started.</p>
            </div>
          )}
        </div>

        {/* Balance + Funding Progress */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-orange-accent" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Balance</span>
          </div>

          <div className="space-y-4">
            {hasWallet ? (
              <>
                <div>
                  <div className="text-2xl font-bold text-foreground tracking-tight">
                    {curBnb.toFixed(5)} <span className="text-sm font-normal text-muted-foreground">BNB</span>
                  </div>
                  {balance?.usdValue && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      ≈ ${parseFloat(balance.usdValue).toLocaleString(undefined, { maximumFractionDigits: 2 })} USD
                    </div>
                  )}
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1.5">
                    <span>Funding Progress</span>
                    <span>{progressPct.toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-700 ${isReady ? 'bg-green-positive' : 'bg-orange-accent'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>{curBnb.toFixed(5)} BNB</span>
                    <span>min {minBnb.toFixed(3)} BNB</span>
                  </div>
                </div>

                {/* Fund instructions */}
                {!isReady && account && (
                  <div className="p-3 bg-orange-accent/5 border border-orange-accent/15 rounded-lg">
                    <div className="text-[10px] font-semibold text-orange-accent uppercase tracking-widest mb-2">Send BNB to</div>
                    <div className="flex items-center gap-2 bg-background rounded px-2.5 py-2">
                      <span className="text-[10px] font-mono text-muted-foreground flex-1 truncate">{account.walletAddress}</span>
                      <button onClick={() => handleCopy(account.walletAddress)} className="text-muted-foreground hover:text-foreground shrink-0">
                        {copied ? <Check size={11} className="text-green-positive" /> : <Copy size={11} />}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1.5">BNB Smart Chain (BEP-20) only.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="py-4 text-center">
                <p className="text-sm text-muted-foreground">Fund your wallet to begin autonomous trading.</p>
              </div>
            )}
          </div>
        </div>

        {/* Readiness + Portfolio */}
        <div className="bg-card border border-border rounded-xl p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} className="text-orange-accent" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Readiness</span>
          </div>

          <div className="flex-1">
            <CheckRow label="TWAK Connected"    ok={readiness?.twakConnected    ?? false} />
            <CheckRow label="Wallet Created"    ok={readiness?.walletCreated    ?? false} />
            <CheckRow label="Wallet Funded"     ok={readiness?.walletFunded     ?? false} />
            <CheckRow label="Ready For Trading" ok={readiness?.readyForTrading  ?? false} />
          </div>

          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Portfolio Value</div>
            <div className="text-xl font-bold text-foreground">
              ${parseFloat(portfolio?.totalValueUsd ?? '0').toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            {portfolio && portfolio.assets.length > 0 ? (
              <div className="mt-2 space-y-1">
                {portfolio.assets.slice(0, 2).map((a: any, i: number) => (
                  <div key={i} className="flex justify-between text-xs text-muted-foreground">
                    <span>{a.symbol ?? a.chain ?? '—'}</span>
                    <span className="font-mono">{parseFloat(a.balance ?? a.amount ?? '0').toFixed(4)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60 mt-1">
                Your portfolio will appear once trading begins.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Start Agent ────────────────────────────────────────────── */}
      <div className={`flex items-center justify-between p-4 bg-card border rounded-xl ${
        isReady ? 'border-orange-accent/30' : 'border-border'
      }`}>
        <div>
          <div className="text-sm font-semibold text-foreground mb-0.5">Start Agent</div>
          <div className="text-xs text-muted-foreground">
            {isReady
              ? 'Your wallet is funded and ready to execute trades.'
              : 'Complete the readiness checklist above to unlock trading.'}
          </div>
        </div>
        <button
          disabled
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            isReady
              ? 'bg-orange-accent/10 text-orange-accent border border-orange-accent/30 cursor-not-allowed'
              : 'bg-secondary text-muted-foreground/40 cursor-not-allowed'
          }`}
          title="Coming in Phase 8B.4"
        >
          <Play size={12} />
          {isReady ? 'Coming Soon' : 'Locked'}
        </button>
      </div>
    </div>
  )
}
