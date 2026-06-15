'use client';

import * as React from 'react';
import { useState, use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useVault } from '@/hooks/useVault';
import Avatar from '@/components/Avatar';

type RecentTrade = {
  id:             string;
  token:          string;
  ausdcAllocated: number;
  pnl:            number | null;
  status:         'OPEN' | 'CLOSED' | 'SKIPPED';
  txHashOpen:     string | null;
  openedAt:       string;
  closedAt:       string | null;
};

type LeaderStats = {
  followerCount:     number;
  wmntPrice:        number;
  stats24h: { trades: number; volume: number; buys: number; sells: number };
  lastSeen:          string | null;
  totalProfitYielded?: number;
  winRate:           number | null;
  closedPositions:   number;
  recentSwaps?:      any[];
  recentTrades?:     RecentTrade[];
  activityHeatmap?:  number[];
};

const TokenLogo = ({ symbol }: { symbol: string }) => {
  const sym = symbol.toUpperCase();
  let src = '';
  if (sym === 'WMNT' || sym === 'MNT') src = '/token-logos/WMNT.png';
  else if (sym === 'USDC.E' || sym === 'USDC') src = '/token-logos/USDC.png';
  else if (sym === 'AUSD') src = '/token-logos/aUSD.svg';
  else if (sym === 'USDT') src = '/token-logos/USDT.svg';

  if (src) {
    return (
      <img
        src={src}
        alt={symbol}
        className="w-5 h-5 rounded-full object-cover border border-border bg-surface flex-shrink-0"
        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
      />
    );
  }

  return (
    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-surface to-border border border-border/60 flex items-center justify-center flex-shrink-0 select-none">
      <svg className="w-3.5 h-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8c-2 0-3 1-3 2s1 2 3 2 3 1 3 2-1 2-3 2" />
        <path d="M12 6v12" />
      </svg>
    </div>
  );
};

function fmt(addr: string) { return `${addr.slice(0, 6)}…${addr.slice(-4)}`; }

function fmtSwapTime(timestamp: string | number) {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString();

  const dayMs = 24 * 60 * 60 * 1000;
  const dayDiff = Math.floor((now.setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / dayMs);
  if (dayDiff === 1) return `1d ago`;
  if (dayDiff > 1) return `${dayDiff}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface PageProps {
  params: Promise<{ address: string }> | { address: string };
}

export default function TraderDetailsPage({ params }: PageProps) {
  const resolvedParams  = params instanceof Promise ? use(params) : params;
  const leaderAddress   = resolvedParams.address as `0x${string}`;
  const router          = useRouter();
  const { isConnected } = useAccount();

  const { vaultStatus, lockedBalance } = useVault(leaderAddress);
  const isManaging = (vaultStatus === 'ACTIVE' || vaultStatus === 'PAUSED') && (lockedBalance ?? 0) > 0;

  const [stats,    setStats]    = useState<LeaderStats | null>(null);
  const [statsErr, setStatsErr] = useState(false);
  const [copied,   setCopied]   = useState(false);

  const [inference,        setInference]        = useState<string | null>(null);
  const [inferenceLoading, setInferenceLoading] = useState(true);

  useEffect(() => {
    if (!leaderAddress) return;
    fetch(`/api/traders/${leaderAddress}`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStatsErr(true));
  }, [leaderAddress]);

  useEffect(() => {
    if (!leaderAddress) return;
    fetch(`/api/traders/${leaderAddress}/inference`)
      .then((r) => r.json())
      .then((d) => setInference(d.summary ?? null))
      .catch(() => setInference(null))
      .finally(() => setInferenceLoading(false));
  }, [leaderAddress]);

  const handleCopy = () => {
    navigator.clipboard.writeText(leaderAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const total24h  = (stats?.stats24h.buys ?? 0) + (stats?.stats24h.sells ?? 0);
  const buyPct    = total24h > 0 ? Math.round((stats!.stats24h.buys / total24h) * 100) : 0;
  const vol       = stats?.stats24h.volume ?? 0;
  const volFmt    = vol >= 1000 ? `$${(vol / 1000).toFixed(1)}k` : `$${vol.toFixed(0)}`;
  const profitYielded = stats?.totalProfitYielded ?? 0;
  const profitFmt     = `${profitYielded >= 0 ? '+' : ''}${profitYielded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} aUSD`;

  const ADDRESS_TO_SYMBOL: Record<string, string> = {
    '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8': 'WMNT',
    '0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9': 'USDC',
    '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34': 'USDe',
    '0x201eba5cc46d216ce6dc03f6a759e8e766e956ae': 'USDT',
  };

  const getSymbol = (addr: string) =>
    ADDRESS_TO_SYMBOL[addr.toLowerCase()] ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  const statItems = [
    {
      label: '24h Volume',
      value: statsErr ? '—' : stats ? volFmt : <div className="h-6 w-16 bg-surface/40 rounded animate-shimmer mt-0.5" />,
    },
    {
      label: '24h Trades',
      value: statsErr ? '—' : stats ? String(stats.stats24h.trades) : <div className="h-6 w-10 bg-surface/40 rounded animate-shimmer mt-0.5" />,
    },
    {
      label: 'Buy %',
      value: statsErr ? '—' : stats ? `${buyPct}%` : <div className="h-6 w-12 bg-surface/40 rounded animate-shimmer mt-0.5" />,
      color: !stats ? '' : buyPct >= 50 ? 'text-emerald-400' : 'text-red-400',
    },
    {
      label: 'Followers',
      value: statsErr ? '—' : stats ? String(stats.followerCount) : <div className="h-6 w-8 bg-surface/40 rounded animate-shimmer mt-0.5" />,
    },
    {
      label: 'Win Rate',
      value: statsErr ? '—' : stats
        ? (stats.winRate !== null ? `${stats.winRate}%` : '—')
        : <div className="h-6 w-12 bg-surface/40 rounded animate-shimmer mt-0.5" />,
      color: !stats || stats.winRate === null ? 'text-subtle'
        : stats.winRate >= 50 ? 'text-emerald-400'
        : stats.winRate >= 30 ? 'text-violet-400'
        : 'text-red-400',
    },
    {
      label: 'Closed Positions',
      value: statsErr ? '—' : stats ? String(stats.closedPositions) : <div className="h-6 w-8 bg-surface/40 rounded animate-shimmer mt-0.5" />,
    },
  ];

  return (
    <div className="text-foreground px-[7.5%] py-8 w-full select-none space-y-5">

      {/* Back link */}
      <Link
        href="/traders"
        className="text-foreground/40 hover:text-foreground text-sm transition-spring hover:scale-105 active:scale-95 flex items-center gap-2 w-fit"
      >
        <span>←</span> Discover
      </Link>

      {/* ── Hero card: identity + stats + AI analysis ─────────────────────── */}
      <div className="bg-card border border-border/80 rounded-2xl p-6 animate-scale-in transition-spring">

        {/* Top row: avatar / address / action button */}
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div className="flex items-center gap-4">
            <Avatar address={leaderAddress} size={48} />
            <div>
              <div className="text-[10px] text-foreground/30 uppercase tracking-wide mb-1">Copying Leader</div>
              <div className="flex items-center gap-2.5">
                <div
                  onClick={handleCopy}
                  className="font-mono text-[15px] tracking-tight text-foreground/90 hover:text-foreground transition-colors cursor-pointer flex items-center gap-1.5 relative"
                >
                  <span>{fmt(leaderAddress)}</span>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-3.5 h-3.5 text-foreground/40">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-3a2.25 2.25 0 0 0-1.75 3.364M18.75 7.5V18a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 18V7.5M18.75 7.5V5.25A2.25 2.25 0 0 0 16.5 3h-9A2.25 2.25 0 0 0 5.25 5.25V7.5m13.5 0h-13.5" />
                  </svg>
                  {copied && (
                    <span className="absolute -top-8 left-0 bg-accent text-accent-foreground text-[10px] font-medium tracking-wide uppercase px-2 py-0.5 rounded z-50">
                      Copied!
                    </span>
                  )}
                </div>
                <a
                  href={`https://mantlescan.xyz/address/${leaderAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/40 hover:text-accent-hover transition-colors flex items-center"
                  title="View on Explorer"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              </div>
            </div>
          </div>

          {/* Action button — top-right */}
          {isManaging ? (
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-[12px] font-medium text-emerald-400">Agent Active</span>
              </div>
              <button
                onClick={() => router.push(`/traders/${leaderAddress}/manage`)}
                className="rounded-xl bg-accent hover:bg-accent-hover text-accent-foreground text-[12px] font-semibold px-4 py-2 transition-spring hover:scale-[1.02] active:scale-[0.99] cursor-pointer shadow-md shadow-accent/15"
              >
                Manage Agent
              </button>
            </div>
          ) : (
            <button
              onClick={() => router.push(`/traders/${leaderAddress}/deploy`)}
              className="flex-shrink-0 rounded-xl bg-accent hover:bg-accent-hover text-accent-foreground text-[13px] font-semibold px-5 py-2.5 transition-spring hover:scale-[1.02] active:scale-[0.99] cursor-pointer shadow-md shadow-accent/15"
            >
              Copy Trader
            </button>
          )}
        </div>

        {/* Watching banner — shown when the connected user already has an agent on this leader */}
        {isConnected && isManaging && (
          <Link
            href={`/traders/${leaderAddress}/manage`}
            className="mb-6 flex items-center justify-between gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5 text-[12px] text-emerald-400 transition-spring hover:scale-[1.005] active:scale-[0.995]"
          >
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Your agent is actively watching this leader
            </span>
            <span className="font-semibold">Manage →</span>
          </Link>
        )}

        {/* Stats grid — 6 cols on lg, 3 on sm */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 pb-6 border-b border-foreground/[0.05]">
          {statItems.map(({ label, value, color }) => (
            <div key={label}>
              <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">{label}</div>
              <div className={`text-lg font-light tabular-nums ${color ?? 'text-foreground'}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Total Profits — full-width accent row */}
        <div className="flex items-center gap-3 pt-4 pb-5 border-b border-foreground/[0.05]">
          <div className="text-[10px] uppercase tracking-wider text-foreground/40">Total Profits Copy-Traded</div>
          <div className={`text-[18px] font-light tabular-nums ${profitYielded >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {statsErr ? '—' : stats ? profitFmt : <div className="h-6 w-28 bg-surface/40 rounded animate-shimmer" />}
          </div>
        </div>

        {/* AI Analysis — inside the same card */}
        <div className="pt-5">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-[10px] uppercase tracking-wider text-foreground/40">Analysis Generated</span>
          </div>
          {inferenceLoading ? (
            <div className="space-y-2">
              <div className="h-3 w-full bg-surface/40 rounded animate-shimmer" />
              <div className="h-3 w-[85%] bg-surface/40 rounded animate-shimmer" />
              <div className="h-3 w-[55%] bg-surface/40 rounded animate-shimmer" />
            </div>
          ) : inference ? (
            <p className="text-[13px] text-muted leading-relaxed font-light">{inference}</p>
          ) : (
            <p className="text-[13px] text-subtle leading-relaxed font-light">
              Not enough on-chain history yet to generate an analysis for this trader.
            </p>
          )}
        </div>

        <p className="text-foreground/25 text-[11px] leading-relaxed mt-5">
          Activity recorded on Mantle Mainnet. Copying occurs on Mantle Sepolia Testnet (chain 5003) using aUSD.
        </p>
      </div>

      {/* ── Leader Swaps ──────────────────────────────────────────────────── */}
      <div className="bg-card border border-border/80 rounded-2xl p-5 space-y-4 animate-fade-in-up">
        <div className="border-b border-border/60 pb-2.5">
          <h3 className="text-[13px] font-medium text-muted">Leader Swaps</h3>
          <p className="text-[11px] text-subtle mt-0.5">Actual swaps executed by the leader on Mantle Mainnet pools.</p>
        </div>

        {!stats?.recentSwaps || stats.recentSwaps.length === 0 ? (
          <p className="text-[12px] text-subtle">No mainnet swaps observed yet for this leader address.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {stats.recentSwaps.map((s) => (
              <div key={s.id} className="px-3 py-2.5 bg-surface/50 border border-border rounded-xl flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                      s.side === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    }`}>
                      {s.side}
                    </span>
                    <span className="text-[12px] text-muted font-semibold">
                      {s.side === 'BUY' ? getSymbol(s.tokenOut) : getSymbol(s.tokenIn)}
                    </span>
                  </div>
                  <p className="text-[10px] text-subtle mt-1">
                    Value: ${s.usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} · Price: ${s.wmntPrice.toFixed(4)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-subtle block">{fmtSwapTime(s.timestamp)}</span>
                  {s.txHash && (
                    <a
                      href={`https://mantlescan.xyz/tx/${s.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-subtle hover:text-accent-hover inline-flex items-center gap-0.5 mt-0.5"
                    >
                      Tx
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Recent Copy Activity ──────────────────────────────────────────── */}
      {stats?.recentTrades && stats.recentTrades.length > 0 && (
        <div className="bg-card border border-border/80 rounded-2xl p-5 space-y-4 animate-fade-in-up">
          <div className="border-b border-border/60 pb-2.5">
            <h3 className="text-[13px] font-medium text-muted">Recent Copy Activity</h3>
            <p className="text-[11px] text-subtle mt-0.5">Positions opened by followers copying this leader.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {stats.recentTrades.slice(0, 8).map((t) => {
              const isProfit = (t.pnl ?? 0) >= 0;
              return (
                <div key={t.id} className="px-3 py-2.5 bg-surface/50 border border-border rounded-xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                      t.status === 'OPEN'   ? 'bg-emerald-500/10 text-emerald-400' :
                      t.status === 'CLOSED' ? 'bg-blue-500/10 text-blue-400' :
                                              'bg-violet-500/10 text-violet-400'
                    }`}>{t.status.toLowerCase()}</span>
                    <span className="text-[12px] text-muted font-semibold">{t.token}</span>
                    <span className="text-[11px] text-subtle">{t.ausdcAllocated.toFixed(1)} aUSD</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {t.pnl !== null && t.status === 'CLOSED' && (
                      <span className={`text-[12px] font-semibold tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isProfit ? '+' : ''}{t.pnl.toFixed(2)}
                      </span>
                    )}
                    <span className="text-[10px] text-subtle">
                      {new Date(t.openedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                    {t.txHashOpen && (
                      <a
                        href={`https://sepolia.mantlescan.xyz/tx/${t.txHashOpen}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-subtle hover:text-accent-hover"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 24h Activity Heatmap ─────────────────────────────────────────── */}
      {stats?.activityHeatmap && stats.activityHeatmap.some((c) => c > 0) && (
        <div className="bg-card border border-border/80 rounded-2xl p-5 space-y-3 animate-fade-in-up">
          <div className="border-b border-border/60 pb-2.5">
            <h3 className="text-[13px] font-medium text-muted">24h Activity</h3>
            <p className="text-[11px] text-subtle mt-0.5">Trades per hour over the last day.</p>
          </div>
          <div className="flex items-end gap-1">
            {stats.activityHeatmap.map((count, i) => {
              const max = Math.max(...stats.activityHeatmap!, 1);
              const intensity = count === 0 ? 0 : 0.25 + 0.75 * (count / max);
              const hoursAgo = 23 - i;
              return (
                <div
                  key={i}
                  className="flex-1 h-8 rounded-sm"
                  style={{
                    backgroundColor: count === 0
                      ? 'var(--color-border)'
                      : `rgba(52, 211, 153, ${intensity})`,
                  }}
                  title={`${count} trade${count === 1 ? '' : 's'} · ${hoursAgo === 0 ? 'this hour' : `${hoursAgo}h ago`}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-subtle">
            <span>24h ago</span>
            <span>now</span>
          </div>
        </div>
      )}

    </div>
  );
}
