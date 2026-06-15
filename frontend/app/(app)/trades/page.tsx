'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import ConnectButton from '@/components/ConnectButton';

// (Type definition remains unchanged)
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
  closeReason: string | null;
  openedAt: string;
  closedAt: string | null;
  txHashOpen: string | null;
  txHashClose: string | null;
};

type SortKey = 'token' | 'leader' | 'ausdcAllocated' | 'entryPrice' | 'exitPrice' | 'pnl' | 'openedAt';

const fmt = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

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

const SortableHeader = ({
  label, sortKey, current, dir, onClick, align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onClick: (key: SortKey) => void;
  align?: 'left' | 'right';
}) => (
  <th
    className={`py-4 px-6 font-medium cursor-pointer select-none hover:text-foreground transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
    onClick={() => onClick(sortKey)}
  >
    <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      {label}
      <span className={`text-[9px] ${current === sortKey ? 'opacity-100' : 'opacity-0'}`}>
        {dir === 'asc' ? '▲' : '▼'}
      </span>
    </span>
  </th>
);

export default function TradesPage() {
  const router = useRouter();
  const { authenticated, user } = usePrivy();
  const isConnected = authenticated && !!user?.wallet?.address;
  const address = user?.wallet?.address;
  const [trades, setTrades] = useState<Trade[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'EXECUTED' | 'OPEN' | 'CLOSED' | 'SKIPPED'>('EXECUTED');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('openedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setError(null);
    fetch(`/api/trades?address=${address}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setTrades(data.trades ?? []);
        }
      })
      .catch((err) => {
        console.error('Failed to load trades:', err);
        setError('Failed to load trades history.');
      })
      .finally(() => setLoading(false));
  }, [address]);

  const filteredTrades = trades.filter((t) => {
    if (filter === 'ALL') return true;
    if (filter === 'EXECUTED') return t.status === 'OPEN' || t.status === 'CLOSED';
    return t.status === filter;
  });

  const sortedTrades = [...filteredTrades].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'token':
      case 'leader':
        cmp = a[sortKey].localeCompare(b[sortKey]);
        break;
      case 'openedAt':
        cmp = new Date(a.openedAt ?? 0).getTime() - new Date(b.openedAt ?? 0).getTime();
        break;
      case 'exitPrice':
        cmp = (a.exitPrice ?? 0) - (b.exitPrice ?? 0);
        break;
      default:
        cmp = a[sortKey] - b[sortKey];
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const openCount    = trades.filter(t => t.status === 'OPEN').length;
  const closedCount  = trades.filter(t => t.status === 'CLOSED').length;
  const skippedCount = trades.filter(t => t.status === 'SKIPPED').length;
  const netPnl       = trades.filter(t => t.status === 'CLOSED').reduce((s, t) => s + t.pnl, 0);

  return (
    <div className="text-foreground px-[7.5%] py-8 w-full select-none">
      {/* Header */}
      <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-[28px] font-light tracking-[-0.04em] text-foreground mb-1">Trades</h1>
          <p className="text-[14px] text-muted font-normal">Real-time copy-trading history and performance.</p>
        </div>

        {/* Filters Switcher */}
        <div className="flex bg-surface/80 border border-border/60 p-1 rounded-full w-fit">
        {(['EXECUTED', 'ALL', 'OPEN', 'CLOSED', 'SKIPPED'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setFilter(opt)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-spring hover:scale-105 active:scale-95 cursor-pointer capitalize ${
                filter === opt
                  ? opt === 'OPEN'
                    ? 'bg-emerald-500/20 text-emerald-300 shadow-md shadow-emerald-500/10'
                    : opt === 'SKIPPED'
                    ? 'bg-amber-500/20 text-amber-300 shadow-md shadow-amber-500/10'
                    : 'bg-accent text-accent-foreground shadow-md shadow-accent/10'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {opt === 'ALL' ? 'All' : opt === 'EXECUTED' ? 'Executed' : opt.charAt(0) + opt.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {!isConnected && (
        <div className="py-24 text-center border border-border/50 rounded-2xl flex flex-col items-center gap-4 bg-card/50 backdrop-blur-sm">
          <p className="text-subtle text-[14px]">Connect your wallet to view your copy trades history.</p>
          <ConnectButton />
        </div>
      )}

      {isConnected && loading && (
        <div className="space-y-4 animate-fade-in">
          <div className="h-[40px] rounded-xl border border-border animate-shimmer" />
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-[70px] border border-border/60 rounded-2xl animate-shimmer" style={{ animationDelay: `${i * 45}ms` }} />
            ))}
          </div>
        </div>
      )}

      {isConnected && error && (
        <div className="py-24 text-center text-red-500/60 text-[14px] bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl">
          {error}
        </div>
      )}

      {isConnected && !loading && !error && trades.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex items-center gap-2 bg-surface border border-border/60 rounded-xl px-4 py-2 text-[12px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-subtle">{openCount} open</span>
            <span className="text-border/60">·</span>
            <span className="text-subtle">{closedCount} closed</span>
            <span className="text-border/60">·</span>
            <span className="text-subtle">{skippedCount} skipped by agent</span>
          </div>
          {closedCount > 0 && (
            <div className={`flex items-center gap-1.5 bg-surface border border-border/60 rounded-xl px-4 py-2 text-[12px] ${netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              <span className="text-subtle">Net P&amp;L</span>
              <span className="font-mono font-medium">{netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {isConnected && !loading && !error && (
        <div className="overflow-hidden">
          {sortedTrades.length === 0 ? (
            <div className="py-24 text-center border border-border/50 rounded-2xl bg-card/50">
              <p className="text-subtle text-[14px] mb-1">No trades found matching this filter.</p>
              <p className="text-subtle text-[13px] mb-8">Follow a leader to execute trades on-chain.</p>
              <button
                onClick={() => router.push('/discover')}
                className="rounded-full border border-foreground/[0.18] bg-foreground/[0.03] text-foreground/90 text-[13px] px-5 py-2 hover:bg-foreground/[0.08] hover:border-foreground/40 transition-spring hover:scale-105 active:scale-95 cursor-pointer"
              >
                Discover Leaders
              </button>
            </div>
          ) : (
            <div className="bg-surface border border-border shadow-xl rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border text-subtle text-[11px] uppercase tracking-wider bg-background/40">
                      <SortableHeader label="Asset" sortKey="token" current={sortKey} dir={sortDir} onClick={toggleSort} />
                      <SortableHeader label="Leader" sortKey="leader" current={sortKey} dir={sortDir} onClick={toggleSort} />
                      <SortableHeader label="Size" sortKey="ausdcAllocated" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                      <SortableHeader label="Entry Price" sortKey="entryPrice" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                      <SortableHeader label="Exit Price" sortKey="exitPrice" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                      <SortableHeader label="P&L" sortKey="pnl" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                      <th className="py-4 px-6 font-medium text-center">Status</th>
                      <SortableHeader label="Date" sortKey="openedAt" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                      <th className="py-4 px-6 font-medium text-center">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 text-[13px]">
                    {sortedTrades.map((trade, idx) => {
                      const isProfit = trade.pnl >= 0;
                      return (
                        <tr
                          key={trade.id}
                          onClick={() => router.push(`/trades/${trade.id}`)}
                          className="cursor-pointer hover:bg-surface/30 hover:text-foreground transition-spring hover:translate-x-0.5 animate-fade-in-up"
                          style={{ animationDelay: `${(idx % 15) * 35}ms` }}
                        >
                          {/* Asset */}
                          <td className="py-4 px-6 font-medium flex items-center gap-2.5">
                            <TokenLogo symbol={trade.token} />
                            <span className="text-foreground font-medium">{trade.token}</span>
                          </td>
                          {/* Leader */}
                          <td className="py-4 px-6 font-mono text-muted">
                            <a
                              href={`https://sepolia.mantlescan.xyz/address/${trade.leader}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-accent-hover transition-colors"
                            >
                              {fmt(trade.leader)}
                            </a>
                          </td>
                          {/* Allocated / Size */}
                          <td className="py-4 px-6 text-right font-medium text-foreground tabular-nums">
                            {trade.status === 'SKIPPED' || trade.ausdcAllocated === 0
                              ? <span className="text-subtle">—</span>
                              : `${trade.ausdcAllocated.toLocaleString(undefined, { minimumFractionDigits: 2 })} aUSD`}
                          </td>
                          {/* Entry Price */}
                          <td className="py-4 px-6 text-right text-muted tabular-nums">
                            {trade.entryPrice === 0
                              ? '—'
                              : `$${trade.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 4 })}`}
                          </td>
                          {/* Exit Price */}
                          <td className="py-4 px-6 text-right text-muted tabular-nums">
                            {trade.exitPrice && trade.exitPrice > 0
                              ? `$${trade.exitPrice.toLocaleString(undefined, { minimumFractionDigits: 4 })}`
                              : '—'}
                          </td>
                          {/* P&L */}
                          <td className="py-4 px-6 text-right font-semibold tabular-nums">
                            {trade.status === 'SKIPPED' ? (
                              <span className="text-subtle">—</span>
                            ) : (
                              <span className={isProfit ? 'text-emerald-400' : 'text-red-400'}>
                                {isProfit ? '+' : ''}
                                ${trade.pnl.toFixed(2)}
                                <span className="text-[11px] font-normal ml-1.5 opacity-80">
                                  ({isProfit ? '+' : ''}
                                  {trade.pnlPct.toFixed(2)}%)
                                </span>
                              </span>
                            )}
                          </td>
                          {/* Status */}
                          <td className="py-4 px-6 text-center">
                            <div className="flex flex-col items-center justify-center gap-1">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border uppercase ${
                                trade.status === 'OPEN'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                  : trade.status === 'SKIPPED'
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                  : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  trade.status === 'OPEN'
                                    ? 'bg-emerald-400 animate-pulse'
                                    : trade.status === 'SKIPPED'
                                    ? 'bg-amber-400'
                                    : 'bg-blue-400'
                                }`} />
                                {trade.status.toLowerCase()}
                              </span>
                              {trade.closeReason === 'STOP_LOSS' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20 uppercase tracking-wide">
                                  <span className="w-1 h-1 rounded-full bg-red-400" />
                                  Stop-loss
                                </span>
                              )}
                              {trade.status === 'SKIPPED' && trade.reason && (
                                <span className="text-[10px] text-amber-400/60 max-w-[140px] text-center leading-tight" title={trade.reason}>
                                  {trade.reason.charAt(0).toUpperCase() + trade.reason.slice(1)}
                                </span>
                              )}
                            </div>
                          </td>
                          {/* Date */}
                          <td className="py-4 px-6 text-right text-subtle whitespace-nowrap">
                            {trade.openedAt ? (
                              new Date(trade.openedAt).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            ) : '—'}
                          </td>
                          {/* Details */}
                          <td className="py-4 px-6 text-center font-medium">
                            <span className="text-accent/60 hover:text-accent transition-colors text-[11px]">
                              View →
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
