// ─────────────────────────────────────────────────────────────────────────────
//  Off-chain copy-trade scorer
//
//  This is the Mantle-native replacement for the on-chain LLM "strategist" that
//  used to run on Somnia's Agent Platform. It is a faithful, deterministic port
//  of the exact rules the old on-chain prompt instructed the LLM to follow
//  (see the former VaultManager._buildPrompt): hard skip-rules, risk-level score
//  ceilings, signal-strength base, freshness adjustment, and free-balance
//  penalties. Output is an integer copy-score 0-100, identical in meaning to
//  before — the keeper passes it to executeCopyTrade().
//
//  It can be swapped for a real LLM (Claude) or ORA's on-chain AI oracle later
//  without touching the contract — only this function changes.
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoreInput {
  usdValue:    number; // leader trade size, USD (dollars)
  tradeAgeSec: number; // how old the leader trade is, seconds
  riskLevel:   number; // vault risk tolerance 1-10
  ausdLocked:  number; // vault total, USD (dollars)
  freeBalance: number; // vault free balance, USD (dollars)
}

/** Returns an integer copy-score 0-100. 0 = skip. */
export function scoreTrade(i: ScoreInput): number {
  const { usdValue, tradeAgeSec, riskLevel, ausdLocked, freeBalance } = i;

  // ── Hard rules (apply strictly in order) ─────────────────────────────────
  if (freeBalance < 1)   return 0; // vault empty
  if (tradeAgeSec > 120) return 0; // stale signal
  if (usdValue < 5)      return 0; // noise trade
  if (freeBalance < 10)  return 0; // vault nearly empty

  const tradeVsVaultPct = ausdLocked  > 0 ? (usdValue / ausdLocked)  * 100 : 0;
  const tradeVsFreePct  = freeBalance > 0 ? (usdValue / freeBalance) * 100 : 0;

  if (tradeVsFreePct > 100) return 0; // cannot afford the leader's size

  // ── Signal strength → base score (size vs follower vault, NOT raw $) ──────
  let score: number;
  if (tradeVsVaultPct < 5)        score = 30; // weak signal
  else if (tradeVsVaultPct < 20)  score = 55; // moderate
  else if (tradeVsVaultPct < 50)  score = 75; // strong
  else                            score = 90; // very strong (big leader move)

  // ── Freshness adjustment ─────────────────────────────────────────────────
  if (tradeAgeSec < 10)      score += 10;
  else if (tradeAgeSec > 30) score -= 10; // 30-120s window

  // ── Free-balance penalties ───────────────────────────────────────────────
  if (ausdLocked > 0 && freeBalance < 0.10 * ausdLocked) score *= 0.7;
  if (tradeVsFreePct > 50)                               score *= 0.8;

  // ── Risk-level score ceiling ─────────────────────────────────────────────
  const ceiling =
    riskLevel <= 2 ? 20 :
    riskLevel <= 4 ? 40 :
    riskLevel <= 6 ? 65 :
    riskLevel <= 8 ? 85 : 100;
  if (score > ceiling) score = ceiling;

  // ── Clamp ────────────────────────────────────────────────────────────────
  score = Math.round(score);
  if (score < 0)   score = 0;
  if (score > 100) score = 100;
  return score;
}
