import { db } from '../client.js';
import { tokenMetrics, type TokenMetric, QUALITY_HOLDER_THRESHOLD } from '../schema/token-metrics.js';
import { desc, eq, sql } from 'drizzle-orm';

// ── Shared INSERT … ON CONFLICT tail ──────────────────────────────────────────
//
// This tail is appended to both rebuildAll() and rebuildToken() CTEs.
// All six CTE names must be defined by the caller before this raw string:
//   token_stats, active_stats, holder_stats, quality_holder_stats,
//   token_meta, tokens_table
//
// Column semantics:
//   token_symbol    — tokens table wins (authoritative); falls back to trade-embedded symbol.
//   token_decimals  — same preference as symbol.
//   trade_count     — total appearances as tokenIn or tokenOut.
//   buy_trades      — appearances as tokenOut (someone bought this token).
//   sell_trades     — appearances as tokenIn (someone sold this token).
//   unique_traders  — distinct wallets from either side.
//   unique_buyers   — distinct wallets where this was tokenOut.
//   unique_sellers  — distinct wallets where this was tokenIn.
//   holder_count    — wallet_positions rows with net_amount > 0.
//   quality_holder_count — holder_count restricted to rank_score >= QUALITY_HOLDER_THRESHOLD.
//   active_wallet_count  — distinct wallets in last 24h of dataset window.
//   net_holders          — unique_buyers - unique_sellers (can be negative).

const UPSERT_TAIL = `
  INSERT INTO token_metrics (
    token_address, token_symbol, token_decimals,
    trade_count, buy_trades, sell_trades,
    unique_traders, unique_buyers, unique_sellers,
    holder_count, quality_holder_count, active_wallet_count,
    net_holders, first_seen, last_seen, last_updated
  )
  SELECT
    ts.token_address,
    COALESCE(NULLIF(tt.symbol,  ''), NULLIF(tm.symbol,  ''), 'UNKNOWN') AS token_symbol,
    COALESCE(tt.decimals, tm.decimals, 18)                               AS token_decimals,
    ts.trade_count::integer,
    ts.buy_trades::integer,
    ts.sell_trades::integer,
    ts.unique_traders::integer,
    ts.unique_buyers::integer,
    ts.unique_sellers::integer,
    COALESCE(hs.holder_count,          0)::integer AS holder_count,
    COALESCE(qh.quality_holder_count,  0)::integer AS quality_holder_count,
    COALESCE(ac.active_wallet_count,   0)::integer AS active_wallet_count,
    (ts.unique_buyers - ts.unique_sellers)::integer AS net_holders,
    ts.first_seen,
    ts.last_seen,
    NOW()
  FROM token_stats ts
  LEFT JOIN active_stats         ac ON ac.token_address = ts.token_address
  LEFT JOIN holder_stats         hs ON hs.token_address = ts.token_address
  LEFT JOIN quality_holder_stats qh ON qh.token_address = ts.token_address
  LEFT JOIN token_meta           tm ON tm.token_address = ts.token_address
  LEFT JOIN tokens_table         tt ON tt.token_address = ts.token_address
  ON CONFLICT (token_address) DO UPDATE SET
    token_symbol           = EXCLUDED.token_symbol,
    token_decimals         = EXCLUDED.token_decimals,
    trade_count            = EXCLUDED.trade_count,
    buy_trades             = EXCLUDED.buy_trades,
    sell_trades            = EXCLUDED.sell_trades,
    unique_traders         = EXCLUDED.unique_traders,
    unique_buyers          = EXCLUDED.unique_buyers,
    unique_sellers         = EXCLUDED.unique_sellers,
    holder_count           = EXCLUDED.holder_count,
    quality_holder_count   = EXCLUDED.quality_holder_count,
    active_wallet_count    = EXCLUDED.active_wallet_count,
    net_holders            = EXCLUDED.net_holders,
    first_seen             = EXCLUDED.first_seen,
    last_seen              = EXCLUDED.last_seen,
    last_updated           = NOW()
`;

// ── Repository ─────────────────────────────────────────────────────────────────

export class TokenMetricsRepository {
  // ── Reads ────────────────────────────────────────────────────────────────────

  static async getTokenMetrics(tokenAddress: string): Promise<TokenMetric | undefined> {
    const rows = await db
      .select()
      .from(tokenMetrics)
      .where(eq(tokenMetrics.tokenAddress, tokenAddress.toLowerCase()))
      .limit(1);
    return rows[0];
  }

  /** Tokens with the highest total swap count (most traded). */
  static async getTopTokensByTraders(limit = 20): Promise<TokenMetric[]> {
    return db
      .select()
      .from(tokenMetrics)
      .orderBy(desc(tokenMetrics.uniqueTraders))
      .limit(limit);
  }

  /**
   * Tokens with the most quality holders.
   *
   * quality_holder_count = wallets with rank_score >= QUALITY_HOLDER_THRESHOLD
   * currently holding a net-long position in this token.
   *
   * This is the primary smart-money indicator in the token intelligence layer.
   */
  static async getTopTokensByQualityHolders(limit = 20): Promise<TokenMetric[]> {
    return db
      .select()
      .from(tokenMetrics)
      .orderBy(desc(tokenMetrics.qualityHolderCount))
      .limit(limit);
  }

  /** Tokens with the most recent trading activity, sorted by last_seen desc. */
  static async getRecentlyActiveTokens(limit = 20): Promise<TokenMetric[]> {
    return db
      .select()
      .from(tokenMetrics)
      .orderBy(desc(tokenMetrics.lastSeen))
      .limit(limit);
  }

  /**
   * Tokens with the most total trades, ordered by trade_count desc.
   * Distinct from getTopTokensByTraders — high trade_count with low unique_traders
   * indicates concentrated activity (possibly a bot or whale).
   */
  static async getMostTradedTokens(limit = 20): Promise<TokenMetric[]> {
    return db
      .select()
      .from(tokenMetrics)
      .orderBy(desc(tokenMetrics.tradeCount))
      .limit(limit);
  }

  // ── Writes ───────────────────────────────────────────────────────────────────

  /**
   * Recomputes metrics for a single token from source truth.
   *
   * Reads from trades, wallet_positions, and wallet_scores — all three must be
   * up-to-date before calling this.  Uses the same CTE structure as rebuildAll()
   * but filtered to the single token, so the result is one upserted row.
   */
  static async rebuildToken(tokenAddress: string): Promise<void> {
    const t = tokenAddress.toLowerCase();
    await db.execute(sql`
      WITH
      all_token_mentions AS (
        SELECT token_out_address AS token_address, wallet, 'buy'  AS side, timestamp
        FROM trades WHERE token_out_address = ${t}
        UNION ALL
        SELECT token_in_address  AS token_address, wallet, 'sell' AS side, timestamp
        FROM trades WHERE token_in_address  = ${t}
      ),
      token_stats AS (
        SELECT
          token_address,
          COUNT(*)                                              AS trade_count,
          COUNT(*) FILTER (WHERE side = 'buy')                 AS buy_trades,
          COUNT(*) FILTER (WHERE side = 'sell')                AS sell_trades,
          COUNT(DISTINCT wallet)                               AS unique_traders,
          COUNT(DISTINCT wallet) FILTER (WHERE side = 'buy')  AS unique_buyers,
          COUNT(DISTINCT wallet) FILTER (WHERE side = 'sell') AS unique_sellers,
          MIN(timestamp)                                       AS first_seen,
          MAX(timestamp)                                       AS last_seen
        FROM all_token_mentions
        GROUP BY token_address
      ),
      active_stats AS (
        SELECT token_address, COUNT(DISTINCT wallet) AS active_wallet_count
        FROM all_token_mentions
        WHERE timestamp > (SELECT MAX(timestamp) FROM trades) - INTERVAL '24 hours'
        GROUP BY token_address
      ),
      holder_stats AS (
        SELECT
          token_address,
          COUNT(*) FILTER (WHERE net_amount::numeric > 0) AS holder_count
        FROM wallet_positions
        WHERE token_address = ${t}
        GROUP BY token_address
      ),
      quality_holder_stats AS (
        SELECT wp.token_address, COUNT(*) AS quality_holder_count
        FROM wallet_positions wp
        JOIN wallet_scores ws ON ws.wallet = wp.wallet
        WHERE wp.token_address = ${t}
          AND wp.net_amount::numeric > 0
          AND ws.rank_score::numeric >= ${QUALITY_HOLDER_THRESHOLD}
        GROUP BY wp.token_address
      ),
      token_meta AS (
        SELECT DISTINCT ON (token_address) token_address, symbol, decimals
        FROM (
          SELECT token_out_address AS token_address, token_out_symbol AS symbol, token_out_decimals AS decimals
          FROM trades WHERE token_out_address = ${t}
          UNION ALL
          SELECT token_in_address  AS token_address, token_in_symbol  AS symbol, token_in_decimals  AS decimals
          FROM trades WHERE token_in_address  = ${t}
        ) m
        ORDER BY token_address, (symbol = '' OR symbol IS NULL) ASC
      ),
      tokens_table AS (
        SELECT address AS token_address, symbol, decimals FROM tokens WHERE address = ${t}
      )
      ${sql.raw(UPSERT_TAIL)}
    `);
  }

  /**
   * Full rebuild — recomputes metrics for every token in one SQL statement.
   *
   * Processes all 2,690+ distinct tokens from the trades table in a single pass:
   *   1. all_token_mentions — UNION ALL of tokenOut (buys) and tokenIn (sells)
   *   2. token_stats        — grouped counts and timestamps per token
   *   3. active_stats       — traders in last 24h of dataset window
   *   4. holder_stats       — net-long positions per token from wallet_positions
   *   5. quality_holder_stats — holder_stats filtered to rank_score >= 80
   *   6. token_meta         — best available symbol/decimals from trade rows
   *   7. tokens_table       — authoritative symbol/decimals from the tokens table
   *
   * Dependency ordering: rebuildAll() must be called AFTER
   *   PositionRepository.rebuildAll()
   *   WalletMetricsRepository.rebuildAll()
   *   WalletScoresRepository.rebuildAll()
   * because quality_holder_count joins wallet_scores and holder_count reads
   * wallet_positions.
   *
   * Performance target: < 10s for 2,690 tokens.
   */
  static async rebuildAll(): Promise<void> {
    await db.execute(sql`
      WITH
      all_token_mentions AS (
        SELECT token_out_address AS token_address, wallet, 'buy'  AS side, timestamp
        FROM trades
        UNION ALL
        SELECT token_in_address  AS token_address, wallet, 'sell' AS side, timestamp
        FROM trades
      ),
      token_stats AS (
        SELECT
          token_address,
          COUNT(*)                                              AS trade_count,
          COUNT(*) FILTER (WHERE side = 'buy')                 AS buy_trades,
          COUNT(*) FILTER (WHERE side = 'sell')                AS sell_trades,
          COUNT(DISTINCT wallet)                               AS unique_traders,
          COUNT(DISTINCT wallet) FILTER (WHERE side = 'buy')  AS unique_buyers,
          COUNT(DISTINCT wallet) FILTER (WHERE side = 'sell') AS unique_sellers,
          MIN(timestamp)                                       AS first_seen,
          MAX(timestamp)                                       AS last_seen
        FROM all_token_mentions
        GROUP BY token_address
      ),
      active_stats AS (
        SELECT token_address, COUNT(DISTINCT wallet) AS active_wallet_count
        FROM all_token_mentions
        WHERE timestamp > (SELECT MAX(timestamp) FROM trades) - INTERVAL '24 hours'
        GROUP BY token_address
      ),
      holder_stats AS (
        SELECT
          token_address,
          COUNT(*) FILTER (WHERE net_amount::numeric > 0) AS holder_count
        FROM wallet_positions
        GROUP BY token_address
      ),
      quality_holder_stats AS (
        SELECT wp.token_address, COUNT(*) AS quality_holder_count
        FROM wallet_positions wp
        JOIN wallet_scores ws ON ws.wallet = wp.wallet
        WHERE wp.net_amount::numeric > 0
          AND ws.rank_score::numeric >= ${QUALITY_HOLDER_THRESHOLD}
        GROUP BY wp.token_address
      ),
      token_meta AS (
        SELECT DISTINCT ON (token_address) token_address, symbol, decimals
        FROM (
          SELECT token_out_address AS token_address, token_out_symbol AS symbol, token_out_decimals AS decimals
          FROM trades
          UNION ALL
          SELECT token_in_address  AS token_address, token_in_symbol  AS symbol, token_in_decimals  AS decimals
          FROM trades
        ) m
        ORDER BY token_address, (symbol = '' OR symbol IS NULL) ASC
      ),
      tokens_table AS (
        SELECT address AS token_address, symbol, decimals FROM tokens
      )
      ${sql.raw(UPSERT_TAIL)}
    `);
  }
}
