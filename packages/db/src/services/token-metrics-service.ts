import { TokenMetricsRepository } from '../repositories/token-metrics-repository.js';

/**
 * TokenMetricsService — façade over TokenMetricsRepository.
 *
 * token_metrics is a batch analytics table.  It is not updated incrementally
 * per block because:
 *   1. quality_holder_count joins wallet_scores — wallet_scores itself is
 *      batch-only (requires PERCENT_RANK over all wallets).
 *   2. unique_traders / unique_buyers / unique_sellers require full COUNT(DISTINCT)
 *      over the complete token history — can't be maintained via arithmetic.
 *
 * Rebuild trigger recommendations:
 *   - After any full backfill pipeline run
 *   - Periodically during live indexing (e.g., after every WalletScoresService.rebuildAll())
 *   - Never per-block
 *
 * Full pipeline refresh order:
 *   1. PositionRepository.rebuildAll()
 *   2. WalletMetricsRepository.rebuildAll()
 *   3. WalletScoresService.rebuildAll()
 *   4. TokenMetricsService.rebuildAll()   ← this service
 */
export class TokenMetricsService {
  /** Recomputes all token metrics from source truth (trades + positions + scores). */
  static async rebuildAll(): Promise<void> {
    await TokenMetricsRepository.rebuildAll();
  }

  /** Recomputes metrics for a single token. Useful for targeted repair. */
  static async rebuildToken(tokenAddress: string): Promise<void> {
    await TokenMetricsRepository.rebuildToken(tokenAddress);
  }
}
