'use client';

import * as React from 'react';
import { useState, use, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { keccak256, encodePacked } from 'viem';

const VAULT_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_MANAGER_ADDRESS ?? '') as `0x${string}`;
import { useAUSD } from '@/hooks/useAUSD';
import { useVault } from '@/hooks/useVault';
import Avatar from '@/components/Avatar';

type LeaderStats = {
  followerCount:     number;
  wmntPrice:        number;
  stats24h: { trades: number; volume: number; buys: number; sells: number };
  lastSeen:          string | null;
  totalProfitYielded?: number;
  winRate:           number | null;
  closedPositions:   number;
  vaultStats?: {
    closedCount:  number;
    winRate:      number | null;
    totalPnl:     number;
    openCount:    number;
    avgLatencyMs: number | null;
  } | null;
};

type TradeAttempt = {
  requestId:     string;
  txHash:        string | null;
  detectedAt:    string | null;
  token:         string | null;
  usdValue:      number | null;
  score:         number | null;
  status:        'pending' | 'skipped' | 'opened';
  reason:        string | null;
  ausdAllocated: number | null;
  entryPrice:    number | null;
  explanation:   string | null;
};

function fmt(addr: string) { return `${addr.slice(0, 6)}…${addr.slice(-4)}`; }

function fmtAUSD(n: number | null) {
  if (n === null) return '…';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface PageProps {
  params: Promise<{ address: string }> | { address: string };
}

// ── Agent Activity Logs ──────────────────────────────────────────────────────

function AgentActivityLogs({
  follower,
  leaderAddress,
}: {
  follower?: `0x${string}`;
  leaderAddress: `0x${string}`;
}) {
  const [activity, setActivity]               = useState<TradeAttempt[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [refreshTick, setRefreshTick]         = useState(0);

  useEffect(() => {
    if (!follower) return;
    const id = setInterval(() => setRefreshTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [follower]);

  useEffect(() => {
    if (!follower) return;
    if (refreshTick === 0) setActivityLoading(true);
    fetch(`/api/vaults/${follower}/activity?leader=${leaderAddress}`)
      .then((r) => r.json())
      .then((d) => setActivity(d.attempts ?? []))
      .catch(() => setActivity([]))
      .finally(() => setActivityLoading(false));
  }, [follower, leaderAddress, refreshTick]);

  return (
    <div className="bg-card border border-border/80 rounded-2xl p-5 space-y-4">
      <div className="border-b border-border/60 pb-2.5">
        <h3 className="text-[13px] font-medium text-muted">Agent Activity Logs</h3>
        <p className="text-[11px] text-subtle mt-0.5">Every leader move the agent pipeline evaluated for this agent — and what happened to it.</p>
      </div>

      {activityLoading && <p className="text-[12px] text-subtle">Loading…</p>}
      {!activityLoading && activity.length === 0 && (
        <p className="text-[12px] text-subtle">No copy actions evaluated yet — waiting on the leader&apos;s next move.</p>
      )}

      <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto pr-1">
        {activity.map((a) => (
          <div key={a.requestId} className="px-3 py-2.5 bg-surface/50 border border-border rounded-xl">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[12px] text-muted truncate">
                  {a.token ? `${a.token}${a.usdValue !== null ? ` · $${a.usdValue.toFixed(2)}` : ''}` : 'Trade detected'}
                </span>
                {a.score !== null && !a.explanation && (
                  <span className="text-[10px] text-subtle flex-shrink-0">score {a.score}/100</span>
                )}
              </div>
              <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0 ${
                a.status === 'opened'
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : a.status === 'skipped'
                  ? 'bg-accent/10 text-accent'
                  : 'bg-foreground/[0.05] text-subtle'
              }`}>
                {a.status === 'opened' ? 'Position opened' : a.status === 'skipped' ? 'Skipped' : 'Pending'}
              </span>
            </div>
            {a.explanation ? (
              <p className="text-[11px] text-muted leading-relaxed mt-1">
                {a.explanation}
                {a.score !== null && (
                  <span className="text-[10px] text-subtle ml-2 select-none font-mono" title="Strategist Score">
                    ({a.score}/100)
                  </span>
                )}
              </p>
            ) : (
              <>
                {a.status === 'skipped' && a.reason && (
                  <p className="text-[11px] text-subtle">Why: {a.reason}</p>
                )}
                {a.status === 'opened' && (
                  <p className="text-[11px] text-subtle">
                    Allocated {a.ausdAllocated?.toFixed(2)} aUSD at entry price ${a.entryPrice?.toFixed(4)}
                  </p>
                )}
              </>
            )}
            <div className="flex items-center justify-between mt-1">
              {a.detectedAt ? (
                <p className="text-[10px] text-subtle">{new Date(a.detectedAt).toLocaleString()}</p>
              ) : <span />}
              {a.txHash && (
                <a
                  href={`https://sepolia.mantlescan.xyz/tx/${a.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-subtle hover:text-accent-hover transition-colors flex items-center gap-1 flex-shrink-0"
                  title="Verify this on the Mantle Sepolia block explorer"
                >
                  View on explorer
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-2.5 h-2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Manage Panel ──────────────────────────────────────────────────────────────

function ManageAgent({ leaderAddress }: { leaderAddress: `0x${string}` }) {
  const { address } = useAccount();
  const { balance, canFaucet, cooldownSeconds, faucetPending, claimFaucet } = useAUSD();
  const {
    vaultStatus, lockedBalance, freeBalance, unrealizedPnL,
    openPositionIds, keeperSet,
    depositPending, withdrawPending, closePending,
    deposit, withdraw, closePosition, pauseVault, resumeVault, setKeeperManually,
  } = useVault(leaderAddress);

  const [depositAmt,   setDepositAmt]   = useState('');
  const [depositErr,   setDepositErr]   = useState<string | null>(null);
  const [withdrawErr,  setWithdrawErr]  = useState<string | null>(null);
  const [keeperErr,    setKeeperErr]    = useState<string | null>(null);
  const [closingId,    setClosingId]    = useState<string | null>(null);
  const [toggling,     setToggling]     = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [watcherOnline, setWatcherOnline] = useState<boolean | null>(null);
  const [watcherAgeMs,  setWatcherAgeMs]  = useState<number | null>(null);
  const watcherRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const poll = () => {
      fetch('/api/watcher/status')
        .then((r) => r.json())
        .then((d) => { if (mounted) { setWatcherOnline(d.online); setWatcherAgeMs(d.ageMs); } })
        .catch(() => { if (mounted) setWatcherOnline(false); });
    };
    if (!watcherRef.current) { poll(); watcherRef.current = true; }
    const id = setInterval(poll, 20_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const parsedDeposit = parseFloat(depositAmt) || 0;
  const cooldownH     = Math.floor(cooldownSeconds / 3600);
  const cooldownM     = Math.ceil((cooldownSeconds % 3600) / 60);
  const cooldownLabel = cooldownH > 0 ? `${cooldownH}h ${cooldownM}m` : `${cooldownM}m`;
  const pnlColor      = unrealizedPnL === null ? 'text-foreground'
    : unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400';

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (parsedDeposit <= 0) return;
    setDepositErr(null);
    try { await deposit(parsedDeposit); setDepositAmt(''); }
    catch (err: any) { setDepositErr(err?.shortMessage ?? err?.message ?? 'Deposit failed'); }
  }

  async function handleWithdraw() {
    setShowCloseConfirm(false);
    setWithdrawErr(null);
    try { await withdraw(); }
    catch (err: any) { setWithdrawErr(err?.shortMessage ?? err?.message ?? 'Withdraw failed'); }
  }

  async function handleTogglePause() {
    setToggling(true);
    try {
      if (vaultStatus === 'ACTIVE') await pauseVault();
      else await resumeVault();
    } catch {}
    setToggling(false);
  }

  async function handleClose(posId: `0x${string}`) {
    setClosingId(posId);
    try { await closePosition(posId); } catch {}
    setClosingId(null);
  }

  async function handleSetKeeper() {
    setKeeperErr(null);
    try { await setKeeperManually(); }
    catch (err: any) { setKeeperErr(err?.shortMessage ?? err?.message ?? 'Failed'); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in-up">
    <div className="lg:col-span-5 space-y-4">

      {/* Status + toggle */}
      <div className="bg-card border border-border/80 rounded-2xl px-5 py-4 flex items-center justify-between transition-spring">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${vaultStatus === 'ACTIVE' ? 'bg-emerald-400' : 'bg-accent'}`} />
            <span className={`text-[13px] font-medium ${vaultStatus === 'ACTIVE' ? 'text-emerald-400' : 'text-accent'}`}>
              Agent: {vaultStatus}
            </span>
          </div>
          {/* Watcher heartbeat */}
          {watcherOnline === null ? null : (
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] ${
              watcherOnline && watcherAgeMs !== null && watcherAgeMs < 30_000
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : watcherOnline
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${
                watcherOnline && watcherAgeMs !== null && watcherAgeMs < 30_000
                  ? 'bg-emerald-400 animate-pulse'
                  : watcherOnline
                  ? 'bg-amber-400'
                  : 'bg-red-400'
              }`} />
              <span>
                {watcherOnline
                  ? `Monitor · ${watcherAgeMs !== null && watcherAgeMs < 60_000 ? `${Math.round(watcherAgeMs / 1000)}s ago` : 'active'}`
                  : 'Monitor offline'}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleTogglePause} disabled={toggling}
            className={`rounded-full border text-[12px] px-4 py-1.5 transition-spring hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-40 disabled:scale-100 ${
              vaultStatus === 'ACTIVE'
                ? 'border-accent/40 text-accent hover:border-accent/70'
                : 'border-emerald-500/40 text-emerald-400 hover:border-emerald-500/70'
            }`}>
            {toggling ? '…' : vaultStatus === 'ACTIVE' ? 'Pause Agent' : 'Resume Agent'}
          </button>
        </div>
      </div>

      {/* Keeper notice */}
      {!keeperSet && (
        <div className="bg-accent/5 border border-accent/20 rounded-2xl px-5 py-4 animate-scale-in">
          <p className="text-accent text-[13px] mb-1 font-medium">Agent Keeper Unauthorized</p>
          <p className="text-accent/60 text-[11px] mb-3">
            Authorize the Aether copy-trading execution keeper to manage your agent. Without this, your agent cannot execute copy trades automatically.
          </p>
          {keeperErr && <p className="text-red-400 text-[11px] mb-2">{keeperErr}</p>}
          <button onClick={handleSetKeeper}
            className="rounded-full bg-accent hover:bg-accent-hover text-accent-foreground text-[12px] font-semibold px-4 py-1.5 transition-spring hover:scale-105 active:scale-95 cursor-pointer shadow-md shadow-accent/10">
            Authorize Keeper
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="bg-card border border-border/80 rounded-2xl p-5 grid grid-cols-3 gap-4 transition-spring">
        {[
          { label: 'Agent Capital',  value: `${fmtAUSD(lockedBalance)} aUSD`,  color: 'text-foreground' },
          { label: 'Unused Capital', value: `${fmtAUSD(freeBalance)} aUSD`,    color: 'text-foreground' },
          { label: 'Unrealized P&L', value: `${unrealizedPnL !== null && unrealizedPnL >= 0 ? '+' : ''}${fmtAUSD(unrealizedPnL)} aUSD`, color: pnlColor },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <p className="text-[10px] uppercase tracking-wider text-subtle mb-1">{label}</p>
            <p className={`text-[15px] font-light tabular-nums ${color}`}>{value}</p>
          </div>
        ))}
      </div>

    </div>

    <div className="lg:col-span-7 space-y-4">

      {/* Deposit */}
      <form onSubmit={handleDeposit} className="bg-card border border-border/80 rounded-2xl p-5 space-y-3 transition-spring">
        <div className="flex justify-between items-center">
          <p className="text-[13px] text-foreground font-light">Add Capital to Agent</p>
          <span className="text-[11px] text-subtle">Available: {fmtAUSD(balance)} aUSD</span>
        </div>
        <div className="relative flex items-center">
          <input type="number" min="0" step="any" value={depositAmt}
            onChange={(e) => setDepositAmt(e.target.value)}
            className="w-full bg-foreground/[0.03] border border-border rounded-xl px-4 py-2.5 text-[13px] text-foreground focus:outline-none focus:border-foreground/30 transition-all font-mono"
            placeholder="0.00" />
          <button type="button" onClick={() => setDepositAmt(balance > 0 ? balance.toFixed(2) : '')}
            className="absolute right-3 bg-foreground/10 hover:bg-foreground/20 text-foreground text-[10px] font-medium uppercase tracking-wider px-2.5 py-1 rounded-lg transition-spring hover:scale-105 active:scale-95 cursor-pointer">
            Max
          </button>
        </div>
        {depositErr && <p className="text-[11px] text-red-400">{depositErr}</p>}
        <button type="submit"
          disabled={parsedDeposit <= 0 || parsedDeposit > balance || depositPending}
          className="w-full rounded-xl bg-foreground/[0.06] hover:bg-foreground/10 border border-foreground/10 text-foreground text-[13px] py-2.5 transition-spring hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:scale-100">
          {depositPending ? 'Confirm in wallet…' : 'Add Capital'}
        </button>
      </form>

      {/* Withdraw & Close */}
      <div className="bg-card border border-border/80 rounded-2xl p-5 flex items-center justify-between gap-4 transition-spring">
        <div>
          <p className="text-[13px] text-foreground font-light mb-0.5">Withdraw &amp; Close Vault</p>
          <p className="text-[11px] text-subtle">
            {(openPositionIds?.length ?? 0) > 0
              ? 'Close all positions first'
              : `Withdraws your full free balance (${fmtAUSD(freeBalance)} aUSD) and permanently closes this agent vault.`}
          </p>
          {withdrawErr && <p className="text-[11px] text-red-400 mt-1">{withdrawErr}</p>}
        </div>
        <button onClick={() => setShowCloseConfirm(true)}
          disabled={(openPositionIds?.length ?? 0) > 0 || (freeBalance ?? 0) <= 0 || withdrawPending}
          className="rounded-full border border-foreground/[0.18] text-foreground/80 text-[12px] px-5 py-2 hover:text-foreground hover:border-foreground/30 transition-spring hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap disabled:scale-100">
          {withdrawPending ? 'Confirm…' : 'Withdraw & Close'}
        </button>
      </div>

      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCloseConfirm(false)} />
          <div className="relative bg-card border border-border/80 rounded-2xl p-6 w-full max-w-md space-y-4 animate-scale-in">
            <div>
              <h3 className="text-[17px] font-light tracking-tight text-foreground mb-1">Close this agent vault?</h3>
              <p className="text-[12px] text-foreground/40">
                This withdraws your full free balance ({fmtAUSD(freeBalance)} aUSD) back to your wallet and permanently
                closes this vault — its status becomes <span className="text-foreground/70">CLOSED</span>. To copy-trade
                this leader again later, you&apos;ll need to deploy a new agent with a fresh deposit.
              </p>
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setShowCloseConfirm(false)}
                className="flex-1 rounded-full border border-foreground/[0.18] text-foreground/70 text-[13px] font-light py-2.5 hover:bg-foreground/[0.05] hover:text-foreground transition-spring hover:scale-[1.01] active:scale-[0.99] cursor-pointer">
                Cancel
              </button>
              <button type="button" onClick={handleWithdraw}
                className="flex-1 rounded-full bg-accent text-accent-foreground text-[13px] font-light py-2.5 hover:bg-accent-hover transition-spring hover:scale-[1.01] active:scale-[0.99] cursor-pointer">
                Withdraw & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Positions */}
      {(openPositionIds?.length ?? 0) > 0 && (
        <div className="bg-card border border-border/80 rounded-2xl p-5 space-y-3">
          <p className="text-[11px] uppercase tracking-wider text-subtle">
            Active Positions ({openPositionIds!.length})
          </p>
          <div className="flex flex-col gap-2">
            {openPositionIds!.map((posId) => (
              <div key={posId} className="flex items-center justify-between px-3 py-2.5 bg-surface/50 border border-border rounded-xl">
                <span className="font-mono text-[11px] text-muted">{`${posId.slice(0, 8)}…${posId.slice(-6)}`}</span>
                <button onClick={() => handleClose(posId)}
                  disabled={closingId === posId || closePending}
                  className="rounded-full border border-red-500/30 text-red-400 text-[11px] px-3 py-1 hover:border-red-500/60 transition-all cursor-pointer disabled:opacity-40">
                  {closingId === posId ? '…' : 'Close Position'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Activity Feed */}
      <AgentActivityLogs follower={address} leaderAddress={leaderAddress} />

      {/* Faucet */}
      <div className="bg-card border border-border/80 rounded-2xl px-5 py-4 flex items-center justify-between transition-spring">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-subtle mb-0.5">aUSD Balance</p>
          <p className="text-[15px] font-light tabular-nums text-foreground">
            {fmtAUSD(balance)} <span className="text-subtle text-[12px]">aUSD</span>
          </p>
        </div>
        <button onClick={() => claimFaucet().catch(() => {})} disabled={!canFaucet || faucetPending}
          className="rounded-full border text-[12px] px-4 py-1.5 transition-spring hover:scale-105 active:scale-95 cursor-pointer border-foreground/[0.18] text-foreground/80 hover:text-foreground hover:border-foreground/30 disabled:border-foreground/[0.07] disabled:text-foreground/30 disabled:cursor-not-allowed disabled:scale-100">
          {faucetPending ? 'Claiming…' : canFaucet ? 'Faucet' : cooldownLabel}
        </button>
      </div>

    </div>
    </div>
  );
}

export default function ManageAgentPage({ params }: PageProps) {
  const resolvedParams = params instanceof Promise ? use(params) : params;
  const leaderAddress  = resolvedParams.address as `0x${string}`;
  const { address }    = useAccount();

  const [stats,       setStats]       = useState<LeaderStats | null>(null);
  const [statsErr,    setStatsErr]    = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setRefreshTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!leaderAddress) return;
    const url = address
      ? `/api/traders/${leaderAddress}?follower=${address}`
      : `/api/traders/${leaderAddress}`;
    fetch(url)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStatsErr(true));
  }, [leaderAddress, address, refreshTick]);

  const total24h  = (stats?.stats24h.buys ?? 0) + (stats?.stats24h.sells ?? 0);
  const buyPct    = total24h > 0 ? Math.round((stats!.stats24h.buys / total24h) * 100) : 0;
  const vol       = stats?.stats24h.volume ?? 0;
  const volFmt    = vol >= 1000 ? `$${(vol / 1000).toFixed(1)}k` : `$${vol.toFixed(0)}`;
  const profitYielded = stats?.totalProfitYielded ?? 0;
  const profitFmt     = `${profitYielded >= 0 ? '+' : ''}${profitYielded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} aUSD`;

  // Deterministic on-chain vault address: keccak256(follower, leader) — mirrors
  // VaultManager's vaultIdFor, proving this agent is a real on-chain entity.
  const vaultId = address
    ? keccak256(encodePacked(['address', 'address'], [address as `0x${string}`, leaderAddress]))
    : null;

  return (
    <div className="text-foreground px-[7.5%] py-8 w-full select-none">
      <div className="mb-8">
        <Link href={`/traders/${leaderAddress}`} className="text-foreground/40 hover:text-foreground text-sm transition-spring hover:scale-105 active:scale-95 flex items-center gap-2 w-fit">
          <span>←</span> Back to Trader Profile
        </Link>
      </div>

      <div className="space-y-6">

        {/* Leader summary bar */}
        <div className="bg-card border border-border/80 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center gap-6 transition-spring animate-scale-in">
          <div className="flex items-center gap-3 flex-shrink-0">
            <Avatar address={leaderAddress} size={36} />
            <div>
              <div className="text-[10px] text-foreground/30 uppercase tracking-wide">Copying Leader</div>
              <div className="font-mono text-sm tracking-tight text-foreground/90 mt-0.5">
                {fmt(leaderAddress)}
              </div>
            </div>
          </div>

          <div className="hidden lg:block w-px self-stretch bg-border/60" />

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 flex-1">
            {[
              {
                label: '24h Volume',
                value: statsErr ? '—' : stats ? volFmt : (
                  <div className="h-6 w-16 bg-surface/40 rounded animate-shimmer mt-0.5" />
                )
              },
              {
                label: '24h Trades',
                value: statsErr ? '—' : stats ? String(stats.stats24h.trades) : (
                  <div className="h-6 w-10 bg-surface/40 rounded animate-shimmer mt-0.5" />
                )
              },
              {
                label: 'Buy %',
                value: statsErr ? '—' : stats ? `${buyPct}%` : (
                  <div className="h-6 w-12 bg-surface/40 rounded animate-shimmer mt-0.5" />
                ),
                color: !stats ? '' : buyPct >= 50 ? 'text-emerald-400' : 'text-red-400'
              },
              {
                label: 'Followers',
                value: statsErr ? '—' : stats ? String(stats.followerCount) : (
                  <div className="h-6 w-8 bg-surface/40 rounded animate-shimmer mt-0.5" />
                )
              },
              {
                label: 'Total Profits Copy-Traded',
                value: statsErr ? '—' : stats ? profitFmt : (
                  <div className="h-6 w-24 bg-surface/40 rounded animate-shimmer mt-0.5" />
                ),
                color: !stats ? '' : profitYielded >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">{label}</div>
                <div className={`text-md font-light tabular-nums ${color ?? 'text-foreground'}`}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Your Agent ID — proves this agent is a real on-chain entity */}
        {vaultId && (
          <div className="bg-card/50 border border-border/60 rounded-2xl px-5 py-3 flex items-center gap-2 text-[12px] animate-fade-in-up">
            <span className="text-foreground/40 uppercase tracking-wide text-[10px]">Your Agent ID</span>
            <span className="font-mono text-foreground/80">{fmt(vaultId)}</span>
            <span className="text-foreground/30">on</span>
            <a
              href={`https://sepolia.mantlescan.xyz/address/${VAULT_MANAGER_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-subtle hover:text-accent transition-colors inline-flex items-center gap-1"
              title="View VaultManager contract on explorer"
            >
              VaultManager ↗
            </a>
          </div>
        )}

        {/* Vault-specific performance */}
        {stats?.vaultStats && (stats.vaultStats.closedCount > 0 || stats.vaultStats.openCount > 0) && (
          <div className="bg-card border border-border/80 rounded-2xl p-5 transition-spring">
            <p className="text-[10px] uppercase tracking-wider text-subtle mb-3">Your Agent vs This Leader</p>
            <div className={`grid gap-4 ${stats.vaultStats.avgLatencyMs !== null ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
              {[
                {
                  label: 'Realized P&L',
                  value: `${stats.vaultStats.totalPnl >= 0 ? '+' : ''}${stats.vaultStats.totalPnl.toFixed(2)} aUSD`,
                  color: stats.vaultStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
                },
                {
                  label: 'Win Rate',
                  value: stats.vaultStats.winRate !== null ? `${stats.vaultStats.winRate}%` : '—',
                  color: stats.vaultStats.winRate === null ? 'text-subtle'
                    : stats.vaultStats.winRate >= 50 ? 'text-emerald-400'
                    : stats.vaultStats.winRate >= 30 ? 'text-amber-400'
                    : 'text-red-400',
                },
                {
                  label: 'Positions',
                  value: String(stats.vaultStats.closedCount + stats.vaultStats.openCount),
                  color: 'text-foreground',
                },
                ...(stats.vaultStats.avgLatencyMs !== null ? [{
                  label: 'Avg Execution Lag',
                  value: stats.vaultStats.avgLatencyMs < 1000
                    ? `${stats.vaultStats.avgLatencyMs}ms`
                    : `${(stats.vaultStats.avgLatencyMs / 1000).toFixed(1)}s`,
                  color: 'text-foreground',
                }] : []),
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">{label}</p>
                  <p className={`text-[15px] font-light tabular-nums ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Manage Agent Settings */}
        <ManageAgent leaderAddress={leaderAddress} />

      </div>
    </div>
  );
}
