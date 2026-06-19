import { db } from '../client.js';
import { walletScores, type WalletScore } from '../schema/wallet-scores.js';
import { asc, desc, eq, sql } from 'drizzle-orm';

// ── Score weights ──────────────────────────────────────────────────────────────
//
// These weights determine the composite rankScore.  Export them so callers
// can inspect them for explanation purposes without parsing SQL.
//
// Rationale:
//   activity (40%)     — volume is the strongest signal of a meaningful trader;
//                        a wallet with 1 trade is not worth following.
//   conviction (30%)   — holding what you buy indicates a real thesis, not noise.
//   breadth (20%)      — broad market exposure is a secondary signal of
//                        seriousness; high breadth + high conviction = quality.
//   consistency (10%)  — focus on repeated tokens is useful but not definitive;
//                        many good traders explore widely (low consistency).

export const SCORE_WEIGHTS = {
  activity:    0.40,
  conviction:  0.30,
  breadth:     0.20,
  consistency: 0.10,
} as const;

// ── Classification thresholds ──────────────────────────────────────────────────
//
// Applied in priority order (first match wins).  All thresholds are calibrated
// against the live BSC dataset distribution as of 2026-06-18:
//
//   bot         — high volume (≥100 trades) in ≤5 tokens. Automated.
//                 Observed examples: 446 trades / 2 tokens, 404 trades / 2 tokens.
//
//   degen       — high volume (≥50 trades) AND broad exposure (≥15 tokens).
//                 Observed examples: 1,737 trades / 185 tokens.
//
//   accumulator — holds ≥70% of tokens traded net-long AND ≥5 trades.
//                 Conviction-based buyer who doesn't flip.
//
//   scout       — broad token exposure (≥15) but low volume (<50 trades).
//                 Explores many tokens without deep commitment.
//
//   flipper     — moderate-to-high volume (≥10 trades) with very low retention
//                 (≤15% of tokens held). Fast in-out.
//
//   retail      — low volume (<10 trades). Typical casual wallet.
//
//   unknown     — everything else (moderate trades, moderate conviction, few tokens).

export const CLASSIFICATION_THRESHOLDS = {
  bot:         { minTrades: 100, maxUniqueTokens: 5 },
  degen:       { minTrades: 50,  minUniqueTokens: 15 },
  accumulator: { minConvictionRatio: 0.70, minTrades: 5 },
  scout:       { minUniqueTokens: 15, maxTrades: 49 },
  flipper:     { minTrades: 10, maxConvictionRatio: 0.15 },
  retail:      { maxTrades: 9 },
} as const;

// ── Core scoring SQL ───────────────────────────────────────────────────────────
//
// Single-statement batch rebuild.  Uses window functions (PERCENT_RANK) so all
// wallets are scored relative to each other — scores change when new wallets
// are indexed.  Must be run against the full wallet_metrics table to be correct.

const REBUILD_SQL = `
  WITH base AS (
    SELECT
      wallet,
      trade_count,
      unique_tokens,
      current_open_positions,
      active_days,
      current_open_positions::numeric / NULLIF(unique_tokens, 0)  AS conviction_ratio,
      trade_count::numeric           / NULLIF(unique_tokens, 0)  AS focus_ratio
    FROM wallet_metrics
  ),
  scored AS (
    SELECT
      wallet,
      trade_count,
      unique_tokens,
      current_open_positions,
      active_days,
      conviction_ratio,

      -- Activity: percentile rank by trade volume (0-100)
      ROUND(
        (PERCENT_RANK() OVER (ORDER BY trade_count))::numeric * 100,
      2) AS activity_score,

      -- Conviction: fraction of unique tokens still held net-long (0-100)
      ROUND(
        LEAST(100.0, COALESCE(conviction_ratio, 0) * 100),
      2) AS conviction_score,

      -- Breadth: percentile rank by unique token count (0-100)
      ROUND(
        (PERCENT_RANK() OVER (ORDER BY unique_tokens))::numeric * 100,
      2) AS breadth_score,

      -- Consistency: percentile rank by trades-per-unique-token (0-100)
      -- High = systematically revisits same tokens; low = broad explorer.
      ROUND(
        (PERCENT_RANK() OVER (ORDER BY COALESCE(focus_ratio, 0)))::numeric * 100,
      2) AS consistency_score
    FROM base
  ),
  with_rank AS (
    SELECT
      *,
      ROUND(
        activity_score    * 0.40 +
        conviction_score  * 0.30 +
        breadth_score     * 0.20 +
        consistency_score * 0.10,
      2) AS rank_score,

      CASE
        WHEN trade_count >= 100 AND unique_tokens <= 5
          THEN 'bot'
        WHEN trade_count >= 50  AND unique_tokens >= 15
          THEN 'degen'
        WHEN conviction_ratio >= 0.70 AND trade_count >= 5
          THEN 'accumulator'
        WHEN unique_tokens >= 15 AND trade_count < 50
          THEN 'scout'
        WHEN trade_count >= 10 AND COALESCE(conviction_ratio, 0) <= 0.15
          THEN 'flipper'
        WHEN trade_count < 10
          THEN 'retail'
        ELSE 'unknown'
      END AS classification
    FROM scored
  )
  INSERT INTO wallet_scores (
    wallet,
    activity_score, conviction_score, breadth_score, consistency_score,
    rank_score, rank_position, classification,
    trade_count, unique_tokens, current_open_positions, active_days,
    last_updated
  )
  SELECT
    wallet,
    activity_score, conviction_score, breadth_score, consistency_score,
    rank_score,
    RANK() OVER (ORDER BY rank_score DESC) AS rank_position,
    classification,
    trade_count, unique_tokens, current_open_positions, active_days,
    NOW()
  FROM with_rank
  ON CONFLICT (wallet) DO UPDATE SET
    activity_score         = EXCLUDED.activity_score,
    conviction_score       = EXCLUDED.conviction_score,
    breadth_score          = EXCLUDED.breadth_score,
    consistency_score      = EXCLUDED.consistency_score,
    rank_score             = EXCLUDED.rank_score,
    rank_position          = EXCLUDED.rank_position,
    classification         = EXCLUDED.classification,
    trade_count            = EXCLUDED.trade_count,
    unique_tokens          = EXCLUDED.unique_tokens,
    current_open_positions = EXCLUDED.current_open_positions,
    active_days            = EXCLUDED.active_days,
    last_updated           = NOW()
`;

// ── Repository ─────────────────────────────────────────────────────────────────

export class WalletScoresRepository {
  // ── Reads ────────────────────────────────────────────────────────────────────

  static async getScore(wallet: string): Promise<WalletScore | undefined> {
    const rows = await db
      .select()
      .from(walletScores)
      .where(eq(walletScores.wallet, wallet.toLowerCase()))
      .limit(1);
    return rows[0];
  }

  /**
   * Top-ranked wallets by composite rank_score.
   * rank_position 1 = highest ranked.
   */
  static async getTopRanked(limit = 20): Promise<WalletScore[]> {
    return db
      .select()
      .from(walletScores)
      .orderBy(asc(walletScores.rankPosition))
      .limit(limit);
  }

  /**
   * All wallets of a given classification, ordered by rank_score desc.
   * Valid classes: bot | degen | accumulator | scout | flipper | retail | unknown
   */
  static async getByClassification(classification: string, limit = 50): Promise<WalletScore[]> {
    return db
      .select()
      .from(walletScores)
      .where(eq(walletScores.classification, classification))
      .orderBy(desc(walletScores.rankScore))
      .limit(limit);
  }

  /** Count of wallets per classification. */
  static async getClassificationBreakdown(): Promise<Array<{ classification: string; count: number }>> {
    const rows = await db.execute<{ classification: string; count: string }>(sql`
      SELECT classification, COUNT(*) AS count
      FROM wallet_scores
      GROUP BY classification
      ORDER BY count DESC
    `);
    return rows.map((r) => ({ classification: r.classification, count: Number(r.count) }));
  }

  /** Score distribution stats for each component (min/p25/median/p75/max). */
  static async getScoreDistribution(): Promise<Record<string, Record<string, number>>> {
    const rows = await db.execute<{
      score_type: string;
      min: string; p25: string; median: string; p75: string; max: string;
    }>(sql`
      SELECT
        score_type,
        ROUND(MIN(score)::numeric,  2) AS min,
        ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY score)::numeric, 2) AS p25,
        ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY score)::numeric, 2) AS median,
        ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY score)::numeric, 2) AS p75,
        ROUND(MAX(score)::numeric,  2) AS max
      FROM (
        SELECT 'activity'    AS score_type, activity_score::numeric    AS score FROM wallet_scores
        UNION ALL
        SELECT 'conviction'  AS score_type, conviction_score::numeric  AS score FROM wallet_scores
        UNION ALL
        SELECT 'breadth'     AS score_type, breadth_score::numeric     AS score FROM wallet_scores
        UNION ALL
        SELECT 'consistency' AS score_type, consistency_score::numeric AS score FROM wallet_scores
        UNION ALL
        SELECT 'rank'        AS score_type, rank_score::numeric        AS score FROM wallet_scores
      ) s
      GROUP BY score_type
      ORDER BY score_type
    `);
    return Object.fromEntries(
      rows.map((r) => [
        r.score_type,
        { min: Number(r.min), p25: Number(r.p25), median: Number(r.median), p75: Number(r.p75), max: Number(r.max) },
      ]),
    );
  }

  // ── Writes ───────────────────────────────────────────────────────────────────

  /**
   * Full scoring rebuild.
   *
   * Reads all rows from wallet_metrics, computes percentile-based scores
   * (PERCENT_RANK window functions), classifies each wallet, assigns rank
   * positions, and upserts wallet_scores.
   *
   * MUST be run against the complete wallet_metrics dataset — window functions
   * produce correct percentile ranks only when all wallets are present.
   * Running against a subset produces locally-correct but globally-wrong scores.
   *
   * Typical performance: 23,500 wallets in ~3-5s (single SQL statement).
   *
   * Call order for a full refresh:
   *   1. PositionRepository.rebuildAll()
   *   2. WalletMetricsRepository.rebuildAll()
   *   3. WalletScoresRepository.rebuildAll()   ← this method
   */
  static async rebuildAll(): Promise<void> {
    await db.execute(sql.raw(REBUILD_SQL));
  }
}
