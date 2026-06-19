import { PositionRepository, type TradeInput } from '../repositories/position-repository.js';

export class PositionBuilderService {
  static async rebuildWallet(wallet: string): Promise<void> {
    await PositionRepository.rebuildWallet(wallet);
  }

  static async rebuildAllPositions(): Promise<void> {
    await PositionRepository.rebuildAll();
  }

  /**
   * Applies a batch of trades to positions in a single transaction.
   * Preferred over repeated applyTrade() calls — O(unique pairs) DB roundtrips.
   */
  static async applyTrades(trades: TradeInput[]): Promise<void> {
    await PositionRepository.applyTrades(trades);
  }

  static async applyTrade(trade: TradeInput): Promise<void> {
    await PositionRepository.applyTrade(trade);
  }
}
