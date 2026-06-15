'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Avatar from '@/components/Avatar';

type Trader = {
  rank:              number;
  address:           string;
  trades:            number;
  volume:            number;
  buys:              number;
  sells:             number;
  lastSeen:          string | null;
  winRate:           number | null;
  closedPositions:   number;
  totalPnlGenerated: number;
};

type PlatformStats = {
  activeAgents:  number;
  ausdLocked:    number;
  totalPositions: number;
  openPositions: number;
};

type SortKey = 'volume' | 'trades' | 'buys' | 'winRate' | 'pnl';
const WINDOWS = ['1h', '6h', '24h'] as const;
type Window = typeof WINDOWS[number];

const fmt = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
const timeAgo = (iso: string | null) => {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function TradersPage() {
  const router = useRouter();
  const [traders,       setTraders]       = useState<Trader[]>([]);
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState('');
  const [sortBy,  setSortBy]  = useState<SortKey>('volume');
  const [window,  setWindow]  = useState<Window>('24h');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/traders/leaderboard?window=${window}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setTraders(d.traders ?? []);
      })
      .catch(() => setError('Failed to load traders.'))
      .finally(() => setLoading(false));
  }, [window]);

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((d) => setPlatformStats(d))
      .catch(() => {});
  }, []);

  const visible = traders
    .filter((t) => t.address.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'winRate') {
        // nulls go to the bottom
        if (a.winRate === null && b.winRate === null) return 0;
        if (a.winRate === null) return 1;
        if (b.winRate === null) return -1;
        return b.winRate - a.winRate;
      }
      if (sortBy === 'pnl') {
        return b.totalPnlGenerated - a.totalPnlGenerated;
      }
      return b[sortBy] - a[sortBy];
    });

  const queryAddress = search.trim();
  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(queryAddress);
  const addressAlreadyExists = visible.some(t => t.address.toLowerCase() === queryAddress.toLowerCase());

  return (
    <div className="text-foreground px-[7.5%] py-8 w-full select-none">

      {/* Header */}
      <div className="mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
          <h1 className="text-[28px] font-light tracking-[-0.04em] text-foreground mb-1">Traders</h1>
          <p className="text-[14px] text-muted font-normal">Select a trader, deploy an agent, and start copy-trading on Mantle.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-0.5 bg-surface border border-border rounded-xl p-1">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`px-3 py-1.5 rounded-lg text-[13px] transition-all duration-200 cursor-pointer ${
                  window === w ? 'bg-foreground/10 text-foreground' : 'text-subtle hover:text-muted'
                }`}
              >
                {w}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Search address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-surface border border-border rounded-xl px-4 py-2 text-[13px] text-foreground placeholder-subtle focus:outline-none focus:border-foreground/20 transition-all w-48"
          />

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="bg-surface border border-border rounded-xl px-3 py-2 text-[13px] text-foreground focus:outline-none cursor-pointer"
          >
            <option value="volume"  className="bg-card">Volume</option>
            <option value="trades"  className="bg-card">Trades</option>
            <option value="buys"    className="bg-card">Buys</option>
            <option value="winRate" className="bg-card">Win Rate</option>
            <option value="pnl"     className="bg-card">P&amp;L</option>
          </select>
        </div>
      </div>

      {/* Platform stats bar */}
      {platformStats && (
        <div className="flex flex-wrap gap-3 mb-6">
          {[
            { label: 'Active Agents',         value: platformStats.activeAgents.toString() },
            { label: 'aUSD Under Management', value: platformStats.ausdLocked >= 1000 ? `$${(platformStats.ausdLocked / 1000).toFixed(1)}k` : `$${platformStats.ausdLocked.toFixed(0)}` },
            { label: 'Positions Opened',      value: platformStats.totalPositions.toString() },
            { label: 'Open Now',              value: platformStats.openPositions.toString() },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2 bg-surface border border-border/60 rounded-xl px-4 py-2">
              <span className="text-[11px] text-subtle uppercase tracking-wider">{s.label}</span>
              <span className="text-[13px] font-medium text-foreground tabular-nums">{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Column headers */}
      {!error && (loading || visible.length > 0 || isValidAddress) && (
        <div className="grid grid-cols-[2rem_1fr_6rem_5rem] md:grid-cols-[2rem_1fr_6rem_6rem_5rem_5rem_6rem_6rem] gap-4 px-4 mb-2 text-[11px] uppercase tracking-widest text-subtle">
          <span>#</span>
          <span>Trader</span>
          <span className="text-right">Volume</span>
          <span className="text-right hidden md:block">Trades</span>
          <span className="text-right">Buy %</span>
          <span className="text-right hidden md:block">Win Rate</span>
          <span className="text-right hidden md:block">P&amp;L</span>
          <span className="text-right hidden md:block">Last Active</span>
        </div>
      )}

      {loading && (
        <div className="flex flex-col gap-1">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[2rem_1fr_6rem_5rem] md:grid-cols-[2rem_1fr_6rem_6rem_5rem_5rem_6rem_6rem] gap-4 items-center px-4 py-3.5 rounded-xl border border-transparent animate-fade-in-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="h-4 rounded w-4 animate-shimmer" />
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full animate-shimmer" />
                <div className="h-4 rounded w-24 animate-shimmer" />
              </div>
              <div className="h-4 rounded w-16 ml-auto animate-shimmer" />
              <div className="h-4 rounded w-10 ml-auto animate-shimmer hidden md:block" />
              <div className="h-4 rounded w-10 ml-auto animate-shimmer" />
              <div className="h-4 rounded w-10 ml-auto animate-shimmer hidden md:block" />
              <div className="h-4 rounded w-14 ml-auto animate-shimmer hidden md:block" />
              <div className="h-4 rounded w-14 ml-auto animate-shimmer hidden md:block" />
            </div>
          ))}
        </div>
      )}
      {error && (
        <div className="py-24 text-center text-red-500/60 text-[14px]">{error}</div>
      )}
      {!loading && !error && visible.length === 0 && !isValidAddress && (
        <div className="py-24 text-center border border-foreground/[0.05] rounded-2xl">
          <p className="text-subtle text-[14px] mb-1">No traders detected yet.</p>
          <p className="text-subtle text-[13px]">
            No swaps found on the tracked Mantle pools in the recent window.
          </p>
        </div>
      )}

      {!loading && !error && (visible.length > 0 || isValidAddress) && (
        <div className="flex flex-col gap-1">
          {isValidAddress && !addressAlreadyExists && (
            <div
              key={queryAddress}
              onClick={() => router.push(`/traders/${queryAddress}`)}
              className="grid grid-cols-[2rem_1fr_6rem_5rem] md:grid-cols-[2rem_1fr_6rem_6rem_5rem_5rem_6rem_6rem] gap-4 items-center px-4 py-3.5 rounded-xl border border-dashed border-border bg-surface/10 hover:border-accent/40 hover:bg-surface/20 cursor-pointer transition-spring hover:translate-x-1 animate-fade-in-up"
            >
              <span className="text-[12px] text-subtle tabular-nums">—</span>

              <div className="flex items-center gap-3 min-w-0">
                <Avatar address={queryAddress} size={28} />
                <span className="font-mono text-[13px] text-foreground/80 truncate">
                  {fmt(queryAddress)}
                </span>
              </div>

              <span className="text-right text-[13px] text-subtle tabular-nums">—</span>
              <span className="text-right text-[13px] text-subtle tabular-nums hidden md:block">—</span>
              <span className="text-right text-[13px] text-subtle tabular-nums">—</span>
              <span className="text-right text-[13px] text-subtle tabular-nums hidden md:block">—</span>
              <span className="text-right text-[13px] text-subtle tabular-nums hidden md:block">—</span>
              <span className="text-right text-[12px] text-subtle tabular-nums hidden md:block">—</span>
            </div>
          )}
          {visible.map((trader) => {
            const total    = trader.buys + trader.sells;
            const buyRatio = total > 0 ? Math.round((trader.buys / total) * 100) : 0;
            const winRateColor = trader.winRate === null ? 'text-subtle'
              : trader.winRate >= 50 ? 'text-emerald-400'
              : trader.winRate >= 30 ? 'text-violet-400'
              : 'text-red-400';
            return (
              <div
                key={trader.address}
                onClick={() => router.push(`/traders/${trader.address}`)}
                className="grid grid-cols-[2rem_1fr_6rem_5rem] md:grid-cols-[2rem_1fr_6rem_6rem_5rem_5rem_6rem_6rem] gap-4 items-center px-4 py-3.5 rounded-xl border border-transparent hover:border-accent/30 hover:bg-surface/30 cursor-pointer transition-spring hover:translate-x-1 animate-fade-in-up"
                style={{ animationDelay: `${(trader.rank % 10) * 40}ms` }}
              >
                <span className="text-[12px] text-subtle tabular-nums">{trader.rank}</span>

                <div className="flex items-center gap-3 min-w-0">
                  <Avatar address={trader.address} size={28} />
                  <span className="font-mono text-[13px] text-foreground/80 truncate">
                    {fmt(trader.address)}
                  </span>
                </div>

                <span className="text-right text-[13px] text-foreground/90 tabular-nums font-normal">
                  ${trader.volume >= 1000
                    ? `${(trader.volume / 1000).toFixed(1)}k`
                    : trader.volume.toFixed(0)}
                </span>

                <span className="text-right text-[13px] text-foreground/90 tabular-nums hidden md:block">{trader.trades}</span>

                <span className={`text-right text-[13px] tabular-nums ${buyRatio >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {buyRatio}%
                </span>

                <div className="text-right hidden md:block">
                  {trader.winRate !== null ? (
                    <>
                      <span className={`text-[13px] tabular-nums ${winRateColor}`}>{trader.winRate}%</span>
                      <span className="block text-[10px] text-subtle">{trader.closedPositions} closed</span>
                    </>
                  ) : (
                    <span className="text-[13px] text-subtle">—</span>
                  )}
                </div>

                <span className={`text-right text-[13px] tabular-nums hidden md:block ${
                  trader.totalPnlGenerated > 0 ? 'text-emerald-400'
                    : trader.totalPnlGenerated < 0 ? 'text-red-400'
                    : 'text-subtle'
                }`}>
                  {trader.totalPnlGenerated >= 0 ? '+' : ''}
                  ${Math.abs(trader.totalPnlGenerated) >= 1000
                    ? `${(trader.totalPnlGenerated / 1000).toFixed(1)}k`
                    : trader.totalPnlGenerated.toFixed(2)}
                </span>

                <span className="text-right text-[12px] text-subtle tabular-nums hidden md:block">
                  {timeAgo(trader.lastSeen)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
