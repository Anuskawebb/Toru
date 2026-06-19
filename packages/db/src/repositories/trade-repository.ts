import { db } from '../client.js';
import { trades, type InsertTrade, type Trade } from '../schema/trades.js';
import { desc, eq } from 'drizzle-orm';

export class TradeRepository {
  /**
   * Inserts a single trade into the database.
   * If a trade with the same unique keys already exists, it is ignored (conflict do nothing).
   */
  static async insertTrade(trade: InsertTrade): Promise<void> {
    await db.insert(trades)
      .values(trade)
      .onConflictDoNothing();
  }

  /**
   * Inserts multiple trades in a batch.
   * Duplicate trades are silently skipped (ON CONFLICT DO NOTHING).
   * Returns the tx_hash of each row that was actually inserted — callers
   * that apply incremental position updates MUST use this set so that
   * skipped duplicates don't get double-counted.
   */
  static async insertTrades(tradesList: InsertTrade[]): Promise<string[]> {
    if (tradesList.length === 0) return [];
    const inserted = await db.insert(trades)
      .values(tradesList)
      .onConflictDoNothing()
      .returning({ txHash: trades.txHash });
    return inserted.map((r) => r.txHash);
  }

  /**
   * Retrieves the latest trades up to the specified limit.
   */
  static async getLatestTrades(limit: number = 50): Promise<Trade[]> {
    return db.query.trades.findMany({
      orderBy: [desc(trades.timestamp)],
      limit,
    });
  }

  /**
   * Retrieves trades for a specific wallet address up to the specified limit.
   */
  static async getWalletTrades(wallet: string, limit: number = 50): Promise<Trade[]> {
    return db.query.trades.findMany({
      where: eq(trades.wallet, wallet.toLowerCase()),
      orderBy: [desc(trades.timestamp)],
      limit,
    });
  }
}
