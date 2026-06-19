import { db, tradeRecommendations } from '../client.js';
import { and, eq, lt } from 'drizzle-orm';

/**
 * TradeRecommendationsRepository — lifecycle management for trade_recommendations.
 *
 * Write operations that the DecisionEngine delegates here:
 *   - expirePending(): sweeps stale PENDING rows to EXPIRED before each cycle.
 */
export class TradeRecommendationsRepository {
  /**
   * Transitions all PENDING recommendations whose expiresAt < now to EXPIRED.
   * Must be called at the start of every DecisionEngine cycle, before consuming
   * PENDING recommendations or generating new ones.
   *
   * Returns the number of rows transitioned.
   */
  static async expirePending(agentWallet: string, now: Date = new Date()): Promise<number> {
    const result = await db
      .update(tradeRecommendations)
      .set({ status: 'EXPIRED' })
      .where(
        and(
          eq(tradeRecommendations.agentWallet, agentWallet.toLowerCase()),
          eq(tradeRecommendations.status, 'PENDING'),
          lt(tradeRecommendations.expiresAt, now),
        )
      );
    // postgres.js returns rowCount as a property on the result array
    return (result as unknown as { length?: number }).length ?? 0;
  }
}
