import { SmartMoneySignalsRepository } from '../repositories/smart-money-signals-repository.js';

/**
 * SmartMoneySignalsService — façade over SmartMoneySignalsRepository.
 *
 * smart_money_signals is a batch analytics table. It is not updated incrementally
 * per block because accumulation_score is derived via PERCENT_RANK over all eligible tokens.
 *
 * Call order for a full refresh:
 *   1. PositionRepository.rebuildAll()
 *   2. WalletMetricsRepository.rebuildAll()
 *   3. WalletScoresService.rebuildAll()
 *   4. TokenMetricsService.rebuildAll()
 *   5. SmartMoneySignalsService.rebuildAll()   ← this service
 */
export class SmartMoneySignalsService {
  /** Recomputes all smart money signals from source truth. */
  static async rebuildAll(): Promise<void> {
    await SmartMoneySignalsRepository.rebuildAll();
  }
}
