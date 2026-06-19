import {
  db,
  walletPositions,
  portfolioSnapshots,
  portfolioState,
  eq,
  and,
  asc,
  gte,
  lt,
  type WalletPosition,
} from '@aether/db';
import { PriceService } from '../valuation/price-service.js';
import { BSC_STABLES } from '../valuation/price-observation-service.js';
import { type PriceBundle } from '../valuation/price-types.js';
import { PortfolioValuationEngine } from './portfolio-valuation-engine.js';
import {
  toRiskPortfolioState,
  type PortfolioStateSnapshot,
} from './portfolio-types.js';
import { type RiskPortfolioState } from '../risk/risk-engine.js';

/**
 * Configuration injected at construction time.
 * Caller (orchestrator) provides these from env vars.
 */
export interface PortfolioStateConfig {
  /** Lowercase agent wallet address (AGENT_WALLET_ADDRESS env var) */
  agentWalletAddress: string;
  /** Competition starting capital in USD (COMPETITION_STARTING_CAPITAL_USD env var) */
  startingCapitalUsd: number;
}

/**
 * PortfolioStateService — orchestrates the portfolio valuation pipeline.
 *
 * Responsibilities:
 *   1. Load positions for the agent wallet from wallet_positions
 *   2. Batch-fetch price bundles for all token addresses
 *   3. Delegate MTM computation to PortfolioValuationEngine (pure)
 *   4. Resolve peak equity from persisted portfolio_state (restart-safe)
 *   5. Compute drawdown and rolling 24h loss from portfolio_snapshots
 *   6. Upsert portfolio_state (live single-row state)
 *   7. Insert portfolio_snapshots (time-series record)
 *   8. Return PortfolioStateSnapshot + RiskPortfolioState projection
 *
 * Designed to be called every 5 minutes by the orchestration scheduler.
 */
export class PortfolioStateService {
  private readonly agentWallet: string;
  private readonly startingCapitalUsd: number;

  constructor(config: PortfolioStateConfig) {
    this.agentWallet = config.agentWalletAddress.toLowerCase();
    this.startingCapitalUsd = config.startingCapitalUsd;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Main entry point. Runs the full portfolio valuation pipeline.
   *
   * @returns { snapshot, riskState } — use riskState as input to RiskEngine.evaluate()
   */
  public async refresh(now: Date = new Date()): Promise<{
    snapshot: PortfolioStateSnapshot;
    riskState: RiskPortfolioState;
  }> {
    // 1. Load agent wallet positions
    const positions = await this.loadPositions();

    // 2. Batch-fetch price bundles for all token addresses
    const priceMap = await this.fetchPriceMap(positions);

    // 3. Pure MTM valuation
    const valuation = PortfolioValuationEngine.compute(
      this.agentWallet,
      positions,
      priceMap,
      BSC_STABLES,
      now
    );

    // 4. Resolve persisted peak (restart-safe) + bootstrap detection
    const { storedPeak, isBootstrap } = await this.resolveStoredPeakAndBootstrap();
    const peakPortfolioUsd = Math.max(storedPeak, valuation.portfolioUsd);

    // 5. Drawdown (suppressed to 0% on first-ever run to prevent empty-wallet blocking)
    const drawdownPct = isBootstrap
      ? 0
      : this.computeDrawdown(valuation.portfolioUsd, peakPortfolioUsd);

    // 6. Rolling 24h loss (suppressed on bootstrap; no 24h baseline snapshot exists yet)
    const rollingLossPct24h = isBootstrap
      ? 0
      : await this.computeRollingLoss(valuation.portfolioUsd, now);

    // 7. Percentage metrics relative to CURRENT portfolio value.
    //    Using startingCapitalUsd as denominator produces values > 100% after gains
    //    and understates risk after losses — both corrupt the Risk Engine's exposure checks.
    //    When portfolio is empty (bootstrap), both metrics are 0.
    const portfolioBase    = valuation.portfolioUsd > 0 ? valuation.portfolioUsd : 1;
    const cashReservePct   = valuation.portfolioUsd > 0 ? (valuation.stablecoinUsd   / portfolioBase) * 100 : 0;
    const totalExposurePct = valuation.portfolioUsd > 0 ? (valuation.tokenExposureUsd / portfolioBase) * 100 : 0;
    // Phase 6B.2 placeholder — replaced in Phase 8 with actual per-position stop tracking
    const openRiskPct = totalExposurePct * 0.05;

    const snapshot: PortfolioStateSnapshot = {
      ...valuation,
      startingCapitalUsd:  this.startingCapitalUsd,
      peakPortfolioUsd,
      drawdownPct,
      rollingLossPct24h,
      cashReservePct:      Math.round(cashReservePct * 100) / 100,
      totalExposurePct:    Math.round(totalExposurePct * 100) / 100,
      openRiskPct:         Math.round(openRiskPct * 100) / 100,
    };

    // 8. Persist state and snapshot atomically.
    //    A single transaction prevents portfolio_state / portfolio_snapshots divergence
    //    if the process is killed between the two writes.
    await db.transaction(async (tx) => {
      await tx
        .insert(portfolioState)
        .values({
          agentWallet:         this.agentWallet,
          portfolioUsd:        snapshot.portfolioUsd,
          stablecoinUsd:       snapshot.stablecoinUsd,
          tokenExposureUsd:    snapshot.tokenExposureUsd,
          buyingPowerUsd:      snapshot.buyingPowerUsd,
          startingCapitalUsd:  snapshot.startingCapitalUsd,
          peakPortfolioUsd:    snapshot.peakPortfolioUsd,
          drawdownPct:         snapshot.drawdownPct,
          rollingLossPct24h:   snapshot.rollingLossPct24h,
          cashReservePct:      snapshot.cashReservePct,
          totalExposurePct:    snapshot.totalExposurePct,
          openRiskPct:         snapshot.openRiskPct,
          openPositions:       snapshot.openPositions,
          unpricedPositions:   snapshot.unpricedPositions,
          valuationConfidence: snapshot.valuationConfidence,
          lastValuationAt:     now,
          updatedAt:           now,
        })
        .onConflictDoUpdate({
          target: portfolioState.agentWallet,
          set: {
            portfolioUsd:        snapshot.portfolioUsd,
            stablecoinUsd:       snapshot.stablecoinUsd,
            tokenExposureUsd:    snapshot.tokenExposureUsd,
            buyingPowerUsd:      snapshot.buyingPowerUsd,
            // startingCapitalUsd omitted — written once on INSERT, never overwritten
            peakPortfolioUsd:    snapshot.peakPortfolioUsd,
            drawdownPct:         snapshot.drawdownPct,
            rollingLossPct24h:   snapshot.rollingLossPct24h,
            cashReservePct:      snapshot.cashReservePct,
            totalExposurePct:    snapshot.totalExposurePct,
            openRiskPct:         snapshot.openRiskPct,
            openPositions:       snapshot.openPositions,
            unpricedPositions:   snapshot.unpricedPositions,
            valuationConfidence: snapshot.valuationConfidence,
            lastValuationAt:     now,
            updatedAt:           now,
          },
        });

      await tx.insert(portfolioSnapshots).values({
        agentWallet:         this.agentWallet,
        snapshotAt:          now,
        portfolioUsd:        snapshot.portfolioUsd,
        stablecoinUsd:       snapshot.stablecoinUsd,
        tokenExposureUsd:    snapshot.tokenExposureUsd,
        openPositions:       snapshot.openPositions,
        unpricedPositions:   snapshot.unpricedPositions,
        peakPortfolioUsd:    snapshot.peakPortfolioUsd,
        drawdownPct:         snapshot.drawdownPct,
        rollingLossPct24h:   snapshot.rollingLossPct24h,
        valuationConfidence: snapshot.valuationConfidence,
      });
    });

    // 9. Return the projection for the Risk Engine
    const riskState = toRiskPortfolioState(snapshot);
    return { snapshot, riskState };
  }

  /**
   * Read-only: returns the last persisted portfolio state without triggering a refresh.
   * Returns null if no state has been persisted yet.
   */
  public async readCurrentState(): Promise<PortfolioStateSnapshot | null> {
    const rows = await db
      .select()
      .from(portfolioState)
      .where(eq(portfolioState.agentWallet, this.agentWallet))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      agentWallet:         row.agentWallet,
      valuedAt:            row.lastValuationAt,
      portfolioUsd:        row.portfolioUsd,
      stablecoinUsd:       row.stablecoinUsd,
      tokenExposureUsd:    row.tokenExposureUsd,
      buyingPowerUsd:      row.buyingPowerUsd,
      openPositions:       row.openPositions,
      unpricedPositions:   row.unpricedPositions,
      valuationConfidence: row.valuationConfidence,
      startingCapitalUsd:  row.startingCapitalUsd,
      peakPortfolioUsd:    row.peakPortfolioUsd,
      drawdownPct:         row.drawdownPct,
      rollingLossPct24h:   row.rollingLossPct24h,
      cashReservePct:      row.cashReservePct,
      totalExposurePct:    row.totalExposurePct,
      openRiskPct:         row.openRiskPct,
      positions:           [],  // positions not stored in portfolio_state
    };
  }

  /**
   * Prunes portfolio_snapshots older than retentionDays (default: 7).
   * Call this periodically from the scheduler to keep the table bounded.
   */
  public async pruneSnapshots(retentionDays: number = 7, now: Date = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    await db
      .delete(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.agentWallet, this.agentWallet),
          lt(portfolioSnapshots.snapshotAt, cutoff)
        )
      );
    console.log(`Pruned portfolio snapshots older than ${cutoff.toISOString()}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────────

  private async loadPositions(): Promise<WalletPosition[]> {
    return db
      .select()
      .from(walletPositions)
      .where(eq(walletPositions.wallet, this.agentWallet));
  }

  private async fetchPriceMap(positions: WalletPosition[]): Promise<Map<string, PriceBundle>> {
    const tokenAddresses = [
      ...new Set(positions.map(p => p.tokenAddress.toLowerCase()))
    ];

    const priceMap = new Map<string, PriceBundle>();
    // Batch-fetch via PriceService (uses in-memory cache where possible)
    await Promise.all(
      tokenAddresses.map(async (addr) => {
        const bundle = await PriceService.getPriceBundle(addr);
        if (bundle) {
          priceMap.set(addr, bundle);
        }
      })
    );
    return priceMap;
  }

  /**
   * Resolves the stored peak portfolio value and whether this is a bootstrap run.
   *
   * Bootstrap = no portfolio_state row has ever been written for this wallet.
   * On bootstrap, drawdown and rolling loss are suppressed to 0% so the agent
   * is not blocked before it has placed its first trade.
   *
   * On first real run with stablecoins loaded, portfolioUsd > 0, and
   * Math.max(startingCapitalUsd, portfolioUsd) correctly establishes peak.
   */
  private async resolveStoredPeakAndBootstrap(): Promise<{ storedPeak: number; isBootstrap: boolean }> {
    const rows = await db
      .select({ peakPortfolioUsd: portfolioState.peakPortfolioUsd })
      .from(portfolioState)
      .where(eq(portfolioState.agentWallet, this.agentWallet))
      .limit(1);

    if (rows.length === 0) {
      return { storedPeak: this.startingCapitalUsd, isBootstrap: true };
    }
    return { storedPeak: rows[0]!.peakPortfolioUsd, isBootstrap: false };
  }

  /**
   * Drawdown = (peak - current) / peak * 100
   * Clamped to [0, 100]. Returns 0 when current > peak (new high).
   */
  private computeDrawdown(currentUsd: number, peakUsd: number): number {
    if (peakUsd <= 0) return 0;
    const dd = ((peakUsd - currentUsd) / peakUsd) * 100;
    return Math.round(Math.max(0, Math.min(100, dd)) * 10000) / 10000;
  }

  /**
   * Rolling 24h loss = loss since the earliest snapshot in the last 24h window.
   *
   * If no 24h-old snapshot exists (fresh start), uses startingCapitalUsd as baseline.
   * Returns 0 if portfolio gained over the 24h window.
   */
  private async computeRollingLoss(currentUsd: number, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const windowRows = await db
      .select({ portfolioUsd: portfolioSnapshots.portfolioUsd })
      .from(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.agentWallet, this.agentWallet),
          gte(portfolioSnapshots.snapshotAt, cutoff)
        )
      )
      .orderBy(asc(portfolioSnapshots.snapshotAt))
      .limit(1);

    const baseUsd = windowRows[0]?.portfolioUsd ?? this.startingCapitalUsd;

    if (baseUsd <= 0) return 0;
    const loss = ((baseUsd - currentUsd) / baseUsd) * 100;
    return Math.round(Math.max(0, loss) * 10000) / 10000;
  }

}
