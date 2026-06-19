import { WalletMetricsRepository } from '../repositories/wallet-metrics-repository.js';

/**
 * WalletMetricsService — façade over WalletMetricsRepository.
 *
 * Mirrors the PositionBuilderService pattern: thin orchestration layer that
 * exposes the three rebuild modes and the incremental update path.
 *
 * Call order in the live indexing pipeline:
 *   insertTrades → applyTrades → updateFromNewTrades → saveCheckpoint
 *
 * updateFromNewTrades receives only the wallets that had genuinely new trades
 * (returned by insertTrades RETURNING) to remain idempotent on replay.
 */
export class WalletMetricsService {
  /** Rebuilds metrics for one wallet from source truth (trades + positions). */
  static async rebuildWallet(wallet: string): Promise<void> {
    await WalletMetricsRepository.rebuildWallet(wallet);
  }

  /**
   * Rebuilds metrics for all wallets.
   * Expensive — intended for backfills and corrections.
   * Run AFTER PositionRepository.rebuildAll() so currentOpenPositions is accurate.
   */
  static async rebuildAll(): Promise<void> {
    await WalletMetricsRepository.rebuildAll();
  }

  /**
   * Incremental update for the live indexing path.
   * Recomputes metrics only for wallets that received new trades in the
   * current block.  One SQL statement for all affected wallets.
   *
   * @param wallets — unique wallet addresses from newly inserted trades.
   *                  Pass the deduplicated list; duplicates are harmless but
   *                  add unnecessary work.
   */
  static async updateFromNewTrades(wallets: string[]): Promise<void> {
    await WalletMetricsRepository.rebuildWallets(wallets);
  }
}
