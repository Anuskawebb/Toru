import { db } from '../client.js';
import { tokens, type InsertToken, type Token } from '../schema/tokens.js';
import { eq, or, isNull, sql } from 'drizzle-orm';

export class TokenRepository {
  /**
   * Find a token metadata entry by its address.
   */
  static async findByAddress(address: string): Promise<Token | undefined> {
    return db.query.tokens.findFirst({
      where: eq(tokens.address, address.toLowerCase()),
    });
  }

  /**
   * Inserts or updates a token metadata entry.
   */
  static async upsertToken(token: InsertToken): Promise<void> {
    const formattedAddress = token.address.toLowerCase();
    
    await db.insert(tokens)
      .values({
        ...token,
        address: formattedAddress,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tokens.address,
        set: {
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          imageUrl: token.imageUrl ? token.imageUrl : sql`tokens.image_url`,
          coingeckoId: token.coingeckoId ? token.coingeckoId : sql`tokens.coingecko_id`,
          verified: token.verified !== undefined ? token.verified : sql`tokens.verified`,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Bulk upsert — inserts or updates all tokens in a single query.
   * Preserves existing imageUrl/coingeckoId/verified if the incoming row omits them.
   */
  static async upsertTokens(tokensList: InsertToken[]): Promise<void> {
    if (tokensList.length === 0) return;
    const formatted = tokensList.map((t) => ({
      ...t,
      address: t.address.toLowerCase(),
      updatedAt: new Date(),
    }));
    await db.insert(tokens)
      .values(formatted)
      .onConflictDoUpdate({
        target: tokens.address,
        set: {
          symbol:      sql`EXCLUDED.symbol`,
          name:        sql`EXCLUDED.name`,
          decimals:    sql`EXCLUDED.decimals`,
          imageUrl:    sql`COALESCE(EXCLUDED.image_url,    tokens.image_url)`,
          coingeckoId: sql`COALESCE(EXCLUDED.coingecko_id, tokens.coingecko_id)`,
          verified:    sql`COALESCE(EXCLUDED.verified,     tokens.verified)`,
          updatedAt:   sql`NOW()`,
        },
      });
  }

  /**
   * Finds tokens that are missing metadata (image url or coingecko id is null).
   */
  static async findMissingMetadata(): Promise<Token[]> {
    return db.query.tokens.findMany({
      where: or(
        isNull(tokens.imageUrl),
        isNull(tokens.coingeckoId)
      ),
    });
  }
}
