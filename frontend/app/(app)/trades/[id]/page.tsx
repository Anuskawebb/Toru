'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import ConnectButton from '@/components/ConnectButton';

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

const fmtAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

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
        className="w-9 h-9 rounded-full object-cover border border-border bg-surface flex-shrink-0"
        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
      />
    );
  }

  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-surface to-border border border-border/60 flex items-center justify-center flex-shrink-0 select-none">
      <svg className="w-5 h-5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8c-2 0-3 1-3 2s1 2 3 2 3 1 3 2-1 2-3 2" />
        <path d="M12 6v12" />
      </svg>
    </div>
  );
};

function CopyField({ value, display }: { value: string; display: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="font-mono text-[13px] text-foreground/90 hover:text-accent transition-colors cursor-pointer inline-flex items-center gap-1.5"
      title="Click to copy"
    >
      {display}
      <span className="text-[10px] text-subtle">{copied ? '✓ copied' : '⧉'}</span>
    </button>
  );
}

function StatBlock({ label, value, valueClassName = '' }: { label: string; value: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="bg-surface border border-border/60 rounded-xl px-4 py-3 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-subtle">{label}</span>
      <span className={`text-[15px] font-medium tabular-nums ${valueClassName}`}>{value}</span>
    </div>
  );
}

function fullDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  });
}

export default function TradeDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { authenticated, user } = usePrivy();
  const isConnected = authenticated && !!user?.wallet?.address;
  const address = user?.wallet?.address;

  const [trade, setTrade] = useState<Trade | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setError(null);
    fetch(`/api/trades?address=${address}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        const found = (data.trades ?? []).find((t: Trade) => t.id === params.id);
        if (!found) {
          setError('Trade not found.');
        } else {
          setTrade(found);
        }
      })
      .catch(() => setError('Failed to load trade.'))
      .finally(() => setLoading(false));
  }, [address, params.id]);

  // For skipped trades, fetch the AI agent's full reasoning from the
  // pipeline activity feed (matched by on-chain requestId).
  useEffect(() => {
    if (!address || !trade || trade.status !== 'SKIPPED') return;
    setExplanationLoading(true);
    fetch(`/api/vaults/${address}/activity?leader=${trade.leader}`)
      .then((r) => r.json())
      .then((data) => {
        const attempt = (data.attempts ?? []).find((a: any) => a.requestId === trade.id);
        setExplanation(attempt?.explanation ?? null);
      })
      .catch(() => setExplanation(null))
      .finally(() => setExplanationLoading(false));
  }, [address, trade]);

  return (
    <div className="text-foreground px-[7.5%] py-8 w-full select-none">
      <button
        onClick={() => router.push('/trades')}
        className="text-[13px] text-subtle hover:text-foreground transition-colors mb-6 inline-flex items-center gap-1.5 cursor-pointer"
      >
        ← Back to trades
      </button>

      {!isConnected && (
        <div className="py-24 text-center border border-border/50 rounded-2xl flex flex-col items-center gap-4 bg-card/50 backdrop-blur-sm">
          <p className="text-subtle text-[14px]">Connect your wallet to view trade details.</p>
          <ConnectButton />
        </div>
      )}

      {isConnected && loading && (
        <div className="space-y-3 animate-fade-in">
          <div className="h-[60px] rounded-2xl border border-border animate-shimmer" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-[64px] rounded-xl border border-border/60 animate-shimmer" style={{ animationDelay: `${i * 45}ms` }} />
            ))}
          </div>
        </div>
      )}

      {isConnected && !loading && error && (
        <div className="py-24 text-center text-red-500/60 text-[14px] bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl">
          {error}
        </div>
      )}

      {isConnected && !loading && !error && trade && (
        <div className="flex flex-col gap-6 animate-fade-in-up">
          {/* Header */}
          <div className="bg-surface border border-border shadow-xl rounded-2xl p-6 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <TokenLogo symbol={trade.token} />
              <div>
                <div className="text-[20px] font-medium tracking-[-0.02em]">{trade.token}</div>
                <div className="text-[12px] text-subtle font-mono truncate max-w-[280px] sm:max-w-none" title={trade.id}>
                  Trade #{trade.id.length > 18 ? `${trade.id.slice(0, 10)}…${trade.id.slice(-6)}` : trade.id}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border uppercase ${
                trade.status === 'OPEN'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : trade.status === 'SKIPPED'
                  ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                  : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  trade.status === 'OPEN'
                    ? 'bg-emerald-400 animate-pulse'
                    : trade.status === 'SKIPPED'
                    ? 'bg-violet-400'
                    : 'bg-blue-400'
                }`} />
                {trade.status.toLowerCase()}
              </span>
              {trade.closeReason === 'STOP_LOSS' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20 uppercase tracking-wide">
                  <span className="w-1 h-1 rounded-full bg-red-400" />
                  Stop-loss close
                </span>
              )}
            </div>
          </div>

          {/* Skip reason banner */}
          {trade.status === 'SKIPPED' && trade.reason && (
            <div className="bg-violet-500/5 border border-violet-500/20 rounded-2xl p-4 flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-wider text-violet-400/80">Skipped by agent</div>
              <div className="text-[14px] text-violet-200">{trade.reason.charAt(0).toUpperCase() + trade.reason.slice(1)}</div>
              {explanationLoading && (
                <div className="text-[13px] text-violet-200/50 flex items-center gap-2 pt-1">
                  <span className="w-3 h-3 rounded-full border-2 border-violet-400/40 border-t-violet-400 animate-spin" />
                  Generating AI analysis…
                </div>
              )}
              {!explanationLoading && explanation && (
                <div className="text-[13px] text-violet-100/80 leading-relaxed pt-1 border-t border-violet-500/10">
                  <span className="text-[10px] uppercase tracking-wider text-violet-400/60 block mb-1">AI analysis</span>
                  {explanation}
                </div>
              )}
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatBlock
              label="Position Size"
              value={trade.status === 'SKIPPED' || trade.ausdcAllocated === 0 ? '—' : `${trade.ausdcAllocated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} aUSD`}
            />
            <StatBlock
              label="Entry Price"
              value={trade.entryPrice === 0 ? '—' : `$${trade.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })}`}
            />
            <StatBlock
              label="Exit Price"
              value={trade.exitPrice && trade.exitPrice > 0 ? `$${trade.exitPrice.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })}` : '—'}
            />
            <StatBlock
              label="P&L"
              value={trade.status === 'SKIPPED' ? '—' : `${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(6)}`}
              valueClassName={trade.status === 'SKIPPED' ? '' : trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <StatBlock
              label="P&L %"
              value={trade.status === 'SKIPPED' ? '—' : `${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(4)}%`}
              valueClassName={trade.status === 'SKIPPED' ? '' : trade.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <StatBlock
              label="Leader"
              value={
                <a
                  href={`https://sepolia.mantlescan.xyz/address/${trade.leader}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono hover:text-accent transition-colors"
                >
                  {fmtAddr(trade.leader)}
                </a>
              }
            />
          </div>

          {/* Timestamps */}
          <div className="bg-surface border border-border/60 rounded-2xl p-5 flex flex-col gap-3">
            <div className="text-[10px] uppercase tracking-wider text-subtle">Timeline</div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-subtle">Opened</span>
              <span className="font-mono">{fullDate(trade.openedAt)}</span>
            </div>
            {trade.closedAt && (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-subtle">Closed</span>
                <span className="font-mono">{fullDate(trade.closedAt)}</span>
              </div>
            )}
          </div>

          {/* Transactions */}
          {(trade.txHashOpen || trade.txHashClose) && (
            <div className="bg-surface border border-border/60 rounded-2xl p-5 flex flex-col gap-3">
              <div className="text-[10px] uppercase tracking-wider text-subtle">Transactions</div>
              {trade.txHashOpen && (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-subtle text-[13px]">{trade.status === 'SKIPPED' ? 'Request tx' : 'Open tx'}</span>
                  <div className="flex items-center gap-3">
                    <CopyField value={trade.txHashOpen} display={fmtAddr(trade.txHashOpen)} />
                    <a
                      href={`https://sepolia.mantlescan.xyz/tx/${trade.txHashOpen}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-accent/70 hover:text-accent transition-colors"
                    >
                      View ↗
                    </a>
                  </div>
                </div>
              )}
              {trade.txHashClose && (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-subtle text-[13px]">Close tx</span>
                  <div className="flex items-center gap-3">
                    <CopyField value={trade.txHashClose} display={fmtAddr(trade.txHashClose)} />
                    <a
                      href={`https://sepolia.mantlescan.xyz/tx/${trade.txHashClose}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-accent/70 hover:text-accent transition-colors"
                    >
                      View ↗
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Agent log link */}
          <a
            href={`/traders/${trade.leader}/manage`}
            className="text-center text-[13px] text-accent/70 hover:text-accent transition-colors py-2"
          >
            View full agent reasoning for this leader →
          </a>
        </div>
      )}
    </div>
  );
}
