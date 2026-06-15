'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import ConnectButton from '@/components/ConnectButton';
import Avatar from '@/components/Avatar';
import TraderAvatar from '@/components/TraderAvatar';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BIO_LENGTH = 280;

type Following = {
  leader:      string;
  status:      string;
  ausdcLocked: number;
  riskLevel:   number;
  since:       string;
};

type Profile = {
  address:       string;
  avatarUrl:     string | null;
  bio:           string | null;
  memberSince:   string | null;
  followerCount: number;
  following:     Following[];
  stats: {
    tradesOpened:  number;
    realizedPnl:   number;
    unrealizedPnl: number;
  };
};

type Trade = {
  id:             string;
  leader:         string;
  token:          string;
  ausdcAllocated: number;
  entryPrice:     number;
  exitPrice:      number | null;
  pnl:            number;
  pnlPct:         number;
  status:         'OPEN' | 'CLOSED';
  openedAt:       string;
  closedAt:       string | null;
};

const fmtAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—';
const pnlColor = (n: number) => (n >= 0 ? 'text-emerald-400' : 'text-red-400');
const pnlFmt   = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)} aUSD`;

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:  'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  PAUSED:  'text-accent border-accent/30 bg-accent/10',
  CLOSED:  'text-subtle border-border bg-surface',
};

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-spin text-foreground">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function StatCard({ label, value, valueClass = 'text-foreground', delayClass = '' }: { label: string; value: string; valueClass?: string; delayClass?: string }) {
  return (
    <div className={`bg-card border border-border/80 rounded-2xl px-5 py-4 transition-spring hover:scale-[1.02] animate-fade-in-up ${delayClass}`}>
      <p className="text-[11px] text-subtle uppercase tracking-wide mb-1.5">{label}</p>
      <p className={`text-[20px] font-light tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}

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
        className="w-7 h-7 rounded-full object-cover border border-border bg-surface flex-shrink-0"
        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-surface to-border border border-border/60 flex items-center justify-center flex-shrink-0 select-none">
      <svg className="w-4 h-4 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8c-2 0-3 1-3 2s1 2 3 2 3 1 3 2-1 2-3 2" />
        <path d="M12 6v12" />
      </svg>
    </div>
  );
};

export default function ProfilePage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { logout } = usePrivy();

  const [profile, setProfile]   = useState<Profile | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const [openTrades, setOpenTrades]       = useState<Trade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);

  const [avatarUrl, setAvatarUrl]   = useState<string | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [photoErr, setPhotoErr]     = useState<string | null>(null);

  const [bioDraft, setBioDraft]     = useState('');
  const [editingBio, setEditingBio] = useState(false);
  const [savingBio, setSavingBio]   = useState(false);
  const [bioErr, setBioErr]         = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setError(null);
    fetch(`/api/profile/${address}`)
      .then((r) => r.json())
      .then((d: Profile) => {
        setProfile(d);
        setAvatarUrl(d.avatarUrl);
        setBioDraft(d.bio ?? '');
      })
      .catch(() => setError('Failed to load profile.'))
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    if (!address) return;
    setTradesLoading(true);
    fetch(`/api/trades?address=${address}`)
      .then((r) => r.json())
      .then((d) => {
        const open = (d.trades ?? []).filter((t: Trade) => t.status === 'OPEN');
        setOpenTrades(open);
      })
      .catch(() => {})
      .finally(() => setTradesLoading(false));
  }, [address]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !address) return;

    setPhotoErr(null);
    if (!file.type.startsWith('image/')) { setPhotoErr('Please choose an image file'); return; }
    if (file.size > MAX_FILE_BYTES)       { setPhotoErr('Image must be smaller than 5MB'); return; }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    objectUrlRef.current = previewUrl;
    setAvatarUrl(previewUrl);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('address', address);
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      setAvatarUrl(data.avatarUrl);
    } catch (err: any) {
      setPhotoErr(err.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveBio = async () => {
    if (!address) return;
    setSavingBio(true);
    setBioErr(null);
    try {
      const res = await fetch('/api/profile/bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, bio: bioDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save bio');
      setProfile((p) => (p ? { ...p, bio: data.bio } : p));
      setBioDraft(data.bio ?? '');
      setEditingBio(false);
    } catch (err: any) {
      setBioErr(err.message ?? 'Failed to save bio');
    } finally {
      setSavingBio(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="text-foreground px-[7.5%] py-8 w-full select-none">
        <div className="py-24 text-center border border-border/50 rounded-2xl flex flex-col items-center gap-4">
          <p className="text-subtle text-[14px]">Connect your wallet to view your profile.</p>
          <ConnectButton />
        </div>
      </div>
    );
  }

  return (
    <div className="text-foreground px-[7.5%] py-8 w-full select-none">
      <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
          <h1 className="text-[28px] font-light tracking-[-0.04em] text-foreground mb-1">Profile</h1>
          <p className="text-[14px] text-muted font-normal">Your identity, follow graph, and copy-trading record.</p>
        </div>
        <button
          onClick={logout}
          className="rounded-full border border-foreground/[0.18] bg-foreground/[0.03] text-foreground/90 text-[13px] px-5 py-2 hover:bg-foreground/[0.08] hover:border-foreground/40 transition-spring hover:scale-105 active:scale-95 cursor-pointer self-start md:self-auto"
        >
          Disconnect Wallet
        </button>
      </div>

      {loading && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-card border border-border/80 rounded-2xl p-6 animate-shimmer h-[140px]" />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-card border border-border/80 rounded-2xl px-5 py-4 animate-shimmer h-[80px]" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="py-24 text-center text-red-500/60 text-[14px]">{error}</div>
      )}

      {!loading && !error && profile && address && (
        <div className="space-y-6">

          {/* Identity card */}
          <div className="bg-card border border-border/80 rounded-2xl p-6 flex flex-col sm:flex-row gap-6 animate-fade-in-up stagger-1 transition-spring">
            <div className="relative w-20 h-20 flex-shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-20 h-20 rounded-full object-cover border border-border" />
              ) : (
                <Avatar address={address} size={80} />
              )}
              {uploading && (
                <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                  <Spinner />
                </div>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-accent hover:bg-accent-hover text-accent-foreground flex items-center justify-center text-[13px] transition-spring hover:scale-110 active:scale-90 cursor-pointer shadow-md"
                aria-label={avatarUrl ? 'Change photo' : 'Add photo'}
                title={avatarUrl ? 'Change photo' : 'Add photo'}
              >
                +
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-[18px] font-mono text-foreground">{fmtAddr(address)}</h2>
                <span className="text-[11px] text-subtle">Member since {fmtDate(profile.memberSince)}</span>
              </div>
              {photoErr && <p className="text-[11px] text-red-400 mt-1">{photoErr}</p>}

              <div className="mt-3">
                {editingBio ? (
                  <div className="space-y-2">
                    <textarea
                      value={bioDraft}
                      onChange={(e) => setBioDraft(e.target.value)}
                      maxLength={MAX_BIO_LENGTH}
                      rows={3}
                      placeholder="Tell other traders about yourself…"
                      className="w-full resize-none bg-surface border border-border rounded-xl px-3 py-2 text-[13px] text-foreground placeholder:text-subtle focus:outline-none focus:border-accent/50 transition-colors"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-subtle">{bioDraft.length}/{MAX_BIO_LENGTH}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { setEditingBio(false); setBioDraft(profile.bio ?? ''); setBioErr(null); }}
                          className="text-[12px] text-subtle hover:text-foreground border border-border rounded-full px-3 py-1.5 transition-spring hover:scale-105 active:scale-95 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveBio}
                          disabled={savingBio}
                          className="text-[12px] text-accent-foreground bg-accent hover:bg-accent-hover rounded-full px-3 py-1.5 transition-spring hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50 disabled:scale-100"
                        >
                          {savingBio ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                    {bioErr && <p className="text-[11px] text-red-400">{bioErr}</p>}
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    {profile.bio ? (
                      <p className="text-[13px] text-muted leading-relaxed flex-1">{profile.bio}</p>
                    ) : (
                      <p className="text-[13px] text-subtle italic flex-1">No bio yet.</p>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingBio(true)}
                      className="text-[11px] text-accent hover:text-accent-hover transition-spring hover:scale-105 active:scale-95 cursor-pointer flex-shrink-0"
                    >
                      {profile.bio ? 'Edit' : 'Add bio'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <StatCard label="Followers"      value={String(profile.followerCount)} delayClass="stagger-2" />
            <StatCard label="Following"      value={String(profile.following.length)} delayClass="stagger-3" />
            <StatCard label="Trades opened"  value={String(profile.stats.tradesOpened)} delayClass="stagger-4" />
            <StatCard label="Realized P&L"   value={pnlFmt(profile.stats.realizedPnl)}   valueClass={pnlColor(profile.stats.realizedPnl)} delayClass="stagger-5" />
            <StatCard label="Unrealized P&L" value={pnlFmt(profile.stats.unrealizedPnl)} valueClass={pnlColor(profile.stats.unrealizedPnl)} delayClass="stagger-6" />
          </div>

          {/* Open Trades */}
          <div className="animate-fade-in-up stagger-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] text-subtle uppercase tracking-wide">
                Open Positions {openTrades.length > 0 && `(${openTrades.length})`}
              </h3>
              {openTrades.length > 0 && (
                <Link href="/trades" className="text-[11px] text-accent hover:underline cursor-pointer">
                  View all →
                </Link>
              )}
            </div>

            {tradesLoading ? (
              <div className="flex flex-col gap-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-[70px] bg-card border border-border/80 rounded-2xl animate-shimmer" style={{ animationDelay: `${i * 60}ms` }} />
                ))}
              </div>
            ) : openTrades.length === 0 ? (
              <div className="bg-card border border-border/80 rounded-2xl py-10 text-center">
                <p className="text-subtle text-[13px] mb-3">No open positions right now.</p>
                <Link href="/discover" className="text-accent hover:text-accent-hover text-[13px] transition-colors">
                  Follow a leader to start copy trading →
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {openTrades.map((trade, idx) => {
                  const isProfit = trade.pnl >= 0;
                  return (
                    <div
                      key={trade.id}
                      onClick={() => router.push(`/traders/${trade.leader}`)}
                      className="bg-card border border-border/80 rounded-2xl px-5 py-4 flex items-center justify-between gap-4 hover:border-accent/50 hover:shadow-md hover:shadow-accent/5 transition-spring hover:scale-[1.01] animate-fade-in-up cursor-pointer"
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <TokenLogo symbol={trade.token} />
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-foreground">{trade.token}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-subtle uppercase tracking-wider">Via</span>
                            <span className="font-mono text-[10.5px] text-accent font-medium">{fmtAddr(trade.leader)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-6 flex-shrink-0">
                        <div className="text-right hidden sm:block">
                          <p className="text-[10px] text-subtle uppercase tracking-wide mb-0.5">Allocated</p>
                          <p className="text-[13px] text-foreground tabular-nums">{trade.ausdcAllocated.toFixed(2)} aUSD</p>
                        </div>
                        <div className="text-right hidden sm:block">
                          <p className="text-[10px] text-subtle uppercase tracking-wide mb-0.5">Entry</p>
                          <p className="text-[13px] text-foreground tabular-nums">${trade.entryPrice > 0 ? trade.entryPrice.toFixed(4) : '—'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-subtle uppercase tracking-wide mb-0.5">Unrealized P&L</p>
                          <p className={`text-[13px] font-semibold tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isProfit ? '+' : ''}{trade.pnl.toFixed(2)} aUSD
                            <span className="text-[10px] font-normal opacity-75 ml-1">({isProfit ? '+' : ''}{trade.pnlPct.toFixed(2)}%)</span>
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex-shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          OPEN
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Following list */}
          <div>
            <h3 className="text-[13px] text-subtle uppercase tracking-wide mb-3">
              Following {profile.following.length > 0 && `(${profile.following.length})`}
            </h3>

            {profile.following.length === 0 ? (
              <div className="bg-card border border-border/80 rounded-2xl py-12 text-center">
                <p className="text-subtle text-[13px] mb-3">You aren&apos;t following any leaders yet.</p>
                <Link href="/discover" className="text-accent hover:text-accent-hover text-[13px] transition-colors">
                  Discover traders to copy →
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {profile.following.map((f) => (
                  <Link
                    key={f.leader}
                    href={`/traders/${f.leader}`}
                    className="bg-card border border-border/80 rounded-2xl p-4 flex items-center justify-between gap-4 hover:border-accent/50 hover:shadow-md hover:shadow-accent/5 transition-spring hover:scale-[1.015] animate-fade-in-up"
                    style={{ animationDelay: '120ms' }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <TraderAvatar address={f.leader} size={36} />
                      <div className="min-w-0">
                        <p className="font-mono text-[14px] text-foreground truncate">{fmtAddr(f.leader)}</p>
                        <p className="text-[11px] text-subtle">Following since {fmtDate(f.since)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 flex-shrink-0">
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-subtle uppercase tracking-wide mb-0.5">Locked</p>
                        <p className="text-[13px] text-foreground tabular-nums">{f.ausdcLocked.toFixed(2)} aUSD</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-subtle uppercase tracking-wide mb-0.5">Risk</p>
                        <p className="text-[13px] text-foreground tabular-nums">{f.riskLevel}/10</p>
                      </div>
                      <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${STATUS_STYLES[f.status] ?? STATUS_STYLES.CLOSED}`}>
                        {f.status}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
