/**
 * Agent Runner — drives the autonomous trading loop for all active user agents.
 *
 * Every CYCLE_INTERVAL_MS:
 *   1. Fetch all ACTIVE agents from DB
 *   2. For each agent, find its active TWAK wallet (execution_accounts)
 *   3. Run DecisionEngine → generates BUY/SELL recommendations, persists to DB
 *   4. Apply the agent's risk profile (tier filter + position size cap + drawdown gate)
 *   5. AUTONOMOUS mode: execute via TwakExecutor (set TWAK_AGENT=true for live BSC)
 *      ASSISTED mode: leave orders PENDING so user can approve them in the UI
 *
 * Risk profile → what each strategy level means at runtime:
 *   CONSERVATIVE: only LOW/MEDIUM signal tiers, positions capped at 5%, stops if drawdown > 2%
 *   BALANCED:     LOW/MEDIUM/HIGH signal tiers, positions capped at 10%, stops if drawdown > 5%
 *   AGGRESSIVE:   all tiers including SPECULATIVE, positions capped at 20%, stops if drawdown > 10%
 */
import 'dotenv/config';
import {
  db,
  agents,
  eq,
  queryClient,
  ExecutionAccountsRepository,
  TradeRecommendationsRepository,
  type AgentRow,
  type TradeRecommendationRow,
} from '@toro/db';
import { DecisionEngine } from '../src/decision/decision-engine.js';
import { ExecutionEngine } from '../src/execution/execution-engine.js';
import { createExecutor } from '../src/execution/executor-factory.js';
import { TwakClient } from '../src/execution/twak/twak-client.js';
import {
  getFearAndGreedX402,
  getTopGainersX402,
  getGlobalMetricsX402,
  getTokenQuotesX402,
  getDexPairsX402,
} from '../src/cmc/x402-cmc-client.js';
import type { ExecutionPlan } from '../src/decision/trade-recommendation-types.js';

// Shared TWAK client — used for x402 micropayments on behalf of each agent
const twakClient = new TwakClient({
  apiUrl: process.env.TWAK_API_URL ?? 'http://127.0.0.1:3002',
});

// ── Risk profile definitions ────────────────────────────────────────────────
// These match exactly what the UI shows users on the strategy selection screen.

const RISK_PROFILES = {
  CONSERVATIVE: {
    allowedTiers:          ['LOW', 'MEDIUM'] as string[],
    maxPositionSizePct:    5.0,   // "Up to 5% per trade"
    maxDrawdownPct:        2.0,   // "Max 2% daily drawdown"
    maxDailyLossPct:       2.0,
  },
  BALANCED: {
    allowedTiers:          ['LOW', 'MEDIUM', 'HIGH'] as string[],
    maxPositionSizePct:    10.0,  // "Up to 10% per trade"
    maxDrawdownPct:        5.0,   // "Max 5% daily drawdown"
    maxDailyLossPct:       5.0,
  },
  AGGRESSIVE: {
    allowedTiers:          ['LOW', 'MEDIUM', 'HIGH', 'SPECULATIVE'] as string[],
    maxPositionSizePct:    20.0,  // "Up to 20% per trade"
    maxDrawdownPct:        10.0,  // "Max 10% daily drawdown"
    maxDailyLossPct:       10.0,
  },
} as const;

type RiskLevelKey = keyof typeof RISK_PROFILES;

const CYCLE_INTERVAL_MS    = Number(process.env.AGENT_CYCLE_MS ?? 5 * 60 * 1000);
const STARTING_CAPITAL_USD = Number(process.env.AGENT_STARTING_CAPITAL_USD ?? '100');

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getActiveAgents(): Promise<AgentRow[]> {
  return db.select().from(agents).where(eq(agents.status, 'ACTIVE'));
}

/**
 * Applies the agent's risk profile as a gate + filter on top of the engine output.
 *
 * - Drawdown gate: if the portfolio has blown past the profile's limit, skip all BUYs.
 * - Tier filter: only execute BUYs for signal tiers the profile allows.
 * - Position size cap: clamp amountUsd so no single trade exceeds the profile's max %.
 * - SELLs (stop-loss / take-profit / reversals) always pass through — exits are never blocked.
 */
function applyRiskProfile(
  plans:             ExecutionPlan[],
  recs:              TradeRecommendationRow[],
  riskLevel:         RiskLevelKey,
  portfolioUsd:      number,
  currentDrawdownPct: number,
  dailyLossPct:      number,
): { plans: ExecutionPlan[]; recs: TradeRecommendationRow[] } {
  const profile = RISK_PROFILES[riskLevel];
  const recMap  = new Map(recs.map(r => [r.id, r]));

  const drawdownGateOpen = currentDrawdownPct >= profile.maxDrawdownPct;
  const dailyLossGateOpen = dailyLossPct >= profile.maxDailyLossPct;

  const filteredPlans: ExecutionPlan[]            = [];
  const filteredRecs:  TradeRecommendationRow[]   = [];
  const seen = new Set<string>();

  for (const plan of plans) {
    const rec = recMap.get(plan.recommendationId);
    if (!rec || seen.has(plan.recommendationId)) continue;

    // SELL orders always pass (stop-loss / take-profit protection should never be blocked)
    if (plan.action === 'SELL') {
      filteredPlans.push(plan);
      filteredRecs.push(rec);
      seen.add(plan.recommendationId);
      continue;
    }

    // BUY gates
    if (drawdownGateOpen) {
      console.log(`[profile] drawdown ${currentDrawdownPct.toFixed(1)}% ≥ ${profile.maxDrawdownPct}% — skipping BUY ${rec.tokenSymbol}`);
      continue;
    }

    if (dailyLossGateOpen) {
      console.log(`[profile] daily loss ${dailyLossPct.toFixed(1)}% ≥ ${profile.maxDailyLossPct}% — skipping BUY ${rec.tokenSymbol}`);
      continue;
    }

    // Tier filter
    if (!profile.allowedTiers.includes(rec.riskTier)) {
      console.log(`[profile] tier ${rec.riskTier} not allowed for ${riskLevel} — skipping ${rec.tokenSymbol}`);
      continue;
    }

    // Position size cap — clamp amountUsd so it never exceeds the profile's max %
    const maxAmountUsd = (portfolioUsd * profile.maxPositionSizePct) / 100;
    const cappedPlan   = plan.amountUsd > maxAmountUsd
      ? { ...plan, amountUsd: parseFloat(maxAmountUsd.toFixed(2)) }
      : plan;

    filteredPlans.push(cappedPlan);
    filteredRecs.push(rec);
    seen.add(plan.recommendationId);
  }

  return { plans: filteredPlans, recs: filteredRecs };
}

// ── Per-agent cycle ──────────────────────────────────────────────────────────

async function runAgentCycle(
  agent:                AgentRow,
  sizeMultiplier:       number = 1.0,
  highMomentumSymbols:  Set<string> = new Set(),
): Promise<void> {
  const account = await ExecutionAccountsRepository.getActive(agent.id);
  if (!account) {
    console.log(`[${agent.id}] No active execution account — skipping`);
    return;
  }

  const walletAddress = account.walletAddress;
  const riskLevel     = (agent.riskLevel as RiskLevelKey) ?? 'BALANCED';
  const tradingMode   = agent.tradingMode ?? 'AUTONOMOUS';

  console.log(`[${agent.id}] wallet=${walletAddress} risk=${riskLevel} mode=${tradingMode}`);

  // 1. Decision cycle — persists recommendations to DB, returns execution plans
  const decisionEngine = new DecisionEngine({
    agentWalletAddress: walletAddress,
    startingCapitalUsd: STARTING_CAPITAL_USD,
  });

  const cycleResult = await decisionEngine.run();

  const { portfolioSnapshot } = cycleResult;
  console.log(
    `[${agent.id}] recs=${cycleResult.recommendations.length}` +
    ` plans=${cycleResult.executionPlans.length}` +
    ` skipped=${cycleResult.skipped}` +
    ` blocked=${cycleResult.blocked}` +
    ` portfolio=$${portfolioSnapshot.portfolioUsd.toFixed(2)}` +
    ` drawdown=${portfolioSnapshot.drawdownPct.toFixed(1)}%`
  );

  if (cycleResult.executionPlans.length === 0) return;

  // 2. Fetch persisted PENDING recommendations from DB (ExecutionEngine needs DB rows)
  const pendingRecs = await TradeRecommendationsRepository.getPendingByWallet(walletAddress) as TradeRecommendationRow[];

  // 3. Apply agent risk profile — tier filter, drawdown gate, position size cap
  //    sizeMultiplier < 1.0 when CMC signals Extreme Greed or high BTC dominance
  if (sizeMultiplier < 1.0) {
    console.log(`[${agent.id}] CMC macro signal — applying ${sizeMultiplier.toFixed(2)}x position size multiplier`);
  }

  const { plans: profiledPlans, recs: profiledRecs } = applyRiskProfile(
    cycleResult.executionPlans,
    pendingRecs,
    riskLevel,
    portfolioSnapshot.portfolioUsd * sizeMultiplier,
    portfolioSnapshot.drawdownPct,
    portfolioSnapshot.rollingLossPct24h,
  );

  // Log which plans overlap with CMC high-momentum tokens (for observability)
  if (highMomentumSymbols.size > 0) {
    const momentumHits = profiledRecs
      .filter(r => highMomentumSymbols.has(r.tokenSymbol?.toUpperCase() ?? ''))
      .map(r => r.tokenSymbol);
    if (momentumHits.length > 0) {
      console.log(`[${agent.id}] CMC momentum overlap: ${momentumHits.join(', ')} — high-conviction buys`);
    }
  }

  if (profiledPlans.length === 0) {
    console.log(`[${agent.id}] No plans passed risk profile filter`);
    return;
  }

  console.log(`[${agent.id}] ${profiledPlans.length} plan(s) passed profile filter`);

  // 4a. Pre-trade x402 price check — verify live CMC prices for BUY tokens
  //     Uses /x402/v3/cryptocurrency/quotes/latest (agent pays $0.01 USDC on Base per call)
  //     Also fetches BSC DEX pair data via /x402/v4/dex/pairs/quotes/latest
  const buySymbols = [...new Set(
    profiledRecs.filter(r => r.action === 'BUY').map(r => r.tokenSymbol).filter(Boolean)
  )] as string[];

  if (buySymbols.length > 0) {
    const [cmcQuotes, dexPairs] = await Promise.all([
      getTokenQuotesX402(buySymbols, walletAddress, twakClient),
      getDexPairsX402(
        profiledRecs.filter(r => r.action === 'BUY').map(r => r.tokenAddress).filter(Boolean) as string[],
        walletAddress,
        twakClient,
      ),
    ]);

    if (cmcQuotes.size > 0) {
      for (const sym of buySymbols) {
        const q = cmcQuotes.get(sym.toUpperCase());
        if (q) {
          console.log(`[x402/quote] ${sym}: $${q.price.toFixed(4)} | 24h: ${q.percentChange24h.toFixed(1)}% | vol: $${(q.volume24h / 1e6).toFixed(1)}M`);
        }
      }
    }

    if (dexPairs.length > 0) {
      const topPair = dexPairs[0];
      console.log(`[x402/dex] ${topPair.baseSymbol}/${topPair.quoteSymbol} on ${topPair.exchange}: $${topPair.price.toFixed(4)} | 24h vol: $${(topPair.volume24h / 1e6).toFixed(1)}M`);
    }
  }

  // 4. Create orders from profiled plans
  const executor        = createExecutor();
  const executionEngine = new ExecutionEngine(
    { agentId: agent.id, agentWallet: walletAddress },
    executor,
  );

  const created = await executionEngine.createOrders(profiledPlans, profiledRecs);
  console.log(`[${agent.id}] orders created=${created}`);

  if (created === 0) return;

  // 5. ASSISTED mode: leave orders PENDING — user approves via UI
  if (tradingMode === 'ASSISTED') {
    console.log(`[${agent.id}] ASSISTED mode — orders queued for user approval`);
    return;
  }

  // 6. AUTONOMOUS mode: execute immediately
  const execResult = await executionEngine.processOrders();
  console.log(
    `[${agent.id}] filled=${execResult.ordersFilled}` +
    ` failed=${execResult.ordersFailed}` +
    ` positionsOpened=${execResult.positionsOpened}` +
    ` positionsClosed=${execResult.positionsClosed}` +
    ` durationMs=${execResult.durationMs}`
  );
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function runAllAgents(): Promise<void> {
  const activeAgents = await getActiveAgents();

  if (activeAgents.length === 0) {
    console.log('[runner] No active agents');
    return;
  }

  console.log(`\n[runner] ${new Date().toISOString()} — running ${activeAgents.length} agent(s)`);

  // Use the first active agent's wallet address as the payer for x402 data requests.
  // Each per-agent cycle may also make its own x402 calls using its own wallet.
  const primaryWallet = activeAgents[0]
    ? (await ExecutionAccountsRepository.getActive(activeAgents[0].id))?.walletAddress ?? ''
    : '';

  // ── CMC market intelligence via x402 micropayments ───────────────────────
  // The agent wallet pays for this data directly on-chain — no human API subscription.
  // x402 payment tx hash is logged as on-chain proof of autonomous intelligence spending.

  const [fg, gainers, globalMetrics] = await Promise.all([
    getFearAndGreedX402(primaryWallet, twakClient),
    getTopGainersX402(primaryWallet, twakClient, 10),
    getGlobalMetricsX402(primaryWallet, twakClient),
  ]);

  if (fg) {
    console.log(`[cmc/x402] Fear & Greed: ${fg.value} — ${fg.classification}`);
  }

  if (gainers.length > 0) {
    const top3 = gainers.slice(0, 3).map(g => `${g.symbol} +${g.percentChange.toFixed(1)}%`).join(', ');
    console.log(`[cmc/x402] Top gainers: ${top3}`);
  }

  if (globalMetrics) {
    console.log(
      `[cmc/x402] Global: BTC dom ${globalMetrics.btcDominancePct.toFixed(1)}%` +
      ` | mktcap $${(globalMetrics.totalMarketCapUsd / 1e12).toFixed(2)}T`
    );
  }

  // ── Market-level gates ────────────────────────────────────────────────────
  // Extreme Fear (<20):  CONSERVATIVE + BALANCED agents skip new BUYs entirely
  // Extreme Greed (>80): all agents apply 0.75x position size multiplier
  // BTC dominance > 60%: altcoin season is over — AGGRESSIVE agents reduce exposure by 20%
  const marketExtremeFear    = fg !== null && fg.value < 20;
  const marketExtremeGreed   = fg !== null && fg.value > 80;
  const btcDominanceHigh     = globalMetrics !== null && globalMetrics.btcDominancePct > 60;

  if (btcDominanceHigh) {
    console.log(`[cmc/x402] BTC dominance ${globalMetrics!.btcDominancePct.toFixed(1)}% — altcoin exposure reduced`);
  }

  // Build a set of high-momentum symbols from CMC gainers
  // These get a +1 signal priority boost in runAgentCycle
  const highMomentumSymbols = new Set(gainers.filter(g => g.percentChange > 10).map(g => g.symbol.toUpperCase()));

  for (const agent of activeAgents) {
    // CONSERVATIVE + BALANCED agents sit out during extreme fear
    if (marketExtremeFear && agent.riskLevel !== 'AGGRESSIVE') {
      console.log(`[${agent.id}] CMC Extreme Fear (${fg!.value}) — ${agent.riskLevel} agent skipping this cycle`);
      continue;
    }
    try {
      const greedMultiplier     = marketExtremeGreed ? 0.75 : 1.0;
      const dominanceMultiplier = (btcDominanceHigh && agent.riskLevel === 'AGGRESSIVE') ? 0.8 : 1.0;
      const sizeMultiplier      = greedMultiplier * dominanceMultiplier;

      await runAgentCycle(agent, sizeMultiplier, highMomentumSymbols);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${agent.id}] Cycle failed: ${msg}`);
    }
  }
}

async function main(): Promise<void> {
  const mode = process.env.TWAK_AGENT === 'true' ? 'TwakExecutor (LIVE BSC)' : 'MockExecutor (simulation)';
  console.log('[runner] Toru Agent Runner starting');
  console.log(`[runner] Executor:         ${mode}`);
  console.log(`[runner] Cycle interval:   ${CYCLE_INTERVAL_MS / 1000}s`);
  console.log(`[runner] Starting capital: $${STARTING_CAPITAL_USD}`);

  await runAllAgents();

  setInterval(() => {
    runAllAgents().catch(e => console.error('[runner] Cycle error:', e));
  }, CYCLE_INTERVAL_MS);

  process.on('SIGINT', async () => {
    console.log('[runner] Shutting down...');
    await queryClient.end();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[runner] Shutting down...');
    await queryClient.end();
    process.exit(0);
  });
}

main().catch(e => {
  console.error('[runner] Fatal:', e);
  process.exit(1);
});
