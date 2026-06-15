'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import ConnectButton from '@/components/ConnectButton';
import Avatar from '@/components/Avatar';
import { useAUSD } from '@/hooks/useAUSD';
import { TokenBadge } from '@/components/TokenBadge';
import { aggregateHoldings, fmt, type Agent, type Holding, type Summary } from '@/lib/portfolio';

type ActivityEvent = {
  id:            string;
  type:          'OPENED' | 'CLOSED';
  token:         string;
  ausdAllocated: number;
  entryPrice:    number;
  exitPrice:     number | null;
  pnl:           number | null;
  pnlPct:        number | null;
  leader:        string;
  happenedAt:    string;
  txHash:        string | null;
};

type ActivityData = {
  stats:  { openCount: number; closedCount: number; totalPnl: number; openedToday: number };
  events: ActivityEvent[];
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function PortfolioChart({ points }: { points: [number, number][] }) {
  if (points.length === 0) return null;
  const w = 320, h = 90;
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);

  // Zoom the Y-axis to the data's own range so small fluctuations are visible,
  // with a small padding; fall back to a tiny fixed window if values are identical.
  const diff = maxY - minY;
  const avg = (minY + maxY) / 2;
  const padding = diff > 0 ? diff * 0.15 : Math.max(Math.abs(avg) * 0.0005, 0.01);
  minY -= padding;
  maxY += padding;

  const px = (x: number) => ((x - minX) / (maxX - minX || 1)) * (w - 12) + 6;
  const py = (y: number) => h - 6 - ((y - minY) / (maxY - minY || 1)) * (h - 16);
  
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(" ");
  const fd = `${d} L${px(maxX).toFixed(1)},${h} L${px(minX).toFixed(1)},${h} Z`;
  
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} fill="none" preserveAspectRatio="none">
      <defs>
        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0.00" />
        </linearGradient>
      </defs>
      <path d={fd} fill="url(#pg)" />
      <path d={d} stroke="#22c55e" strokeWidth="2" fill="none" strokeLinejoin="round" pathLength="1" className="animate-draw-path" />
    </svg>
  );
}

// ── Agent Timeline ─────────────────────────────────────────────────────────────

function AgentTimeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="bg-surface border border-border/60 rounded-2xl px-6 py-8 text-center">
        <p className="text-subtle text-[13px]">No agent activity recorded yet.</p>
        <p className="text-subtle text-[11px] mt-1">Once your agents start copying trades, their decisions will appear here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {events.map((ev, idx) => {
        const isOpen    = ev.type === 'OPENED';
        const isProfit  = !isOpen && (ev.pnl ?? 0) >= 0;
        const dotColor  = isOpen ? 'bg-accent' : isProfit ? 'bg-emerald-400' : 'bg-red-400';
        const pnlColor  = isProfit ? 'text-emerald-400' : 'text-red-400';

        return (
          <div
            key={ev.id + ev.type}
            className="bg-surface border border-border/60 hover:border-accent/30 rounded-2xl px-4 py-3 flex items-center gap-3 transition-spring hover:scale-[1.005] animate-fade-in-up"
            style={{ animationDelay: `${idx * 30}ms` }}
          >
            {/* Status dot */}
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />

            {/* Token badge */}
            <TokenBadge token={ev.token} size={28} />

            {/* Main text */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] text-foreground/90">
                  {isOpen ? 'Opened' : 'Closed'} <span className="font-medium">{ev.token}</span>
                  {isOpen
                    ? ` · ${ev.ausdAllocated.toFixed(2)} aUSD · entry $${ev.entryPrice.toFixed(4)}`
                    : ev.pnl !== null
                      ? ` · ${ev.pnl >= 0 ? '+' : ''}${ev.pnl.toFixed(2)} aUSD`
                      : ''}
                </span>
                {!isOpen && ev.pnlPct !== null && (
                  <span className={`text-[11px] font-mono ${pnlColor}`}>
                    ({ev.pnlPct >= 0 ? '+' : ''}{ev.pnlPct.toFixed(1)}%)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Avatar address={ev.leader} size={14} />
                <span className="text-[11px] text-subtle font-mono">{fmt(ev.leader)}</span>
                <span className="text-[11px] text-subtle/50">·</span>
                <span className="text-[11px] text-subtle">{timeAgo(ev.happenedAt)}</span>
              </div>
            </div>

            {/* Explorer link */}
            {ev.txHash && (
              <a
                href={`https://sepolia.mantlescan.xyz/tx/${ev.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-subtle hover:text-accent transition-colors flex-shrink-0"
                title="View on Mantle explorer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const router = useRouter();
  const { authenticated, user } = usePrivy();
  const isConnected = authenticated && !!user?.wallet?.address;
  const address = user?.wallet?.address;
  const { balance } = useAUSD();

  const [agents,       setAgents]       = useState<Agent[]>([]);
  const [summary,      setSummary]      = useState<Summary | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [activityData, setActivityData] = useState<ActivityData | null>(null);
  const [refreshTick,  setRefreshTick]  = useState(0);
  const [allTrades,    setAllTrades]    = useState<any[]>([]);
  const hasFetched = useRef(false);

  // Clear stale data and reset initial-load flag when address changes
  useEffect(() => {
    hasFetched.current = false;
    setAgents([]);
    setSummary(null);
    setActivityData(null);
    setAllTrades([]);
    setError(null);
  }, [address]);

  // 30s silent auto-refresh while connected
  useEffect(() => {
    if (!isConnected) return;
    const id = setInterval(() => setRefreshTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [isConnected]);

  useEffect(() => {
    if (!address) return;
    if (!hasFetched.current) setLoading(true);
    fetch(`/api/vaults/${address}`)
      .then((r) => r.json())
      .then((d) => {
        setAgents(d.vaults ?? []);
        setSummary(d.summary ?? null);
        hasFetched.current = true;
      })
      .catch(() => { if (!hasFetched.current) setError('Failed to load portfolio.'); })
      .finally(() => setLoading(false));
  }, [address, refreshTick]);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/activity/${address}`)
      .then((r) => r.json())
      .then((d) => setActivityData(d))
      .catch(() => {});
  }, [address, refreshTick]);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/trades?address=${address}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.trades?.length) {
          setAllTrades(d.trades);
        }
      })
      .catch(() => {});
  }, [address, refreshTick]);

  const holdings = useMemo(() => aggregateHoldings(agents), [agents]);

  const totalLocked = summary?.totalLocked ?? 0;
  const portfolioPnl = summary?.totalPnl ?? 0;
  const walletBalance = balance ? Number(balance) : 0;
  const netWorth = totalLocked + portfolioPnl + walletBalance;
  const pnlPct = totalLocked > 0 ? (portfolioPnl / totalLocked) * 100 : 0;

  const chartPoints = useMemo(() => {
    const closedTrades = allTrades
      .filter((t) => t.status === 'CLOSED' && t.closedAt)
      .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());

    const displayValue = netWorth > 0 ? netWorth : (balance ? Number(balance) : 10000);
    const totalRealizedPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const baseline = displayValue - totalRealizedPnl - portfolioPnl;

    const now = Date.now();
    let startTime = now - 24 * 60 * 60 * 1000; // default 24h ago
    
    const allValidTrades = allTrades.filter(t => t.openedAt);
    if (allValidTrades.length > 0) {
      const firstTradeTime = Math.min(...allValidTrades.map(t => new Date(t.openedAt!).getTime()));
      startTime = Math.min(firstTradeTime - 24 * 60 * 60 * 1000, now - 24 * 60 * 60 * 1000);
    }

    const steps = 30;
    const points: [number, number][] = [];
    
    for (let i = 0; i < steps; i++) {
      const t = startTime + (i / (steps - 1)) * (now - startTime);
      
      let pnlAtT = 0;
      for (const trade of allTrades) {
        if (!trade.openedAt) continue;
        const openTime = new Date(trade.openedAt).getTime();
        const closeTime = trade.closedAt ? new Date(trade.closedAt).getTime() : now;
        const finalPnl = trade.pnl ?? 0;
        
        if (t >= openTime) {
          if (t >= closeTime) {
            pnlAtT += finalPnl;
          } else {
            const duration = closeTime - openTime;
            const elapsed = t - openTime;
            const pct = duration > 0 ? elapsed / duration : 1;
            pnlAtT += finalPnl * pct;
          }
        }
      }
      
      points.push([t, baseline + pnlAtT]);
    }

    return points;
  }, [allTrades, netWorth, portfolioPnl, balance]);

  return (
    <div className="text-foreground px-[7.5%] py-8 w-full select-none">
      
      {/* Header */}
      <div className="border-b border-border/60 pb-3 mb-6">
        <h1 className="text-[15px] font-semibold text-foreground">Portfolio</h1>
      </div>

      {!isConnected && (
        <div className="py-24 text-center border border-border/50 rounded-2xl flex flex-col items-center gap-4">
          <p className="text-subtle text-[14px]">Connect your wallet to view your portfolio.</p>
          <ConnectButton />
        </div>
      )}

      {isConnected && loading && (
        <div className="space-y-8 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-surface border border-border/60 rounded-2xl px-6 py-5 animate-shimmer">
                <div className="h-3 bg-surface/50 rounded w-20 mb-3" />
                <div className="h-7 bg-surface/50 rounded w-28" />
              </div>
            ))}
          </div>
          <div>
            <div className="h-3 bg-surface/40 rounded w-24 mb-4 animate-shimmer" />
            <div className="flex flex-col gap-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="bg-surface border border-border/60 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-5 animate-shimmer"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="flex items-center gap-3 min-w-[160px]">
                    <div className="w-9 h-9 rounded-full bg-surface/50 flex-shrink-0" />
                    <div className="space-y-2">
                      <div className="h-4 bg-surface/50 rounded w-16" />
                      <div className="h-3 bg-surface/50 rounded w-20" />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-6 flex-grow max-w-md">
                    {[1, 2, 3, 4].map((j) => (
                      <div key={j} className="space-y-2">
                        <div className="h-3 bg-surface/50 rounded w-12" />
                        <div className="h-4 bg-surface/50 rounded w-16" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isConnected && !loading && error && (
        <div className="py-24 text-center text-red-500/60 text-[14px]">{error}</div>
      )}

      {isConnected && !loading && !error && (
        <div className="space-y-6">
          
          {/* Balance and Chart */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-border/60">
            <div>
              <p className="text-[12px] text-muted font-normal uppercase tracking-wider mb-1.5">Total balance</p>
              <div className="flex items-center gap-2">
                <span className="text-[38px] font-bold tracking-tight text-foreground tabular-nums leading-none">
                  ${netWorth.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
                <span className="text-[13px] bg-surface border border-border/80 text-muted font-semibold px-2.5 py-1 rounded-lg select-none">
                  aUSD
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-[14px] font-medium tabular-nums ${portfolioPnl >= 0 ? 'text-emerald-400' : 'text-red-400 font-semibold'}`}>
                  {portfolioPnl >= 0 ? '+' : ''}${portfolioPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                  portfolioPnl >= 0
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}>
                  {portfolioPnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                </span>
                <span className="text-[11px] text-subtle">unrealized</span>
              </div>
            </div>

            {/* Sparkline chart */}
            <div className="w-full md:w-[320px] h-[90px] flex-shrink-0">
              <PortfolioChart points={chartPoints} />
            </div>
          </div>

          {/* Balance breakdown — wallet vs deployed */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Wallet Balance',     value: `${walletBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} aUSD`, color: 'text-foreground' },
              { label: 'Deployed in Agents', value: `${totalLocked.toLocaleString(undefined, { maximumFractionDigits: 2 })} aUSD`,    color: 'text-foreground' },
              { label: 'Active Agents',      value: `${summary?.activeCount ?? 0}`,                                                   color: 'text-accent' },
            ].map((s) => (
              <div key={s.label} className="bg-surface border border-border rounded-2xl px-6 py-5 transition-spring hover:scale-[1.02]">
                <p className="text-[11px] uppercase tracking-widest text-subtle mb-2">{s.label}</p>
                <p className={`text-[22px] font-light tracking-tight tabular-nums ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Holdings or empty state */}
          {holdings.length === 0 ? (
            <div className="py-16 text-center border border-border/50 rounded-2xl bg-card/50">
              <p className="text-subtle text-[14px] mb-1">No open positions yet.</p>
              <p className="text-subtle text-[13px] mb-8">Deploy an agent and wait for the leader&apos;s next move — your holdings will show up here.</p>
              <button
                onClick={() => router.push('/discover')}
                className="rounded-full border border-foreground/[0.18] bg-foreground/[0.03] text-foreground/90 text-[13px] px-5 py-2 hover:bg-foreground/[0.08] hover:border-foreground/40 transition-spring hover:scale-105 active:scale-95 cursor-pointer"
              >
                Discover Leaders
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-[2.5rem_1fr_7rem_7rem_7rem_9rem] gap-4 px-5 mb-2 text-[11px] uppercase tracking-widest text-subtle">
                <span />
                <span>Token</span>
                <span className="text-right">Value</span>
                <span className="text-right">Avg Entry</span>
                <span className="text-right">Current Price</span>
                <span className="text-right">P&amp;L</span>
              </div>
              <div className="flex flex-col gap-2">
                {holdings.map((holding) => (
                  <HoldingCard key={holding.token} holding={holding} />
                ))}
              </div>
            </div>
          )}

          {/* Timeline block */}
          {activityData && activityData.events.length > 0 && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-[13px] font-medium text-muted">Agent Timeline</h2>
                  <p className="text-[11px] text-subtle mt-0.5">Autonomous decisions made across all your agents</p>
                </div>
                <span className="text-[10px] text-subtle/50 uppercase tracking-wider">Powered by Mantle AI</span>
              </div>
              <AgentTimeline events={activityData.events} />
            </div>
          )}
          
        </div>
      )}
    </div>
  );
}

// ── Holding card ──────────────────────────────────────────────────────────────

function HoldingCard({ holding }: { holding: Holding }) {
  const [expanded, setExpanded] = useState(false);
  const pnlColor = holding.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="bg-surface border border-border hover:border-accent/40 rounded-2xl transition-spring hover:scale-[1.01] hover:shadow-md hover:shadow-accent/5 animate-fade-in-up">
      <div
        onClick={() => setExpanded((v) => !v)}
        className="grid grid-cols-[2.5rem_1fr_7rem_7rem_7rem_9rem] gap-4 items-center px-5 py-4 cursor-pointer"
      >
        <TokenBadge token={holding.token} size={32} />

        <div className="min-w-0">
          <p className="text-[14px] font-medium text-foreground">{holding.token}</p>
          <p className="text-[11px] text-subtle">
            {holding.byAgent.length} agent{holding.byAgent.length !== 1 ? 's' : ''} · {holding.byAgent.reduce((s, a) => s + a.positionCount, 0)} position{holding.byAgent.reduce((s, a) => s + a.positionCount, 0) !== 1 ? 's' : ''}
          </p>
        </div>

        <span className="text-right text-[13px] text-foreground/90 tabular-nums">
          ${holding.totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
        <span className="text-right text-[13px] text-muted tabular-nums">
          ${holding.weightedAvgEntry.toFixed(4)}
        </span>
        <span className="text-right text-[13px] text-muted tabular-nums">
          ${holding.currentPrice.toFixed(4)}
        </span>
        <span className={`text-right text-[13px] tabular-nums ${pnlColor}`}>
          {holding.pnlUsd >= 0 ? '+' : ''}{holding.pnlUsd.toFixed(2)} ({holding.pnlPct >= 0 ? '+' : ''}{holding.pnlPct.toFixed(1)}%)
        </span>
      </div>

      {expanded && (
        <div className="border-t border-border/80 px-5 py-3 space-y-2 animate-fade-in-up">
          <p className="text-[10px] uppercase tracking-wider text-subtle mb-1">Held via</p>
          {holding.byAgent.map((a) => (
            <div key={a.leader} className="flex items-center justify-between gap-4 py-1.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar address={a.leader} size={22} />
                <a
                  href={`https://mantlescan.xyz/address/${a.leader}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="font-mono text-[12px] text-foreground/80 hover:text-accent hover:underline decoration-accent/50 transition-colors truncate"
                >
                  {fmt(a.leader)}
                </a>
                <span className="text-[10px] text-subtle">
                  {a.positionCount} position{a.positionCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-5 text-[12px] tabular-nums flex-shrink-0">
                <span className="text-muted">{a.allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })} aUSD</span>
                <span className={a.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {a.pnl >= 0 ? '+' : ''}{a.pnl.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
