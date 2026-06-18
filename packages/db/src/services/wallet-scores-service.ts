import { WalletScoresRepository } from '../repositories/wallet-scores-repository.js';

/**
 * WalletScoresService — façade over WalletScoresRepository.
 *
 * wallet_scores is a batch analytics table, not a live-updated one.
 * Scores use PERCENT_RANK() window functions that require scanning all of
 * wallet_metrics — there is no correct incremental update path.
 *
 * Rebuild trigger recommendations:
 *   - After a bulk backfill that adds a significant number of new wallets
 *   - Periodically (e.g. hourly) during live indexing to keep ranks current
 *   - Never per-block: the marginal score change per block is imperceptible
 *     and the cost is disproportionate (~3-5s for 23k wallets)
 *
 * Call order for a full refresh:
 *   1. PositionRepository.rebuildAll()
 *   2. WalletMetricsRepository.rebuildAll()
 *   3. WalletScoresService.rebuildAll()
 */
export class WalletScoresService {
  /**
   * Recomputes scores, classifications, and rank positions for all wallets.
   * Reads from wallet_metrics — ensure that table is up-to-date first.
   */
  static async rebuildAll(): Promise<void> {
    await WalletScoresRepository.rebuildAll();
  }
}
