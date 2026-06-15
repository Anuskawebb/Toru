'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useAUSD } from '@/hooks/useAUSD';

const EMBEDDED_CLIENT_TYPES = new Set(['privy', 'privy-v2']);

function getSigningInfo(walletClientType?: string) {
  if (!walletClientType) return null;
  if (EMBEDDED_CLIENT_TYPES.has(walletClientType)) {
    return {
      short: 'Signs in Aether',
      detail: 'Embedded wallet (created when you signed in with email/Google). Transaction prompts open in a secure Aether/Privy popup — no browser extension required.',
    };
  }
  const name = walletClientType.charAt(0).toUpperCase() + walletClientType.slice(1).replace(/_/g, ' ');
  return {
    short: `Signs in ${name}`,
    detail: `External wallet — Privy connects to your ${name} extension, so every transaction prompt opens there for you to approve.`,
  };
}

export default function OnboardingModal() {
  const router = useRouter();
  const { ready, authenticated, user } = usePrivy();
  const { balance, canFaucet, faucetPending, claimFaucet, cooldownSeconds } = useAUSD();

  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1);
  
  // Form state
  const [email, setEmail] = useState('');
  const [subscribePending, setSubscribePending] = useState(false);
  const [subscribeErr, setSubscribeErr] = useState<string | null>(null);
  const [subscribeSuccess, setSubscribeSuccess] = useState(false);

  // Email verification (OTP) state — only used when the email isn't already
  // verified by the login provider (i.e. not Google/Privy email login)
  const [emailVerified, setEmailVerified] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeErr, setCodeErr] = useState<string | null>(null);

  // Copy state
  const [copied, setCopied] = useState(false);
  
  // Faucet state
  const [faucetSuccess, setFaucetSuccess] = useState(false);
  const [faucetError, setFaucetError] = useState<string | null>(null);

  const address = user?.wallet?.address;
  const clientType = user?.wallet?.walletClientType;
  const signing = getSigningInfo(clientType);

  // An email already verified by the login provider — Google OAuth or Privy's
  // own email-OTP login — doesn't need to be re-verified here.
  const verifiedEmail = user?.google?.email ?? user?.email?.address ?? null;
  const verifiedVia = user?.google?.email ? 'Google' : user?.email?.address ? 'Privy' : null;
  const isLockedEmail = !!verifiedEmail;
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSubscribe = isValidEmail && (isLockedEmail || emailVerified);

  useEffect(() => {
    if (verifiedEmail) {
      setEmail(verifiedEmail);
      setEmailVerified(true);
    }
  }, [verifiedEmail]);

  useEffect(() => {
    if (ready && authenticated && address) {
      const seen = localStorage.getItem(`aether_onboarding_seen_${address.toLowerCase()}`);
      if (!seen) {
        setIsOpen(true);
      }
    } else {
      setIsOpen(false);
    }
  }, [ready, authenticated, address]);

  if (!isOpen || !address) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendCode = async () => {
    if (!isValidEmail || sendingCode) return;
    setSendingCode(true);
    setCodeErr(null);
    try {
      const res = await fetch('/api/onboarding/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, follower: address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to send code');
      setCodeSent(true);
    } catch (err: any) {
      setCodeErr(err.message ?? 'Failed to send code');
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6 || verifyingCode) return;
    setVerifyingCode(true);
    setCodeErr(null);
    try {
      const res = await fetch('/api/onboarding/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, follower: address, code }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified) throw new Error(data.error ?? 'Verification failed');
      setEmailVerified(true);
    } catch (err: any) {
      setCodeErr(err.message ?? 'Verification failed');
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubscribe) return;

    setSubscribePending(true);
    setSubscribeErr(null);
    setSubscribeSuccess(false);

    try {
      const res = await fetch('/api/onboarding/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, follower: address }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Subscription failed');
      }

      setSubscribeSuccess(true);
      setTimeout(() => {
        setStep(4);
      }, 1200);
    } catch (err: any) {
      setSubscribeErr(err.message ?? 'Failed to subscribe');
    } finally {
      setSubscribePending(false);
    }
  };

  const handleClaimFaucet = async () => {
    setFaucetError(null);
    setFaucetSuccess(false);
    try {
      await claimFaucet();
      setFaucetSuccess(true);
    } catch (err: any) {
      setFaucetError(err?.shortMessage ?? err?.message ?? 'Faucet claim failed');
    }
  };

  const handleComplete = () => {
    localStorage.setItem(`aether_onboarding_seen_${address.toLowerCase()}`, 'true');
    setIsOpen(false);
    router.push('/discover');
  };

  const handleSkip = () => {
    localStorage.setItem(`aether_onboarding_seen_${address.toLowerCase()}`, 'true');
    setIsOpen(false);
  };

  const cooldownH = Math.floor(cooldownSeconds / 3600);
  const cooldownM = Math.ceil((cooldownSeconds % 3600) / 60);
  const cooldownLabel = cooldownH > 0 ? `${cooldownH}h ${cooldownM}m` : `${cooldownM}m`;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-fade-in select-none">
      <div className="bg-card border border-border/80 rounded-2xl p-8 max-w-lg w-full shadow-2xl relative space-y-6 overflow-hidden animate-scale-in">
        
        {/* Step Indicator */}
        <div className="flex justify-between items-center text-xs text-subtle font-mono">
          <span>AETHER ONBOARDING</span>
          <span>STEP {step} OF 4</span>
        </div>

        {/* Carousel indicator bar */}
        <div className="flex gap-1.5 h-1 w-full bg-surface rounded-full overflow-hidden">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`h-full flex-1 transition-all duration-300 ${
                s <= step ? 'bg-accent' : 'bg-surface'
              }`}
            />
          ))}
        </div>

        {/* Slide contents */}
        <div key={step} className="min-h-[200px] flex flex-col justify-center animate-fade-in-up">
          
          {/* Step 1: Welcome & Privy info */}
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-xl font-light text-foreground tracking-tight">Welcome to Aether</h3>
              <p className="text-sm text-muted font-light leading-relaxed">
                Aether automates copy trading on the blockchain. Your account identity has been initialized using Privy.
              </p>
              
              <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
                <span className="text-[10px] uppercase tracking-wider text-subtle block">Your Follower Wallet</span>
                <div className="flex items-center justify-between gap-3 font-mono text-xs text-foreground/80">
                  <span className="truncate">{address}</span>
                  <button
                    onClick={handleCopy}
                    className="flex-shrink-0 text-accent hover:text-accent-hover font-sans text-xs flex items-center gap-1 transition-spring hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-[11px] text-subtle italic mt-1">This is where your testnet funds live.</p>
              </div>

              {signing && (
                <div className="bg-accent/5 border border-accent/10 rounded-xl p-3 text-[12px] text-accent/90 leading-relaxed font-light">
                  <span className="font-semibold block mb-0.5">{signing.short}</span>
                  {signing.detail}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Testnet vs Mainnet */}
          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-xl font-light text-foreground tracking-tight">Mantle Sepolia Testnet & aUSD</h3>
              <p className="text-sm text-muted font-light leading-relaxed">
                The platform is designed to provide automated, on-chain execution with zero financial risk.
              </p>
              <ul className="space-y-2.5 text-xs text-muted font-light">
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-0.5">•</span>
                  <span><strong>Mantle Sepolia Testnet</strong> handles the copy execution, requiring MNT for transaction gas fees.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-0.5">•</span>
                  <span><strong>aUSD (Aether USD)</strong> is a simulated stablecoin. No real USDC is committed or at risk.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-0.5">•</span>
                  <span><strong>Virtual Trades</strong> copy leader moves on-chain. Capital is locked virtually, avoiding any direct market slippage impact.</span>
                </li>
              </ul>
            </div>
          )}

          {/* Step 3: Notifications capture */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-xl font-light text-foreground tracking-tight">Setup Notifications</h3>
              <p className="text-sm text-muted font-light leading-relaxed">
                Enter your email address to receive real-time notifications via Resend when your agent starts or closes copies.
              </p>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] uppercase tracking-wider text-subtle">Email Address</label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    readOnly={isLockedEmail}
                    disabled={isLockedEmail}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setEmailVerified(false);
                      setCodeSent(false);
                      setCode('');
                      setCodeErr(null);
                    }}
                    className={`w-full bg-surface border rounded-xl px-4 py-3 pr-24 text-sm placeholder-subtle focus:outline-none transition-colors ${
                      isLockedEmail
                        ? 'border-border text-muted cursor-not-allowed'
                        : 'border-border text-foreground focus:border-accent/50'
                    }`}
                  />
                  {(isLockedEmail || emailVerified) && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-emerald-400 whitespace-nowrap">
                      ✓ Verified
                    </span>
                  )}
                </div>
                {isLockedEmail && (
                  <p className="text-[11px] text-subtle">
                    This is the email linked to your {verifiedVia} login — already verified, so it can't be edited here.
                  </p>
                )}
              </div>

              {/* OTP verification — only required when we can't already trust the email */}
              {!isLockedEmail && !emailVerified && (
                <div className="space-y-2">
                  {!codeSent ? (
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={!isValidEmail || sendingCode}
                      className="w-full bg-foreground/[0.06] hover:bg-foreground/[0.1] disabled:opacity-40 border border-foreground/10 text-foreground text-xs font-medium py-3 rounded-xl transition-spring hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                    >
                      {sendingCode ? 'Sending code…' : 'Send verification code'}
                    </button>
                  ) : (
                    <form onSubmit={handleVerifyCode} className="space-y-2">
                      <p className="text-[11px] text-subtle">
                        We sent a 6-digit code to <span className="text-foreground/80">{email}</span>.{' '}
                        <button
                          type="button"
                          onClick={handleSendCode}
                          disabled={sendingCode}
                          className="text-accent hover:text-accent-hover cursor-pointer disabled:opacity-40"
                        >
                          Resend
                        </button>
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="6-digit code"
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          className="flex-1 bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-foreground tracking-[0.3em] font-mono placeholder-subtle placeholder:tracking-normal focus:outline-none focus:border-accent/50 transition-colors"
                        />
                        <button
                          type="submit"
                          disabled={code.length !== 6 || verifyingCode}
                          className="bg-accent hover:bg-accent-hover disabled:opacity-40 text-accent-foreground text-xs font-semibold px-5 rounded-xl transition-spring hover:scale-105 active:scale-95 cursor-pointer"
                        >
                          {verifyingCode ? '…' : 'Verify'}
                        </button>
                      </div>
                    </form>
                  )}
                  {codeErr && (
                    <p className="text-xs text-red-400 bg-red-400/5 border border-red-400/20 rounded-xl px-3 py-2">{codeErr}</p>
                  )}
                </div>
              )}

              {emailVerified && !isLockedEmail && (
                <p className="text-xs text-emerald-400 bg-emerald-400/5 border border-emerald-400/20 rounded-xl px-3 py-2">✓ Email verified — you're good to subscribe.</p>
              )}

              <form onSubmit={handleSubscribe} className="space-y-3">
                {subscribeErr && (
                  <p className="text-xs text-red-400 bg-red-400/5 border border-red-400/20 rounded-xl px-3 py-2">{subscribeErr}</p>
                )}
                {subscribeSuccess && (
                  <p className="text-xs text-emerald-400 bg-emerald-400/5 border border-emerald-400/20 rounded-xl px-3 py-2">✓ Opted-in successfully! Loading next step...</p>
                )}
                
                <button
                  type="submit"
                  disabled={!canSubscribe || subscribePending || subscribeSuccess}
                  className="w-full bg-accent hover:bg-accent-hover text-accent-foreground text-xs font-semibold py-3 rounded-xl transition-spring hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:bg-surface disabled:text-subtle disabled:scale-100"
                >
                  {subscribePending ? 'Registering...' : 'Opt-in & Subscribe'}
                </button>
              </form>
            </div>
          )}

          {/* Step 4: Claim faucet & start */}
          {step === 4 && (
            <div className="space-y-4">
              <h3 className="text-xl font-light text-foreground tracking-tight">Fund Your Follower Wallet</h3>
              <p className="text-sm text-muted font-light leading-relaxed">
                Deploying agents requires aUSD balance locked in the smart contract. Claim your first allocation of test stablecoins below.
              </p>

              <div className="bg-surface border border-border rounded-xl p-5 flex flex-col items-center gap-3">
                <span className="text-xs text-muted font-light">Claim 10,000 simulated aUSD instantly</span>
                <button
                  onClick={handleClaimFaucet}
                  disabled={faucetPending || (!canFaucet && !faucetSuccess)}
                  className={`px-6 py-2.5 rounded-full border text-xs font-medium transition-spring ${
                    canFaucet || faucetSuccess
                      ? 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 hover:scale-105 active:scale-95 cursor-pointer'
                      : 'border-border bg-transparent text-subtle cursor-not-allowed'
                  }`}
                >
                  {faucetPending ? 'Claiming in wallet...' : faucetSuccess ? 'Claimed 10,000 aUSD! ✓' : canFaucet ? 'Claim Faucet Tokens' : `Cooldown (${cooldownLabel})`}
                </button>
                {faucetError && (
                  <p className="text-[11px] text-red-400 text-center max-w-xs">{faucetError}</p>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer controls */}
        <div className="flex items-center justify-between border-t border-border/60 pt-4 mt-2">
          {step > 1 ? (
            <button
              onClick={() => setStep(prev => prev - 1)}
              className="text-xs text-subtle hover:text-foreground transition-spring hover:scale-105 active:scale-95 cursor-pointer"
            >
              Back
            </button>
          ) : (
            <button
              onClick={handleSkip}
              className="text-xs text-subtle hover:text-foreground transition-spring hover:scale-105 active:scale-95 cursor-pointer"
            >
              Skip Onboarding
            </button>
          )}

          <div className="flex gap-3">
            {step < 4 ? (
              <button
                onClick={() => setStep(prev => prev + 1)}
                className="bg-accent hover:bg-accent-hover text-accent-foreground text-xs font-semibold px-5 py-2 rounded-lg transition-spring hover:scale-105 active:scale-95 cursor-pointer"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleComplete}
                className="bg-accent hover:bg-accent-hover text-accent-foreground text-xs font-semibold px-5 py-2 rounded-lg transition-spring hover:scale-105 active:scale-95 cursor-pointer"
              >
                Deploy first agent
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

