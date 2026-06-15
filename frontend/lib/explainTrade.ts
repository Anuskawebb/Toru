import { prisma } from './prisma';
import { incrDailyStat, STAT_AI_CALLS } from './redis';

export type VaultLimits = {
  slippageBps:       number;
  minLeaderTradeUsd: number;
  maxLeaderTradeUsd: number;
  minAllocUsd:       number;
  maxAllocUsd:       number;
};

const DEFAULT_LIMITS: VaultLimits = {
  slippageBps: 100, minLeaderTradeUsd: 0, maxLeaderTradeUsd: 0, minAllocUsd: 0, maxAllocUsd: 0,
};

// Mirrors VaultManager.MIN_COPY_SCORE — the strategist's score must be at
// least this high (out of 100) for a trade to be copied.
const MIN_COPY_SCORE = 10;

// Renders only the bounds the follower actually configured — omitting "no limit"
// fields keeps the LLM prompt natural instead of cluttered with zeros.
function describeLimits(limits: VaultLimits): string {
  const parts: string[] = [`Slippage Tolerance ${(limits.slippageBps / 100).toFixed(2)}%`];

  if (limits.minLeaderTradeUsd > 0 || limits.maxLeaderTradeUsd > 0) {
    const lo = limits.minLeaderTradeUsd > 0 ? `$${limits.minLeaderTradeUsd.toFixed(2)}` : 'no min';
    const hi = limits.maxLeaderTradeUsd > 0 ? `$${limits.maxLeaderTradeUsd.toFixed(2)}` : 'no max';
    parts.push(`Leader Trade Size Range ${lo}–${hi}`);
  }

  if (limits.minAllocUsd > 0 || limits.maxAllocUsd > 0) {
    const lo = limits.minAllocUsd > 0 ? `$${limits.minAllocUsd.toFixed(2)}` : 'no min';
    const hi = limits.maxAllocUsd > 0 ? `$${limits.maxAllocUsd.toFixed(2)}` : 'no max';
    parts.push(`Allocation Range ${lo}–${hi} aUSD`);
  }

  return parts.join(', ');
}

export async function explainTrade(
  attempt: any,
  riskLevel: number,
  maxPerTradePct: number,
  limits: VaultLimits = DEFAULT_LIMITS
): Promise<string> {
  const requestId = attempt.requestId;
  incrDailyStat(STAT_AI_CALLS);

  // 1. Check database cache first
  try {
    const cached = await prisma.tradeExplanation.findUnique({
      where: { requestId },
    });
    // Guard against empty-string cache entries from a previous broken run
    if (cached?.explanation) {
      console.log(`[explainTrade] cache hit requestId=${requestId}`);
      return cached.explanation;
    }
  } catch (err) {
    console.error('[explainTrade] Database cache fetch error:', err);
  }

  // 2. Fallback check for API keys
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  console.log(`[explainTrade] cache miss requestId=${requestId} status=${attempt.status} gemini=${!!geminiKey} openai=${!!openaiKey}`);

  if (!geminiKey && !openaiKey) {
    const fallback = getDefaultExplanation(attempt, riskLevel, limits);
    console.log(`[explainTrade] no LLM key — using fallback: "${fallback.slice(0, 60)}…"`);
    await saveCache(requestId, fallback);
    return fallback;
  }

  // 3. Construct the prompt
  const prompt = `You are the AI trading agent for Aether, an on-chain copy-trading platform.
Explain in exactly one plain-English sentence why a trade was copied or skipped based on these parameters:
- Leader Trade: ${attempt.side ?? (attempt.status === 'opened' ? 'BUY' : 'Trade')} of token ${attempt.token ?? 'unknown'} (value: $${attempt.usdValue !== null ? attempt.usdValue.toFixed(2) : 'unknown'})
- Action: ${attempt.status === 'opened' ? 'COPIED' : 'SKIPPED'}
- Score: ${attempt.score ?? 'unknown'}/100
- Allocated Capital: ${attempt.ausdAllocated !== null ? `${attempt.ausdAllocated.toFixed(2)} aUSD` : 'none'}
- Entry Price: ${attempt.entryPrice !== null ? `$${attempt.entryPrice.toFixed(4)}` : 'none'}
- Resolution/Skip Reason: ${attempt.reason ?? 'none'}
- Follower Settings: Risk Level ${riskLevel}/5, Max Allocation ${maxPerTradePct}% per trade, ${describeLimits(limits)}

Examples of tone and copy style:
- "The agent copy-traded $45.00 aUSD of WMNT (score 85/100) — the leader committed 25% of their portfolio to this entry, aligning with your moderate risk settings."
- "Skipped: slippage limit exceeded — price moved 2.4% past your 1% threshold."
- "Skipped: token not in allowlist — the leader bought USDe, which is currently deselected in your agent's settings."
- "Skipped: insufficient balance — the calculated minimum allocation was $15.00, but your agent only has $4.20 in free capital."
- "Skipped: the leader's $3.20 trade fell below your $5.00 minimum trade size — too small to be worth copying."
- "Skipped: the AI strategist scored this $5.50 WMNT buy only 6/100 — below the 10/100 minimum — flagging it as a small, low-conviction top-up that doesn't look like a meaningful directional bet worth mirroring at your risk level."

Write only the final sentence. Do not include any quotes, formatting, prefix, or explanation.`;

  let explanation = '';

  try {
    if (geminiKey) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 120 },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        explanation =
          data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
      } else {
        console.error(
          `[explainTrade] Gemini API returned error status: ${res.status}`
        );
      }
    } else if (openaiKey) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 120,
          temperature: 0.7,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        explanation = data.choices?.[0]?.message?.content?.trim() ?? '';
      } else {
        console.error(
          `[explainTrade] OpenAI API returned error status: ${res.status}`
        );
      }
    }
  } catch (err) {
    console.error('[explainTrade] LLM API fetch error:', err);
  }

  // Fallback if LLM invocation fails or returns empty
  if (!explanation) {
    explanation = getDefaultExplanation(attempt, riskLevel, limits);
  }

  // Clean raw quote wrappers if any
  explanation = explanation.replace(/^["']|["']$/g, '').trim();

  // Save to database cache
  await saveCache(requestId, explanation);

  return explanation;
}

async function saveCache(requestId: string, explanation: string): Promise<void> {
  if (!explanation) return; // never cache empty strings
  try {
    await prisma.tradeExplanation.upsert({
      where: { requestId },
      create: { requestId, explanation },
      update: { explanation },
    });
  } catch (err) {
    console.error('[explainTrade] Database cache save error:', err);
  }
}

// Personalizes the categorical TradeSkipped reason strings with the follower's
// actual configured threshold values, so the fallback reads like a real
// explanation even without an LLM key configured.
function describeSkipReason(reason: string, attempt: any, limits: VaultLimits): string {
  const tradeValue = attempt.usdValue !== null ? `$${attempt.usdValue.toFixed(2)}` : "the leader's trade";

  switch (reason) {
    case 'score below threshold':
      return attempt.score !== null
        ? `the AI strategist rated this trade ${attempt.score}/100 — below the ${MIN_COPY_SCORE}/100 minimum needed to copy it, judging it too risky or low-conviction relative to the leader's typical moves`
        : `the AI strategist scored this trade too low to copy, judging it too risky relative to the leader's typical moves`;
    case 'slippage exceeded':
      return `the price drifted beyond your ${(limits.slippageBps / 100).toFixed(2)}% slippage tolerance`;
    case 'leader trade below minimum':
      return limits.minLeaderTradeUsd > 0
        ? `${tradeValue} fell below your $${limits.minLeaderTradeUsd.toFixed(2)} minimum leader trade size`
        : `the leader's trade was too small to copy`;
    case 'leader trade above maximum':
      return limits.maxLeaderTradeUsd > 0
        ? `${tradeValue} exceeded your $${limits.maxLeaderTradeUsd.toFixed(2)} maximum leader trade size`
        : `the leader's trade was too large to copy`;
    case 'allocation below minimum':
      return limits.minAllocUsd > 0
        ? `the calculated allocation fell short of your $${limits.minAllocUsd.toFixed(2)} minimum`
        : `the calculated allocation was too small to be worth copying`;
    default:
      return reason.toLowerCase();
  }
}

function getDefaultExplanation(attempt: any, riskLevel: number, limits: VaultLimits): string {
  const token = attempt.token ?? 'token';
  const scoreText = attempt.score !== null ? ` (score ${attempt.score}/100)` : '';

  if (attempt.status === 'opened') {
    const allocated = attempt.ausdAllocated !== null ? `$${attempt.ausdAllocated.toFixed(2)} aUSD` : 'funds';
    const price = attempt.entryPrice !== null ? ` at $${attempt.entryPrice.toFixed(4)}` : '';
    return `Copied: the agent allocated ${allocated} of ${token}${price}${scoreText} — aligning with your risk level ${riskLevel} settings.`;
  }

  if (attempt.status === 'skipped') {
    const reasonText = attempt.reason ? `: ${describeSkipReason(attempt.reason.toLowerCase(), attempt, limits)}` : '';
    return `Skipped${reasonText}${scoreText} — criteria not met.`;
  }

  return `Pending evaluation for ${token} trade${scoreText}.`;
}
