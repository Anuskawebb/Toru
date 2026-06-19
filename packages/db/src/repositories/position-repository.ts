import { db } from '../client.js';
import { walletPositions, type WalletPosition, type InsertWalletPosition } from '../schema/wallet-positions.js';
import { eq, and, sql } from 'drizzle-orm';

// Shared input type for incremental trade application.
export interface TradeInput {
  wallet: string;
  tokenInAddress: string;
  tokenOutAddress: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  amountIn: string;
  amountOut: string;
  timestamp: Date;
}

export class PositionRepository {
  /**
   * Inserts or updates a wallet position.
   * Normalizes wallet and tokenAddress to lowercase before storage.
   */
  static async upsertPosition(position: InsertWalletPosition): Promise<void> {
    const normalized = {
      ...position,
      wallet:       position.wallet.toLowerCase(),
      tokenAddress: position.tokenAddress.toLowerCase(),
    };
    await db.insert(walletPositions)
      .values(normalized)
      .onConflictDoUpdate({
        target: [walletPositions.wallet, walletPositions.tokenAddress],
        set: {
          tokenSymbol:   normalized.tokenSymbol,
          tokenDecimals: normalized.tokenDecimals,
          totalBought:   normalized.totalBought   ?? '0',
          totalSold:     normalized.totalSold     ?? '0',
          netAmount:     normalized.netAmount     ?? '0',
          firstTradeAt:  sql`LEAST(${walletPositions.firstTradeAt}, EXCLUDED.first_trade_at)`,
          lastTradeAt:   sql`GREATEST(${walletPositions.lastTradeAt}, EXCLUDED.last_trade_at)`,
          tradeCount:    normalized.tradeCount    ?? 0,
          updatedAt:     new Date(),
        },
      });
  }

  static async getPosition(wallet: string, token: string): Promise<WalletPosition | undefined> {
    return db.query.walletPositions.findFirst({
      where: and(
        eq(walletPositions.wallet,       wallet.toLowerCase()),
        eq(walletPositions.tokenAddress, token.toLowerCase()),
      ),
    });
  }

  static async getWalletPositions(wallet: string): Promise<WalletPosition[]> {
    return db.query.walletPositions.findMany({
      where: eq(walletPositions.wallet, wallet.toLowerCase()),
    });
  }

  static async deleteWalletPositions(wallet: string): Promise<void> {
    await db.delete(walletPositions)
      .where(eq(walletPositions.wallet, wallet.toLowerCase()));
  }

  /**
   * Rebuilds positions for a single wallet atomically.
   * Uses LEFT JOIN tokens for authoritative symbol/decimals.
   * Falls back to MAX() from trade rows when the token isn't in the tokens table.
   * C1 fix: delete + insert run inside one transaction — no gap where positions are missing.
   */
  static async rebuildWallet(wallet: string): Promise<void> {
    const normalizedWallet = wallet.toLowerCase();

    await db.transaction(async (tx) => {
      await tx.delete(walletPositions)
        .where(eq(walletPositions.wallet, normalizedWallet));

      await tx.execute(sql`
        WITH trade_parts AS (
          SELECT
            wallet,
            token_out_address   AS token_address,
            token_out_symbol    AS token_symbol,
            token_out_decimals  AS token_decimals,
            amount_out::numeric AS bought_amount,
            0::numeric          AS sold_amount,
            timestamp,
            1                   AS trade_cnt
          FROM trades
          WHERE wallet = ${normalizedWallet}

          UNION ALL

          SELECT
            wallet,
            token_in_address   AS token_address,
            token_in_symbol    AS token_symbol,
            token_in_decimals  AS token_decimals,
            0::numeric         AS bought_amount,
            amount_in::numeric AS sold_amount,
            timestamp,
            1                  AS trade_cnt
          FROM trades
          WHERE wallet = ${normalizedWallet}
        ),
        aggregated AS (
          SELECT
            wallet,
            token_address,
            MAX(token_symbol)              AS fallback_symbol,
            MAX(token_decimals)            AS fallback_decimals,
            trunc(SUM(bought_amount))::text AS total_bought,
            trunc(SUM(sold_amount))::text   AS total_sold,
            trunc(SUM(bought_amount) - SUM(sold_amount))::text AS net_amount,
            MIN(timestamp)                 AS first_trade_at,
            MAX(timestamp)                 AS last_trade_at,
            SUM(trade_cnt)::integer        AS trade_count
          FROM trade_parts
          GROUP BY wallet, token_address
        )
        INSERT INTO wallet_positions (
          wallet, token_address, token_symbol, token_decimals,
          total_bought, total_sold, net_amount,
          first_trade_at, last_trade_at, trade_count, updated_at
        )
        SELECT
          a.wallet,
          a.token_address,
          COALESCE(tok.symbol,           a.fallback_symbol)   AS token_symbol,
          COALESCE(tok.decimals,         a.fallback_decimals) AS token_decimals,
          a.total_bought,
          a.total_sold,
          a.net_amount,
          a.first_trade_at,
          a.last_trade_at,
          a.trade_count,
          NOW()                                                AS updated_at
        FROM aggregated a
        LEFT JOIN tokens tok ON tok.address = a.token_address
        ON CONFLICT (wallet, token_address) DO UPDATE SET
          token_symbol   = EXCLUDED.token_symbol,
          token_decimals = EXCLUDED.token_decimals,
          total_bought   = EXCLUDED.total_bought,
          total_sold     = EXCLUDED.total_sold,
          net_amount     = EXCLUDED.net_amount,
          first_trade_at = EXCLUDED.first_trade_at,
          last_trade_at  = EXCLUDED.last_trade_at,
          trade_count    = EXCLUDED.trade_count,
          updated_at     = EXCLUDED.updated_at
      `);
    });
  }

  /**
   * Rebuilds positions for all wallets.
   * Uses LEFT JOIN tokens for authoritative symbol/decimals.
   * Runs inside a single transaction — consistent snapshot, safe on concurrent reads.
   */
  static async rebuildAll(): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(walletPositions);

      await tx.execute(sql`
        WITH trade_parts AS (
          SELECT
            wallet,
            token_out_address   AS token_address,
            token_out_symbol    AS token_symbol,
            token_out_decimals  AS token_decimals,
            amount_out::numeric AS bought_amount,
            0::numeric          AS sold_amount,
            timestamp,
            1                   AS trade_cnt
          FROM trades

          UNION ALL

          SELECT
            wallet,
            token_in_address   AS token_address,
            token_in_symbol    AS token_symbol,
            token_in_decimals  AS token_decimals,
            0::numeric         AS bought_amount,
            amount_in::numeric AS sold_amount,
            timestamp,
            1                  AS trade_cnt
          FROM trades
        ),
        aggregated AS (
          SELECT
            wallet,
            token_address,
            MAX(token_symbol)              AS fallback_symbol,
            MAX(token_decimals)            AS fallback_decimals,
            trunc(SUM(bought_amount))::text AS total_bought,
            trunc(SUM(sold_amount))::text   AS total_sold,
            trunc(SUM(bought_amount) - SUM(sold_amount))::text AS net_amount,
            MIN(timestamp)                 AS first_trade_at,
            MAX(timestamp)                 AS last_trade_at,
            SUM(trade_cnt)::integer        AS trade_count
          FROM trade_parts
          GROUP BY wallet, token_address
        )
        INSERT INTO wallet_positions (
          wallet, token_address, token_symbol, token_decimals,
          total_bought, total_sold, net_amount,
          first_trade_at, last_trade_at, trade_count, updated_at
        )
        SELECT
          a.wallet,
          a.token_address,
          COALESCE(tok.symbol,   a.fallback_symbol)   AS token_symbol,
          COALESCE(tok.decimals, a.fallback_decimals) AS token_decimals,
          a.total_bought,
          a.total_sold,
          a.net_amount,
          a.first_trade_at,
          a.last_trade_at,
          a.trade_count,
          NOW()                                        AS updated_at
        FROM aggregated a
        LEFT JOIN tokens tok ON tok.address = a.token_address
        ON CONFLICT (wallet, token_address) DO UPDATE SET
          token_symbol   = EXCLUDED.token_symbol,
          token_decimals = EXCLUDED.token_decimals,
          total_bought   = EXCLUDED.total_bought,
          total_sold     = EXCLUDED.total_sold,
          net_amount     = EXCLUDED.net_amount,
          first_trade_at = EXCLUDED.first_trade_at,
          last_trade_at  = EXCLUDED.last_trade_at,
          trade_count    = EXCLUDED.trade_count,
          updated_at     = EXCLUDED.updated_at
      `);
    });
  }

  /**
   * Applies a batch of trades to wallet positions in a single DB roundtrip.
   *
   * Step 1 (JS): accumulate per-(wallet, token) deltas using BigInt.
   * Step 2 (SQL): single bulk INSERT ... ON CONFLICT DO UPDATE using EXCLUDED.*
   *   for row-specific arithmetic — one network roundtrip regardless of how
   *   many unique pairs are in the batch.
   *
   * Replaces the previous approach that issued N sequential upserts inside a
   * transaction (O(N × RTT) — prohibitively slow over a high-latency DB link).
   */
  static async applyTrades(trades: TradeInput[]): Promise<void> {
    if (trades.length === 0) return;

    type Delta = {
      wallet:        string;
      tokenAddress:  string;
      tokenSymbol:   string;
      tokenDecimals: number;
      soldDelta:     bigint;
      boughtDelta:   bigint;
      firstTradeAt:  Date;
      lastTradeAt:   Date;
      tradeCount:    number;
    };

    const deltas = new Map<string, Delta>();

    function accumulate(
      wallet:        string,
      tokenAddress:  string,
      tokenSymbol:   string,
      tokenDecimals: number,
      sold:   bigint,
      bought: bigint,
      ts:     Date,
    ): void {
      const key = `${wallet}|${tokenAddress}`;
      const d = deltas.get(key);
      if (d) {
        d.soldDelta   += sold;
        d.boughtDelta += bought;
        if (ts < d.firstTradeAt) d.firstTradeAt = ts;
        if (ts > d.lastTradeAt)  d.lastTradeAt  = ts;
        d.tradeCount++;
      } else {
        deltas.set(key, {
          wallet, tokenAddress, tokenSymbol, tokenDecimals,
          soldDelta: sold, boughtDelta: bought,
          firstTradeAt: ts, lastTradeAt: ts, tradeCount: 1,
        });
      }
    }

    for (const t of trades) {
      const wallet   = t.wallet.toLowerCase();
      const tokenIn  = t.tokenInAddress.toLowerCase();
      const tokenOut = t.tokenOutAddress.toLowerCase();
      accumulate(wallet, tokenIn,  t.tokenInSymbol,  t.tokenInDecimals,  BigInt(t.amountIn),  0n,                 t.timestamp);
      accumulate(wallet, tokenOut, t.tokenOutSymbol, t.tokenOutDecimals, 0n,                  BigInt(t.amountOut), t.timestamp);
    }

    // Build one row per unique (wallet, token) pair.
    // The `totalBought`/`totalSold`/`netAmount` fields carry the DELTA from this
    // batch, not the running total. The ON CONFLICT clause adds them to the
    // existing row via EXCLUDED.* arithmetic, so the single-statement path and
    // the insert-new-row path are both correct.
    const rows = [...deltas.values()].map((d) => {
      const netDelta = d.boughtDelta - d.soldDelta;
      return {
        wallet:        d.wallet,
        tokenAddress:  d.tokenAddress,
        tokenSymbol:   d.tokenSymbol,
        tokenDecimals: d.tokenDecimals,
        totalBought:   d.boughtDelta.toString(),
        totalSold:     d.soldDelta.toString(),
        netAmount:     netDelta.toString(),
        firstTradeAt:  d.firstTradeAt,
        lastTradeAt:   d.lastTradeAt,
        tradeCount:    d.tradeCount,
        updatedAt:     new Date(),
      };
    });

    // Single bulk INSERT — one roundtrip for all pairs.
    // EXCLUDED.* refers to the proposed (incoming) row for each conflict,
    // enabling per-row arithmetic against the existing stored values.
    await db.insert(walletPositions)
      .values(rows)
      .onConflictDoUpdate({
        target: [walletPositions.wallet, walletPositions.tokenAddress],
        set: {
          totalBought:  sql`trunc(${walletPositions.totalBought}::numeric  + EXCLUDED.total_bought::numeric)::text`,
          totalSold:    sql`trunc(${walletPositions.totalSold}::numeric    + EXCLUDED.total_sold::numeric)::text`,
          netAmount:    sql`trunc(${walletPositions.netAmount}::numeric    + EXCLUDED.net_amount::numeric)::text`,
          firstTradeAt: sql`LEAST(${walletPositions.firstTradeAt},    EXCLUDED.first_trade_at)`,
          lastTradeAt:  sql`GREATEST(${walletPositions.lastTradeAt},  EXCLUDED.last_trade_at)`,
          tradeCount:   sql`${walletPositions.tradeCount} + EXCLUDED.trade_count`,
          updatedAt:    new Date(),
        },
      });
  }

  /**
   * Convenience wrapper — applies a single trade.
   * Delegates to applyTrades so the transaction/upsert logic is unified.
   */
  static async applyTrade(trade: TradeInput): Promise<void> {
    await this.applyTrades([trade]);
  }
}
