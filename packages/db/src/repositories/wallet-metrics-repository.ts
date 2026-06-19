import { db } from '../client.js';
import { walletMetrics, type WalletMetric } from '../schema/wallet-metrics.js';
import { desc, sql } from 'drizzle-orm';

/**
 * Shared INSERT ... ON CONFLICT tail.
 * CTEs (trade_stats, token_counts, pos_counts) must be defined before this.
 *
 * In the current swap-only model every trade is simultaneously a buy
 * (receives tokenOut) and a sell (spends tokenIn), so:
 *   buyCount = sellCount = totalBoughtTrades = totalSoldTrades = tradeCount
 * Stored separately for forward-compatibility with future trade types.
 */
const UPSERT_TAIL = `
  INSERT INTO wallet_metrics (
    wallet, trade_count, buy_count, sell_count, unique_tokens,
    first_seen, last_seen, active_days, current_open_positions,
    total_bought_trades, total_sold_trades, last_updated
  )
  SELECT
    ts.wallet,
    ts.trade_count::integer,
    ts.trade_count::integer                   AS buy_count,
    ts.trade_count::integer                   AS sell_count,
    COALESCE(tok.unique_tokens, 0)::integer   AS unique_tokens,
    ts.first_seen,
    ts.last_seen,
    ts.active_days::integer,
    COALESCE(pc.open_positions, 0)::integer   AS current_open_positions,
    ts.trade_count::integer                   AS total_bought_trades,
    ts.trade_count::integer                   AS total_sold_trades,
    NOW()
  FROM trade_stats ts
  LEFT JOIN token_counts tok ON tok.wallet = ts.wallet
  LEFT JOIN pos_counts   pc  ON pc.wallet  = ts.wallet
  ON CONFLICT (wallet) DO UPDATE SET
    trade_count            = EXCLUDED.trade_count,
    buy_count              = EXCLUDED.buy_count,
    sell_count             = EXCLUDED.sell_count,
    unique_tokens          = EXCLUDED.unique_tokens,
    first_seen             = EXCLUDED.first_seen,
    last_seen              = EXCLUDED.last_seen,
    active_days            = EXCLUDED.active_days,
    current_open_positions = EXCLUDED.current_open_positions,
    total_bought_trades    = EXCLUDED.total_bought_trades,
    total_sold_trades      = EXCLUDED.total_sold_trades,
    last_updated           = NOW()
`;

// ── Repository ─────────────────────────────────────────────────────────────

export class WalletMetricsRepository {
  // ── Reads ───────────────────────────────────────────────────────────────

  static async getWalletMetrics(wallet: string): Promise<WalletMetric | undefined> {
    const rows = await db
      .select()
      .from(walletMetrics)
      .where(sql`wallet = ${wallet.toLowerCase()}`)
      .limit(1);
    return rows[0];
  }

  /** Most active wallets by total swap count. */
  static async getTopActiveWallets(limit = 20): Promise<WalletMetric[]> {
    return db
      .select()
      .from(walletMetrics)
      .orderBy(desc(walletMetrics.tradeCount))
      .limit(limit);
  }

  /** Wallets with the most recent activity, sorted by lastSeen desc. */
  static async getRecentlyActiveWallets(limit = 20): Promise<WalletMetric[]> {
    return db
      .select()
      .from(walletMetrics)
      .orderBy(desc(walletMetrics.lastSeen))
      .limit(limit);
  }

  // ── Writes ──────────────────────────────────────────────────────────────

  /**
   * Recomputes metrics for a single wallet from source truth.
   */
  static async rebuildWallet(wallet: string): Promise<void> {
    await this.rebuildWallets([wallet]);
  }

  /**
   * Recomputes metrics for a batch of wallets in one SQL statement.
   *
   * Uses wallet IN (...individual params...) rather than ANY($array) because
   * postgres.js/Drizzle serialize a JS string[] as a quoted JSON string, not
   * a PostgreSQL array literal — which causes "malformed array literal" errors.
   * Expanding as individual parameters is safe and correctly parameterized.
   *
   * Always derives from the FULL trade history for those wallets (not deltas),
   * so the result is idempotent and replaying the same wallet list never
   * double-counts anything.
   *
   * Requires wallet_positions to be up-to-date before calling so that
   * currentOpenPositions reflects the latest state.
   */
  static async rebuildWallets(wallets: string[]): Promise<void> {
    if (wallets.length === 0) return;
    const normalized = wallets.map((w) => w.toLowerCase());
    // Expand each wallet as an individual SQL parameter — avoids array serialization issues.
    const walletIn = sql.join(normalized.map((w) => sql`${w}`), sql`, `);

    await db.execute(sql`
      WITH trade_stats AS (
        SELECT
          wallet,
          COUNT(*)                           AS trade_count,
          MIN(timestamp)                     AS first_seen,
          MAX(timestamp)                     AS last_seen,
          COUNT(DISTINCT DATE(timestamp))    AS active_days
        FROM trades
        WHERE wallet IN (${walletIn})
        GROUP BY wallet
      ),
      token_counts AS (
        SELECT wallet, COUNT(DISTINCT token) AS unique_tokens
        FROM (
          SELECT wallet, token_in_address  AS token FROM trades WHERE wallet IN (${walletIn})
          UNION
          SELECT wallet, token_out_address AS token FROM trades WHERE wallet IN (${walletIn})
        ) combined
        GROUP BY wallet
      ),
      pos_counts AS (
        SELECT wallet, COUNT(*) AS open_positions
        FROM wallet_positions
        WHERE wallet IN (${walletIn})
          AND net_amount::numeric > 0
        GROUP BY wallet
      )
      ${sql.raw(UPSERT_TAIL)}
    `);
  }

  /**
   * Full rebuild — recomputes every wallet's metrics in one SQL statement.
   * Expensive: scans all of trades and wallet_positions.
   * Run after PositionRepository.rebuildAll() so currentOpenPositions is
   * accurate.
   */
  static async rebuildAll(): Promise<void> {
    await db.execute(sql`
      WITH trade_stats AS (
        SELECT
          wallet,
          COUNT(*)                           AS trade_count,
          MIN(timestamp)                     AS first_seen,
          MAX(timestamp)                     AS last_seen,
          COUNT(DISTINCT DATE(timestamp))    AS active_days
        FROM trades
        GROUP BY wallet
      ),
      token_counts AS (
        SELECT wallet, COUNT(DISTINCT token) AS unique_tokens
        FROM (
          SELECT wallet, token_in_address  AS token FROM trades
          UNION
          SELECT wallet, token_out_address AS token FROM trades
        ) combined
        GROUP BY wallet
      ),
      pos_counts AS (
        SELECT wallet, COUNT(*) AS open_positions
        FROM wallet_positions
        WHERE net_amount::numeric > 0
        GROUP BY wallet
      )
      ${sql.raw(UPSERT_TAIL)}
    `);
  }

  /**
   * Low-level upsert for callers that have pre-computed metric values.
   * Prefer rebuildWallet / rebuildWallets for correctness.
   */
  static async upsertMetrics(metrics: {
    wallet:               string;
    tradeCount:           number;
    buyCount:             number;
    sellCount:            number;
    uniqueTokens:         number;
    firstSeen:            Date | null;
    lastSeen:             Date | null;
    activeDays:           number;
    currentOpenPositions: number;
    totalBoughtTrades:    number;
    totalSoldTrades:      number;
  }): Promise<void> {
    await db
      .insert(walletMetrics)
      .values({ ...metrics, wallet: metrics.wallet.toLowerCase(), lastUpdated: new Date() })
      .onConflictDoUpdate({
        target: walletMetrics.wallet,
        set: {
          tradeCount:           metrics.tradeCount,
          buyCount:             metrics.buyCount,
          sellCount:            metrics.sellCount,
          uniqueTokens:         metrics.uniqueTokens,
          firstSeen:            metrics.firstSeen,
          lastSeen:             metrics.lastSeen,
          activeDays:           metrics.activeDays,
          currentOpenPositions: metrics.currentOpenPositions,
          totalBoughtTrades:    metrics.totalBoughtTrades,
          totalSoldTrades:      metrics.totalSoldTrades,
          lastUpdated:          new Date(),
        },
      });
  }
}
