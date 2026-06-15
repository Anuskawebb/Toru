"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ConnectButton from "@/components/ConnectButton";
import AppNavbar from "@/components/AppNavbar";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useAUSD } from "@/hooks/useAUSD";
import Avatar from "@/components/Avatar";

// ── Small reusable components ─────────────────────────────────────────────────

function InfoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-subtle flex-shrink-0">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-subtle hover:text-accent transition-colors cursor-pointer">
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Trader = {
  rank:    number;
  address: string;
  trades:  number;
  volume:  number;
  winRate?: number | null;
  closedPositions?: number;
  totalPnlGenerated?: number;
};

type Trade = {
  id: string;
  leader: string;
  token: string;
  ausdcAllocated: number;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number;
  pnlPct: number;
  status: 'OPEN' | 'CLOSED' | 'SKIPPED';
  reason: string | null;
  openedAt: string;
  closedAt: string | null;
};

type WatcherEvent = {
  type:       'OPENED' | 'CLOSED' | 'SKIPPED';
  follower:   string;
  leader:     string;
  token:      string | null;
  amount:     number | null;
  pnl:        number | null;
  reason:     string | null;
  txHash:     string | null;
  happenedAt: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
const fmtVol  = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M`
  : v >= 1000    ? `$${(v / 1000).toFixed(1)}k`
  : `$${v.toFixed(0)}`;

const timeAgo = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
};

const TokenLogo = ({ symbol }: { symbol: string }) => {
  const sym = symbol.toUpperCase();
  let src = '';
  if (sym === 'WMNT' || sym === 'MNT') src = '/token-logos/WMNT.png';
  else if (sym === 'USDC' || sym === 'USDC.E') src = '/token-logos/USDC.png';
  else if (sym === 'AUSD') src = '/token-logos/aUSD.svg';
  else if (sym === 'USDT') src = '/token-logos/USDT.svg';

  if (src) {
    return (
      <img
        src={src}
        alt={symbol}
        className="w-6 h-6 rounded-full object-cover border border-border bg-surface flex-shrink-0"
        onError={(e) => {
          (e.target as HTMLElement).style.display = 'none';
        }}
      />
    );
  }

  return (
    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-surface to-border border border-border/60 flex items-center justify-center flex-shrink-0 select-none">
      <svg className="w-3.5 h-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8c-2 0-3 1-3 2s1 2 3 2 3 1 3 2-1 2-3 2" />
        <path d="M12 6v12" />
      </svg>
    </div>
  );
};

function PortfolioChart({ points }: { points: [number, number][] }) {
  if (points.length === 0) return null;
  const w = 320, h = 90;
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);

  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);

  // Pad Y-axis range if values are very close or identical (avoiding division by zero/extreme scaling)
  const avg = (minY + maxY) / 2;
  const diff = maxY - minY;
  const minDiff = Math.max(avg * 0.02, 10); // at least 2% of average or 10 units
  if (diff < minDiff) {
    minY = avg - minDiff / 2;
    maxY = avg + minDiff / 2;
  }

  const px = (x: number) => ((x - minX) / (maxX - minX || 1)) * (w - 12) + 6;
  const py = (y: number) => h - 6 - ((y - minY) / (maxY - minY || 1)) * (h - 16);

  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(" ");
  const fd = `${d} L${px(maxX).toFixed(1)},${h} L${px(minX).toFixed(1)},${h} Z`;

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} fill="none" preserveAspectRatio="none">
      <defs>
        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.00" />
        </linearGradient>
      </defs>
      <path d={fd} fill="url(#pg)" />
      <path d={d} stroke="#8B5CF6" strokeWidth="2" fill="none" strokeLinejoin="round" pathLength="1" className="animate-draw-path" />
    </svg>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Home() {
  const router   = useRouter();
  const { authenticated } = usePrivy();
  const { address, isConnected } = useAccount();
  const { balance } = useAUSD();

  const [traders, setTraders] = useState<Trader[]>([]);
  const [portfolioSummary, setPortfolioSummary] = useState<{ totalLocked: number; totalPnl: number } | null>(null);
  const [topTraderWindow, setTopTraderWindow] = useState<'1h' | '6h' | '24h'>('6h');
  const [topTraders, setTopTraders] = useState<Trader[]>([]);
  const [topTradersLoading, setTopTradersLoading] = useState(false);
  const [recentUserTrades, setRecentUserTrades] = useState<Trade[]>([]);
  const [recentTradesLoading, setRecentTradesLoading] = useState(false);
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [platformStats, setPlatformStats] = useState<{ activeAgents: number; ausdLocked: number; totalPositions: number; openPositions: number; tradesEvaluatedToday: number } | null>(null);
  const [activity, setActivity] = useState<WatcherEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  useEffect(() => {
    fetch("/api/traders/leaderboard?window=24h")
      .then((r) => r.json())
      .then((d) => { if (d.traders?.length) setTraders(d.traders); })
      .catch(() => {});
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setPlatformStats)
      .catch(() => {});
    fetch("/api/watcher/activity")
      .then((r) => r.json())
      .then((d) => { if (d.events) setActivity(d.events.slice(0, 5)); })
      .catch(() => {})
      .finally(() => setActivityLoading(false));
  }, []);

  useEffect(() => {
    setTopTradersLoading(true);
    fetch(`/api/traders/leaderboard?window=${topTraderWindow}`)
      .then((r) => r.json())
      .then((d) => { setTopTraders(d.traders?.length ? d.traders.slice(0, 3) : []); })
      .catch(() => {})
      .finally(() => setTopTradersLoading(false));
  }, [topTraderWindow]);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/vaults/${address}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.summary) {
          setPortfolioSummary(d.summary);
        }
      })
      .catch(() => {});
  }, [address]);

  useEffect(() => {
    if (!address) {
      setRecentUserTrades([]);
      setAllTrades([]);
      return;
    }
    setRecentTradesLoading(true);
    fetch(`/api/trades?address=${address}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.trades?.length) {
          setAllTrades(d.trades);
          const executed = (d.trades as Trade[]).filter((t) => t.status !== 'SKIPPED');
          const sorted = [...executed].sort((a, b) => {
            if (a.status === 'OPEN' && b.status !== 'OPEN') return -1;
            if (b.status === 'OPEN' && a.status !== 'OPEN') return 1;
            return new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime();
          });
          setRecentUserTrades(sorted.slice(0, 5));
        }
      })
      .catch(() => {})
      .finally(() => setRecentTradesLoading(false));
  }, [address]);

  const topByWinRate = useMemo(() => {
    return [...traders]
      .filter((t) => (t.closedPositions ?? 0) > 0 && t.winRate != null)
      .sort((a, b) => {
        if (b.winRate !== a.winRate) return (b.winRate ?? 0) - (a.winRate ?? 0);
        return (b.totalPnlGenerated ?? 0) - (a.totalPnlGenerated ?? 0);
      })
      .slice(0, 4);
  }, [traders]);

  const portfolioValue = (portfolioSummary?.totalLocked ?? 0) + (portfolioSummary?.totalPnl ?? 0) + (balance ?? 0);
  const portfolioPnl = portfolioSummary?.totalPnl ?? 0;
  const portfolioPnlPct = (portfolioSummary?.totalLocked ?? 0) > 0 ? (portfolioPnl / portfolioSummary!.totalLocked) * 100 : 0;

  const chartPoints = useMemo(() => {
    const closedTrades = allTrades
      .filter((t) => t.status === 'CLOSED' && t.closedAt)
      .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());

    const displayValue = portfolioValue > 0 ? portfolioValue : (balance ? Number(balance) : 10000);
    const totalRealizedPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const baseline = displayValue - totalRealizedPnl - portfolioPnl;

    const now = Date.now();
    let startTime = now - 24 * 60 * 60 * 1000; // default 24h ago

    const allValidTrades = allTrades.filter(t => t.openedAt);
    if (allValidTrades.length > 0) {
      const firstTradeTime = Math.min(...allValidTrades.map(t => new Date(t.openedAt!).getTime()));
      // Start 24 hours before first trade to display the baseline clearly, or at least 24 hours ago
      startTime = Math.min(firstTradeTime - 24 * 60 * 60 * 1000, now - 24 * 60 * 60 * 1000);
    }

    const steps = 30;
    const points: [number, number][] = [];

    for (let i = 0; i < steps; i++) {
      const t = startTime + (i / (steps - 1)) * (now - startTime);

      // Calculate contribution of each trade at timestamp t
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
            // Linear interpolation of PnL during active trade duration
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
  }, [allTrades, portfolioValue, portfolioPnl, balance]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col select-none">

      {/* ── Navbar ─────────────────────────────────────────────────── */}
      <AppNavbar />

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[6fr_4fr] gap-6 px-[7.5%] pt-8 pb-6 w-full flex-1 overflow-hidden">

        {/* ── Main column (60%) ──────────────────────────────────── */}
        <div className="flex flex-col gap-4 min-w-0 overflow-y-auto" style={{ scrollbarWidth: "none" }}>

          {/* Hero card */}
          <div className="bg-card border border-border/80 rounded-2xl p-6 animate-fade-in-up stagger-1 transition-spring">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h1 className="text-[24px] font-semibold tracking-tight">Aether</h1>
                <p className="text-[13px] text-muted mt-1 max-w-md">
                  Deploy AI agents that copy top traders on Mantle — on-chain, in real time, fully autonomous.
                </p>
              </div>
              <div className="flex -space-x-2 flex-shrink-0">
                {['WMNT', 'USDC', 'AUSD', 'USDT'].map((sym) => (
                  <div key={sym} className="w-8 h-8 rounded-full border-2 border-card overflow-hidden">
                    <TokenLogo symbol={sym} />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              {[
                {
                  l: "Active Agents",
                  v: platformStats ? platformStats.activeAgents.toString() : "…",
                  s: "copy-trading on Mantle",
                },
                {
                  l: "aUSD Under Mgmt",
                  v: platformStats
                    ? platformStats.ausdLocked >= 1000
                      ? `$${(platformStats.ausdLocked / 1000).toFixed(1)}k`
                      : `$${platformStats.ausdLocked.toFixed(0)}`
                    : "…",
                  s: "locked in agent vaults",
                },
                {
                  l: "Positions Opened",
                  v: platformStats ? platformStats.totalPositions.toString() : "…",
                  s: platformStats ? `${platformStats.openPositions} open now` : "loading…",
                },
                {
                  l: "AI Decisions Today",
                  v: platformStats ? (platformStats.tradesEvaluatedToday ?? 0).toString() : "…",
                  s: "leader trades evaluated",
                },
              ].map(({ l, v, s }) => (
                <div key={l}>
                  <div className="flex items-center gap-1 text-[11px] text-subtle mb-1.5"><span>{l}</span><InfoIcon /></div>
                  <div className="text-[28px] font-light tabular-nums tracking-tight">{v}</div>
                  <div className="text-[11px] text-subtle mt-0.5">{s}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Leaders by Win Rate */}
          <div className="bg-card border border-border/80 rounded-2xl p-6 animate-fade-in-up stagger-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground">Top Leaders · Win Rate</h3>
              <Link href="/traders" className="text-[11px] text-accent hover:underline cursor-pointer">
                View all
              </Link>
            </div>
            {traders.length === 0 ? (
              <div className="grid grid-cols-4 gap-2.5">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="bg-surface/60 border border-border rounded-xl p-4 animate-pulse flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="h-3 bg-border/40 rounded w-20" />
                        <div className="w-3.5 h-3.5 bg-border/40 rounded-sm" />
                      </div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <div className="h-4 bg-border/40 rounded w-24" />
                        <div className="h-4 bg-border/40 rounded w-8" />
                      </div>
                    </div>
                    <div>
                      <div className="h-3 bg-border/40 rounded w-16 mb-1.5" />
                      <div className="h-4 bg-border/40 rounded w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : topByWinRate.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-[12px] text-subtle">No closed positions yet — win rates will appear once agents close trades.</p>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2.5">
                {topByWinRate.map((trader) => {
                  const winRate = trader.winRate ?? 0;
                  const winRateColor = winRate >= 50 ? 'text-emerald-400' : winRate >= 30 ? 'text-violet-400' : 'text-red-400';
                  const pnl = trader.totalPnlGenerated ?? 0;
                  return (
                    <div
                      key={trader.address}
                      onClick={() => router.push(`/traders/${trader.address}`)}
                      className="bg-surface/60 border border-border rounded-xl p-4 hover:border-accent/50 hover:shadow-md hover:shadow-accent/5 transition-spring hover:scale-[1.03] active:scale-98 cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] text-subtle uppercase tracking-wider">{trader.closedPositions} closed</span>
                        <CopyIcon />
                      </div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <a
                          href={`https://sepolia.mantlescan.xyz/address/${trader.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-[12px] text-foreground/85 hover:text-accent hover:underline decoration-accent/50 transition-colors"
                        >
                          {fmtAddr(trader.address)}
                        </a>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium bg-current/10 ${winRateColor}`}>{winRate}%</span>
                      </div>
                      <div className="text-[10px] text-subtle uppercase tracking-wider mb-0.5">P&amp;L Generated</div>
                      <div className={`text-[14px] font-semibold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} aUSD
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live Platform Activity */}
          <div className="bg-card border border-border/80 rounded-2xl p-6 animate-fade-in-up stagger-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground">Live Platform Activity</h3>
              <Link href="/watcher" className="text-[11px] text-accent hover:underline cursor-pointer">
                View all
              </Link>
            </div>

            {activityLoading ? (
              <div className="flex flex-col gap-2.5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-[52px] bg-surface/50 border border-border/60 rounded-xl animate-shimmer" style={{ animationDelay: `${i * 60}ms` }} />
                ))}
              </div>
            ) : activity.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-[12px] text-subtle">No agent activity yet — be the first to deploy an agent.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {activity.map((ev, idx) => (
                  <div
                    key={`${ev.txHash}-${ev.type}-${idx}`}
                    className="bg-surface/50 border border-border/60 rounded-xl p-3 flex items-center gap-3"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      ev.type === 'OPENED'
                        ? 'bg-emerald-400 animate-pulse'
                        : ev.type === 'SKIPPED'
                        ? 'bg-violet-400'
                        : 'bg-blue-400'
                    }`} />

                    <div className="w-6 flex-shrink-0">
                      {ev.token ? <TokenLogo symbol={ev.token} /> : <div className="w-6 h-6" />}
                    </div>

                    <div className="flex-1 min-w-0 text-[12px]">
                      <span className="font-mono text-foreground/80">{fmtAddr(ev.follower)}</span>{' '}
                      <span className="text-muted">
                        {ev.type === 'OPENED' && 'opened'}
                        {ev.type === 'CLOSED' && 'closed'}
                        {ev.type === 'SKIPPED' && 'skipped'}
                        {ev.token ? ` a ${ev.token} position` : ' a trade'} copying{' '}
                      </span>
                      <span className="font-mono text-accent">{fmtAddr(ev.leader)}</span>
                    </div>

                    <div className="text-right flex-shrink-0 tabular-nums text-[12px]">
                      {ev.type === 'OPENED' && ev.amount != null && (
                        <span className="text-foreground/80">{ev.amount.toFixed(2)} aUSD</span>
                      )}
                      {ev.type === 'CLOSED' && ev.pnl != null && (
                        <span className={ev.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {ev.pnl >= 0 ? '+' : ''}{ev.pnl.toFixed(2)} aUSD
                        </span>
                      )}
                    </div>

                    <span className="text-subtle text-[11px] whitespace-nowrap flex-shrink-0">{timeAgo(ev.happenedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Sidebar / Right Column (40%) ─────────────────────── */}
        <div className="flex flex-col gap-6 min-w-0 overflow-y-auto" style={{ scrollbarWidth: "none" }}>

          {/* Portfolio Chart Card */}
          <div className="bg-card border border-border/80 rounded-2xl p-5 transition-spring animate-scale-in">
            <div className="flex items-start justify-between mb-1">
              <p className="text-[11px] text-subtle uppercase tracking-wider">Portfolio Value</p>
              {authenticated && (
                <div className="text-[11px] bg-surface border border-border rounded-full px-2.5 py-0.5 text-muted font-normal">
                  Live Equity
                </div>
              )}
            </div>

            {!authenticated ? (
              /* ── Disconnected empty state ── */
              <div className="flex flex-col items-center justify-center py-7 gap-3">
                <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-subtle">
                    <rect x="3" y="11" width="18" height="11" rx="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-[13px] text-foreground/80 font-medium">Your portfolio lives here</p>
                  <p className="text-[11px] text-subtle mt-1">Connect your wallet to see live equity &amp; P&amp;L</p>
                </div>
                <ConnectButton fullWidth />
              </div>
            ) : (
              /* ── Connected state ── */
              <>
                <h2 className="text-[28px] font-light tracking-tight text-foreground tabular-nums mt-1">
                  ${portfolioValue > 0
                    ? portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : balance
                    ? balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : "0.00"}
                </h2>
                <div className="flex items-center gap-1.5 mt-1 mb-4 text-[11px]">
                  <span className={portfolioPnl >= 0 ? "text-emerald-400" : "text-red-400 font-semibold"}>
                    {portfolioPnl >= 0 ? "+" : ""}${portfolioPnl.toFixed(2)} ({portfolioPnlPct >= 0 ? "+" : ""}{portfolioPnlPct.toFixed(1)}%)
                  </span>
                  <span className="text-subtle">Unrealized Profits</span>
                </div>
                <div className="h-[90px] w-full">
                  <PortfolioChart points={chartPoints} />
                </div>
              </>
            )}
          </div>

          {/* Top Traders — windowed */}
          <div className="bg-card border border-border/80 rounded-2xl p-5 transition-spring animate-scale-in stagger-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground">Top Traders</h3>
              {/* Time-window pill switcher */}
              <div className="flex items-center bg-surface/60 border border-border/40 rounded-full p-0.5 gap-0.5">
                {(['1h', '6h', '24h'] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setTopTraderWindow(w)}
                    className={`text-[10px] font-mono uppercase px-2.5 py-1 rounded-full transition-spring cursor-pointer ${
                      topTraderWindow === w
                        ? 'bg-accent text-accent-foreground shadow-sm shadow-accent/20'
                        : 'text-subtle hover:text-foreground'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              {topTradersLoading ? (
                [1, 2, 3].map((i) => (
                  <div key={i} className="h-[52px] bg-surface/50 border border-border/60 rounded-xl animate-shimmer" style={{ animationDelay: `${i * 60}ms` }} />
                ))
              ) : topTraders.length === 0 ? (
                <div className="py-4 text-center">
                  <p className="text-[12px] text-subtle">No active trades in the last {topTraderWindow}.</p>
                </div>
              ) : (
                topTraders.map((trader, i) => (
                  <div
                    key={trader.address}
                    onClick={() => router.push('/traders')}
                    className="bg-surface/50 border border-border/60 rounded-xl p-3 flex items-center justify-between hover:border-accent/40 hover:bg-surface/80 transition-spring hover:scale-[1.02] active:scale-98 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">

                      <Avatar address={trader.address} size={28} />
                      <span className="font-mono text-[12px] text-foreground/80 truncate">
                        {fmtAddr(trader.address)}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-subtle uppercase tracking-wider">{topTraderWindow} Volume</p>
                      <p className="text-[13px] font-semibold tabular-nums text-foreground/90">{fmtVol(trader.volume)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Transaction History */}
          <div className="bg-card border border-border/80 rounded-2xl p-5 transition-spring animate-scale-in stagger-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground">Transaction History</h3>
              {authenticated && recentUserTrades.length > 0 && (
                <Link href="/trades" className="text-[11px] text-accent hover:underline cursor-pointer">
                  View all
                </Link>
              )}
            </div>

            {!authenticated ? (
              <div className="py-6 text-center">
                <p className="text-subtle text-[12px] mb-3">Connect wallet to view transactions.</p>
                <ConnectButton fullWidth />
              </div>
            ) : recentTradesLoading ? (
              <div className="flex flex-col gap-2.5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-[52px] bg-surface/50 border border-border/60 rounded-xl animate-shimmer" style={{ animationDelay: `${i * 60}ms` }} />
                ))}
              </div>
            ) : recentUserTrades.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-[12px] text-subtle">No trades copied yet.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {recentUserTrades.map((trade) => {
                  const isProfit = trade.pnl >= 0;
                  const isOpen   = trade.status === 'OPEN';

                  return (
                    <div
                      key={trade.id}
                      onClick={() => router.push(`/traders/${trade.leader}`)}
                      className={`bg-surface/50 border rounded-xl p-3 flex items-center justify-between hover:bg-surface/80 transition-spring hover:scale-[1.02] active:scale-98 cursor-pointer ${
                        isOpen ? 'border-emerald-500/30 hover:border-emerald-400/50' : 'border-border/60 hover:border-accent/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <TokenLogo symbol={trade.token} />
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-foreground truncate">
                            {trade.token}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10.5px] font-mono text-accent font-medium">
                              {fmtAddr(trade.leader)}
                            </span>
                            <span className="text-[9px] text-border">•</span>
                            {isOpen ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Open
                              </span>
                            ) : (
                              <span className="text-[10px] text-subtle uppercase tracking-wider">Closed</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-[12px] font-semibold tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isProfit ? '+' : ''}{trade.pnl.toFixed(2)} aUSD
                        </p>
                        <p className="text-[10px] text-subtle mt-0.5 tabular-nums">
                          {trade.ausdcAllocated} aUSD
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-[10px] text-subtle text-center leading-relaxed px-1">
            aUSD is locked in a smart contract on Mantle Sepolia Testnet (chain 5003). A keeper executes copy trades on your behalf.
          </p>
        </div>
      </div>
    </div>
  );
}
