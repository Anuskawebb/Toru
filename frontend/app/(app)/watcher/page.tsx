'use client';

import { useEffect, useRef, useState } from 'react';

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

type WatcherLog = {
  ts:    number;
  level: 'info' | 'warn' | 'error';
  tag:   string;
  msg:   string;
};

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
        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
      />
    );
  }

  return (
    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-surface to-border border border-border/60 flex items-center justify-center text-[10px] text-muted font-bold uppercase flex-shrink-0 select-none">
      {symbol.slice(0, 2)}
    </div>
  );
};

// Friendly labels for raw watcher log tags.
const TAG_LABELS: Record<string, string> = {
  watcher: 'Scanner',
  pnl:     'Portfolio',
  keeper:  'Executor',
  startup: 'System',
};

// Translates raw watcher console lines into plain-English sentences for
// non-technical viewers, while leaving anything unrecognized untouched.
function humanizeLog(l: WatcherLog): string {
  const msg = l.msg;
  let m: RegExpMatchArray | null;

  // "[on-chain] follower=0xabc… WMNT entry=$0.1061 now=$0.1052 unrealised=$-0.6966 (-0.82%)"
  m = msg.match(/^\[(on-chain|paper)\] follower=(\S+)\s+(\w+)\s+entry=\$([\d.]+)\s+now=\$([\d.]+)\s+unrealised=([+-])\$([\d.]+) \(([+-][\d.]+)%\)$/);
  if (m) {
    const [, kind, follower, token, entry, now, sign, pnl, pct] = m;
    const direction = sign === '-' ? 'down' : 'up';
    const prefix = kind === 'paper' ? 'Paper agent' : 'Agent';
    return `${prefix} ${follower} — ${token} position is ${direction} $${pnl} (${pct}%) · entry $${entry} → now $${now}`;
  }

  if (msg === 'no open on-chain positions') return 'No open positions to monitor right now';

  m = msg.match(/^on-chain positions: (\d+)$/);
  if (m) return `Monitoring ${m[1]} open position${m[1] === '1' ? '' : 's'}`;

  m = msg.match(/^paper positions: (\d+)$/);
  if (m) return `Monitoring ${m[1]} paper position${m[1] === '1' ? '' : 's'}`;

  m = msg.match(/^On-chain leaders: (.+)$/);
  if (m) {
    const count = m[1].split(',').length;
    return `Watching ${count} leader wallet${count === 1 ? '' : 's'} for new trades`;
  }

  m = msg.match(/^Tracking (\d+) leader\(s\) — (\d+) paper \+ (\d+) on-chain$/);
  if (m) {
    const [, total, paper, onchain] = m;
    return `Tracking ${total} leader${total === '1' ? '' : 's'} total — ${onchain} with live agents${Number(paper) > 0 ? `, ${paper} in paper mode` : ''}`;
  }

  m = msg.match(/^(\w+) price: \$([\d.]+)$/);
  if (m) return `${m[1]} price updated — now $${Number(m[2]).toFixed(4)}`;

  m = msg.match(/swap detected — (BUY|SELL) rec=(\S+) \$([\d.]+)/);
  if (m) {
    const [, side, rec, usd] = m;
    return `Detected a $${Number(usd).toFixed(2)} ${side === 'BUY' ? 'buy' : 'sell'} by leader ${rec}`;
  }

  m = msg.match(/TRACKED leader (\S+) — triggering copy pipeline \((BUY|SELL) \$([\d.]+)\)/);
  if (m) {
    const [, leader, side, usd] = m;
    return `Evaluating copy trades for agents following ${leader} (leader ${side === 'BUY' ? 'bought' : 'sold'} $${Number(usd).toFixed(2)})`;
  }

  m = msg.match(/^copy-pipeline dedup skip/);
  if (m) return 'Already evaluated this trade — skipping duplicate';

  m = msg.match(/^keeper dispatch checkLeaderActivity — follower=(\S+)… leader=(\S+)/);
  if (m) return `Checking leader ${m[2]}…'s latest trade for agent ${m[1]}…`;

  m = msg.match(/^checkLeaderActivity follower=(\S+) leader=(\S+)/);
  if (m) return `Checking leader ${m[2]}'s latest trade for agent ${m[1]}`;

  if (/^checkLeaderActivity tx submitted/.test(msg)) return 'Submitting on-chain trade evaluation…';
  if (/^checkLeaderActivity confirmed/.test(msg)) return 'Trade evaluation confirmed on-chain ✓';
  if (/^checkLeaderActivity (failed|REVERTED)/.test(msg) || /^checkLeaderActivity failed/.test(msg)) {
    return /timed out/i.test(msg)
      ? 'Transaction confirmation timed out — will retry automatically'
      : 'Trade evaluation failed — will retry automatically';
  }

  m = msg.match(/^updatePrice token=(\S+)/);
  if (m) return `Refreshing on-chain price for ${m[1]}…`;
  if (/^updatePrice confirmed/.test(msg)) return 'Price feed updated on-chain ✓';
  if (/^updatePrice (failed|REVERTED)/.test(msg)) return 'Price refresh failed — will retry automatically';

  m = msg.match(/^closePosition positionId=(\S+)/);
  if (m) return `Closing position ${m[1]} on-chain…`;
  if (/^closePosition confirmed/.test(msg)) return 'Position closed on-chain ✓';

  m = msg.match(/^STOP-LOSS triggered — follower=(\S+)\s+token=(\S+)\s+drawdown=([\d.]+)%/);
  if (m) return `Stop-loss triggered for agent ${m[1]} — ${m[2]} down ${m[3]}%`;

  if (/^stop-loss: position closed/.test(msg)) return 'Stop-loss closed the position automatically ✓';
  if (/^stop-loss: refreshing/.test(msg)) return 'Refreshing price before stop-loss close…';
  if (/^stop-loss: price confirmed/.test(msg)) return 'Price confirmed — closing position via stop-loss…';

  if (/^P&L updater started/.test(msg)) return 'Portfolio monitor started';

  // Fallback: strip raw bracketed pool labels like "[WMNT/USDC]" for readability.
  return msg.replace(/^\[[\w/]+\]\s*/, '');
}

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

export default function WatcherActivityPage() {
  const [events, setEvents] = useState<WatcherEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [watcherOnline, setWatcherOnline] = useState<boolean | null>(null);
  const [watcherAgeMs,  setWatcherAgeMs]  = useState<number | null>(null);

  const [logs, setLogs] = useState<WatcherLog[]>([]);

  const ref = useRef(false);

  useEffect(() => {
    const poll = () => {
      fetch('/api/watcher/activity')
        .then((r) => r.json())
        .then((d) => { if (d.events) setEvents(d.events); })
        .catch(() => setError('Failed to load watcher activity.'))
        .finally(() => setLoading(false));

      fetch('/api/watcher/status')
        .then((r) => r.json())
        .then((d) => { setWatcherOnline(d.online); setWatcherAgeMs(d.ageMs); })
        .catch(() => setWatcherOnline(false));
    };

    if (!ref.current) { poll(); ref.current = true; }
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const pollLogs = () => {
      fetch('/api/watcher/logs')
        .then((r) => r.json())
        .then((d) => { if (d.logs) setLogs(d.logs); })
        .catch(() => {});
    };
    pollLogs();
    const id = setInterval(pollLogs, 3_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="text-foreground px-[7.5%] py-8 w-full select-none">
      <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-[28px] font-light tracking-[-0.04em] text-foreground mb-1">Watcher Activity</h1>
          <p className="text-[14px] text-muted font-normal">
            A live feed of every decision Aether agents have made on Mantle — opened, closed, and skipped trades.
          </p>
        </div>

        {watcherOnline !== null && (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] self-start md:self-auto ${
            watcherOnline && watcherAgeMs !== null && watcherAgeMs < 30_000
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : watcherOnline
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              watcherOnline && watcherAgeMs !== null && watcherAgeMs < 30_000
                ? 'bg-emerald-400 animate-pulse'
                : watcherOnline
                ? 'bg-amber-400'
                : 'bg-red-400'
            }`} />
            <span>
              {watcherOnline
                ? `Watcher · ${watcherAgeMs !== null && watcherAgeMs < 60_000 ? `checked ${Math.round(watcherAgeMs / 1000)}s ago` : 'active'}`
                : 'Watcher offline'}
            </span>
          </div>
        )}
      </div>

      {/* Live console */}
      <div className="mb-8 bg-[#0a0a0c] border border-border/60 rounded-2xl overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[12px] text-white/70 font-mono">Watcher Console</span>
          </div>
          <span className="text-[11px] text-white/30 font-mono">live · streaming every 3s</span>
        </div>
        <div className="px-5 py-3 max-h-[280px] overflow-y-auto font-mono text-[12px] leading-relaxed">
          {logs.length === 0 ? (
            <p className="text-white/30">Waiting for watcher output…</p>
          ) : (
            logs.map((l, idx) => (
              <div
                key={`${l.ts}-${idx}`}
                className={`whitespace-pre-wrap break-all ${
                  l.level === 'error' ? 'text-red-400'
                    : l.level === 'warn' ? 'text-amber-400'
                    : 'text-white/60'
                } ${idx === 0 ? 'animate-fade-in-up' : ''}`}
              >
                <span className="text-white/25">{new Date(l.ts).toLocaleTimeString()}</span>{' '}
                <span className="text-emerald-400/70">[{TAG_LABELS[l.tag] ?? l.tag}]</span>{' '}
                {humanizeLog(l)}
              </div>
            ))
          )}
        </div>
      </div>

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-[64px] border border-border/60 rounded-2xl animate-shimmer" style={{ animationDelay: `${i * 45}ms` }} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="py-24 text-center text-red-500/60 text-[14px] bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl">
          {error}
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="py-24 text-center border border-border/50 rounded-2xl bg-card/50">
          <p className="text-subtle text-[14px]">No watcher activity yet.</p>
        </div>
      )}

      {!loading && !error && events.length > 0 && (
        <div className="bg-surface border border-border shadow-xl rounded-2xl overflow-hidden">
          <div className="divide-y divide-border/60">
            {events.map((ev, idx) => (
              <div
                key={`${ev.txHash}-${ev.type}-${idx}`}
                className="flex items-center gap-4 px-6 py-4 text-[13px] hover:bg-surface/30 transition-spring animate-fade-in-up"
                style={{ animationDelay: `${(idx % 15) * 35}ms` }}
              >
                {/* Status dot */}
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  ev.type === 'OPENED'
                    ? 'bg-emerald-400 animate-pulse'
                    : ev.type === 'SKIPPED'
                    ? 'bg-amber-400'
                    : 'bg-blue-400'
                }`} />

                {/* Token */}
                <div className="w-6 flex-shrink-0">
                  {ev.token ? <TokenLogo symbol={ev.token} /> : <div className="w-6 h-6" />}
                </div>

                {/* Description */}
                <div className="flex-1 min-w-0">
                  <p className="text-foreground/90">
                    Agent for{' '}
                    <a
                      href={`https://sepolia.mantlescan.xyz/address/${ev.follower}`}
                      target="_blank" rel="noopener noreferrer"
                      className="font-mono text-foreground hover:text-accent-hover transition-colors"
                    >
                      {fmt(ev.follower)}
                    </a>{' '}
                    {ev.type === 'OPENED' && (
                      <>opened a <span className="font-medium">{ev.token}</span> position copying{' '}</>
                    )}
                    {ev.type === 'CLOSED' && (
                      <>closed a <span className="font-medium">{ev.token}</span> position copying{' '}</>
                    )}
                    {ev.type === 'SKIPPED' && <>skipped a trade copying{' '}</>}
                    <a
                      href={`https://sepolia.mantlescan.xyz/address/${ev.leader}`}
                      target="_blank" rel="noopener noreferrer"
                      className="font-mono text-muted hover:text-accent-hover transition-colors"
                    >
                      {fmt(ev.leader)}
                    </a>
                  </p>
                  {ev.type === 'SKIPPED' && ev.reason && (
                    <p className="text-[11px] text-amber-400/70 mt-0.5">{ev.reason}</p>
                  )}
                  {ev.type === 'CLOSED' && ev.reason === 'STOP_LOSS' && (
                    <p className="text-[11px] text-red-400/70 mt-0.5">Closed automatically · stop-loss</p>
                  )}
                </div>

                {/* Amount / P&L */}
                <div className="text-right flex-shrink-0 tabular-nums">
                  {ev.type === 'OPENED' && ev.amount != null && (
                    <span className="text-foreground/80">{ev.amount.toFixed(2)} aUSD</span>
                  )}
                  {ev.type === 'CLOSED' && ev.pnl != null && (
                    <span className={ev.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {ev.pnl >= 0 ? '+' : ''}{ev.pnl.toFixed(2)} aUSD
                    </span>
                  )}
                </div>

                {/* Time + link */}
                <div className="flex items-center gap-3 flex-shrink-0 w-[110px] justify-end">
                  <span className="text-subtle whitespace-nowrap">{timeAgo(ev.happenedAt)}</span>
                  {ev.txHash && (
                    <a
                      href={`https://sepolia.mantlescan.xyz/tx/${ev.txHash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-subtle hover:text-foreground transition-colors"
                      title="View transaction"
                    >
                      ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
