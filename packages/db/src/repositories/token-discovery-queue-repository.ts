import { db } from '../client.js';
import { tokenDiscoveryQueue, type TokenDiscoveryQueue } from '../schema/token-discovery-queue.js';
import { eq, and, lt, sql } from 'drizzle-orm';

export class TokenDiscoveryQueueRepository {
  /**
   * Enqueues a token address for async metadata resolution if not already present.
   */
  static async enqueueToken(address: string): Promise<void> {
    const formattedAddress = address.toLowerCase();
    await db.insert(tokenDiscoveryQueue)
      .values({
        address: formattedAddress,
        attempts: 0,
        resolved: false,
      })
      .onConflictDoNothing();
  }

  /**
   * Bulk enqueue — inserts all addresses in a single query, ignoring duplicates.
   */
  static async enqueueTokens(addresses: string[]): Promise<void> {
    if (addresses.length === 0) return;
    const values = addresses.map((addr) => ({
      address: addr.toLowerCase(),
      attempts: 0,
      resolved: false,
    }));
    await db.insert(tokenDiscoveryQueue).values(values).onConflictDoNothing();
  }

  /**
   * Retrieves a batch of unresolved tokens that have not exceeded maximum retry limits.
   * Filters out resolved tokens. Focuses on tokens with fewer than 5 attempts.
   */
  static async getUnresolvedTokens(limit: number = 10, maxAttempts: number = 5): Promise<TokenDiscoveryQueue[]> {
    return db.query.tokenDiscoveryQueue.findMany({
      where: and(
        eq(tokenDiscoveryQueue.resolved, false),
        lt(tokenDiscoveryQueue.attempts, maxAttempts)
      ),
      limit,
    });
  }

  /**
   * Marks a token as successfully resolved in the queue.
   */
  static async markResolved(address: string): Promise<void> {
    await db.update(tokenDiscoveryQueue)
      .set({
        resolved: true,
        lastAttemptedAt: new Date(),
      })
      .where(eq(tokenDiscoveryQueue.address, address.toLowerCase()));
  }

  /**
   * Increments the processing attempts counter for a token in the queue.
   */
  static async incrementAttempts(address: string): Promise<void> {
    await db.update(tokenDiscoveryQueue)
      .set({
        attempts: sql`${tokenDiscoveryQueue.attempts} + 1`,
        lastAttemptedAt: new Date(),
      })
      .where(eq(tokenDiscoveryQueue.address, address.toLowerCase()));
  }
}
