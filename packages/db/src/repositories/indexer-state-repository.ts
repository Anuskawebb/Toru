import { db } from '../client.js';
import { indexerState } from '../schema/indexer-state.js';
import { eq } from 'drizzle-orm';

export class IndexerStateRepository {
  /**
   * Retrieves the current block checkpoint for a chain.
   */
  static async getCheckpoint(chain: string): Promise<bigint | null> {
    const state = await db.query.indexerState.findFirst({
      where: eq(indexerState.chain, chain),
    });
    return state ? state.lastProcessedBlock : null;
  }

  /**
   * Saves the block checkpoint for a chain.
   */
  static async saveCheckpoint(chain: string, lastProcessedBlock: bigint): Promise<void> {
    await db.insert(indexerState)
      .values({
        chain,
        lastProcessedBlock,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: indexerState.chain,
        set: {
          lastProcessedBlock,
          updatedAt: new Date(),
        },
      });
  }
}
