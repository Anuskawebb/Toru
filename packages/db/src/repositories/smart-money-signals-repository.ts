import { db } from '../client.js';
import {
  smartMoneySignals,
  BSC_BASE_TOKENS,
  type SmartMoneySignal,
  type TokenSignalBundle,
} from '../schema/smart-money-signals.js';
import { tokenIntelSnapshots } from '../schema/token-intel-snapshots.js';
import { and, eq, gt, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { QUALITY_HOLDER_THRESHOLD, tokenMetrics } from '../schema/token-metrics.js';

// ── Rebuild SQL ───────────────────────────────────────────────────────────────
//
// Single CTE-chain INSERT … ON CONFLICT that computes every signal from source
// truth (wallet_positions, wallet_scores, token_metrics) in one pass.
//
// Score formula (Phase 5B — temporal signals active):
//   accumulation_score = PERCENT_RANK(quality_entry_count_4h) * 25
//                      + PERCENT_RANK(quality_concentration_pct) * 20
//                      + PERCENT_RANK(avg_quality_rank)          * 20
//                      + PERCENT_RANK(net_accumulation_flow)     * 35
//
// PERCENT_RANK is computed only over tokens that pass the noise floor
// (quality_holder_count >= 3 AND holder_count >= 10). All other tokens receive
// accumulation_score = 0 and signal_tier = 'NOISE'.
//
// net_accumulation_flow (35%) is the dominant dimension because it captures
// the real-time balance of smart-money entries vs exits over 4h.
// quality_entry_count_4h (25%) rewards absolute entry velocity.
// concentration and avg_quality_rank (20% each) reward signal quality / conviction.
//
// PERCENT_RANK() returns double precision; cast to ::numeric before ROUND() —
// PostgreSQL does not have round(double precision, integer).

const REBUILD_SQL = `
WITH
-- Anchor the "recent" time windows to the dataset's last indexed timestamp,
-- not to NOW(). This keeps signals coherent across offline re-runs.
dataset_window AS (
  SELECT MAX(timestamp) AS max_ts FROM trades
),

-- Single combined scan of wallet_positions + wallet_scores per token.
-- Only considers quality wallets (rank_score >= 80).
quality_wallet_stats AS (
  SELECT
    wp.token_address,
    -- Current holders count (net_amount > 0)
    COUNT(DISTINCT wp.wallet) FILTER (WHERE wp.net_amount::numeric > 0) AS quality_holder_count,
    ROUND(AVG(CASE WHEN wp.net_amount::numeric > 0 THEN ws.rank_score ELSE NULL END)::numeric, 2) AS avg_quality_rank,
    
    -- Quality classifications count (for net_amount > 0)
    COUNT(DISTINCT wp.wallet) FILTER (WHERE wp.net_amount::numeric > 0 AND ws.classification = 'accumulator') AS accumulator_count,
    COUNT(DISTINCT wp.wallet) FILTER (WHERE wp.net_amount::numeric > 0 AND ws.classification = 'degen') AS degen_count,
    COUNT(DISTINCT wp.wallet) FILTER (WHERE wp.net_amount::numeric > 0 AND ws.classification = 'bot') AS bot_count,
    COUNT(DISTINCT wp.wallet) FILTER (WHERE wp.net_amount::numeric > 0 AND ws.classification = 'scout') AS scout_count,
    COUNT(DISTINCT CASE WHEN wp.net_amount::numeric > 0 THEN ws.classification ELSE NULL END) AS consensus_diversity,
    
    -- Entries (net_amount > 0 and first_trade_at within window)
    COUNT(DISTINCT wp.wallet) FILTER (WHERE wp.net_amount::numeric > 0 AND wp.first_trade_at > dw.max_ts - INTERVAL '1 hour') AS entry_1h,
    COUNT(DISTINCT wp.wallet) FILTER (WHERE wp.net_amount::numeric > 0 AND wp.first_trade_at > dw.max_ts - INTERVAL '4 hours') AS entry_4h,
    
    -- Exits (net_amount <= 0 and last_trade_at within window)
    COUNT(DISTINCT wp.wallet) FILTER (WHERE wp.net_amount::numeric <= 0 AND wp.last_trade_at > dw.max_ts - INTERVAL '1 hour') AS exit_1h,
    COUNT(DISTINCT wp.wallet) FILTER (WHERE wp.net_amount::numeric <= 0 AND wp.last_trade_at > dw.max_ts - INTERVAL '4 hours') AS exit_4h
  FROM wallet_positions wp
  JOIN wallet_scores ws ON ws.wallet = wp.wallet
  CROSS JOIN dataset_window dw
  WHERE ws.rank_score >= ${QUALITY_HOLDER_THRESHOLD}
  GROUP BY wp.token_address
),

-- Assemble one base row per token. Uses token_metrics for holder_count (already
-- computed correctly in the prior pipeline step) to avoid re-scanning wallet_positions.
signal_base AS (
  SELECT
    tm.token_address,
    tm.token_symbol,
    tm.holder_count,
    COALESCE(qws.quality_holder_count, 0)  AS quality_holder_count,
    COALESCE(qws.avg_quality_rank,     0)  AS avg_quality_rank,
    COALESCE(qws.accumulator_count,    0)  AS accumulator_holder_count,
    COALESCE(qws.degen_count,          0)  AS degen_holder_count,
    COALESCE(qws.bot_count,            0)  AS bot_holder_count,
    COALESCE(qws.scout_count,          0)  AS scout_holder_count,
    COALESCE(qws.consensus_diversity,  0)  AS consensus_diversity,
    COALESCE(qws.entry_1h,  0)             AS quality_entry_count_1h,
    COALESCE(qws.entry_4h,  0)             AS quality_entry_count_4h,
    COALESCE(qws.exit_1h,   0)             AS quality_exit_count_1h,
    COALESCE(qws.exit_4h,   0)             AS quality_exit_count_4h,
    COALESCE(qws.entry_4h, 0) - COALESCE(qws.exit_4h, 0) AS net_accumulation_flow,
    -- Concentration: suppressed to 0 when holder_count < 10 to prevent
    -- misleading percentages from tokens with tiny holder bases (e.g. 1 of 2).
    CASE
      WHEN tm.holder_count >= 10
        THEN ROUND(
          COALESCE(qws.quality_holder_count, 0)::numeric / tm.holder_count * 100,
          2)
      ELSE 0
    END AS quality_concentration_pct,
    -- Noise floor: minimum signal threshold for including in the ranked score.
    COALESCE(qws.quality_holder_count, 0) >= 3
      AND tm.holder_count >= 10 AS meets_minimum_holders
  FROM token_metrics tm
  LEFT JOIN quality_wallet_stats qws ON qws.token_address = tm.token_address
),

-- Compute accumulation_score via PERCENT_RANK, but only for tokens that pass
-- the noise floor. Non-eligible tokens are assigned score 0 via the LEFT JOIN.
-- Each PERCENT_RANK window sees only the eligible subset, so scores reflect
-- relative standing within the meaningful signal population, not the full corpus.
eligible_scored AS (
  SELECT
    token_address,
    ROUND((
      (PERCENT_RANK() OVER (ORDER BY quality_entry_count_4h))::numeric   * 25.0 +
      (PERCENT_RANK() OVER (ORDER BY quality_concentration_pct))::numeric * 20.0 +
      (PERCENT_RANK() OVER (ORDER BY avg_quality_rank))::numeric           * 20.0 +
      (PERCENT_RANK() OVER (ORDER BY net_accumulation_flow))::numeric      * 35.0
    ), 2) AS accumulation_score
  FROM signal_base
  WHERE meets_minimum_holders
),

-- Merge scores back; NOISE tokens receive accumulation_score = 0.
ranked AS (
  SELECT
    sb.*,
    COALESCE(es.accumulation_score, 0) AS accumulation_score
  FROM signal_base sb
  LEFT JOIN eligible_scored es ON es.token_address = sb.token_address
),

-- Determine signal tier.
-- Tier requires BOTH score threshold AND minimum absolute quality_holder_count
-- so that a small-holder token with perfect concentration can't land in STRONG.
tiered AS (
  SELECT
    *,
    CASE
      WHEN NOT meets_minimum_holders                                 THEN 'NOISE'
      WHEN accumulation_score >= 75 AND quality_holder_count >= 10  THEN 'STRONG'
      WHEN accumulation_score >= 50 AND quality_holder_count >= 5   THEN 'MODERATE'
      WHEN accumulation_score >= 25 AND quality_holder_count >= 3   THEN 'WEAK'
      ELSE 'NOISE'
    END AS signal_tier
  FROM ranked
),

with_narrative AS (
  SELECT
    *,
    '' AS narrative
  FROM tiered
)


INSERT INTO smart_money_signals (
  token_address, token_symbol,
  quality_entry_count_1h, quality_entry_count_4h,
  quality_exit_count_1h,  quality_exit_count_4h,
  net_accumulation_flow,
  quality_holder_count, holder_count,
  quality_concentration_pct, avg_quality_rank_score,
  accumulator_holder_count, degen_holder_count,
  bot_holder_count, scout_holder_count,
  consensus_diversity,
  accumulation_score, signal_tier,
  meets_minimum_holders,
  narrative,
  quality_holder_change_24h, trend_direction,
  computed_at
)
SELECT
  token_address, token_symbol,
  quality_entry_count_1h, quality_entry_count_4h,
  quality_exit_count_1h,  quality_exit_count_4h,
  net_accumulation_flow,
  quality_holder_count, holder_count,
  quality_concentration_pct, avg_quality_rank,
  accumulator_holder_count, degen_holder_count,
  bot_holder_count, scout_holder_count,
  consensus_diversity,
  accumulation_score, signal_tier,
  meets_minimum_holders,
  narrative,
  NULL        AS quality_holder_change_24h,
  'UNKNOWN'   AS trend_direction,
  NOW()
FROM with_narrative
ON CONFLICT (token_address) DO UPDATE SET
  token_symbol               = EXCLUDED.token_symbol,
  quality_entry_count_1h     = EXCLUDED.quality_entry_count_1h,
  quality_entry_count_4h     = EXCLUDED.quality_entry_count_4h,
  quality_exit_count_1h      = EXCLUDED.quality_exit_count_1h,
  quality_exit_count_4h      = EXCLUDED.quality_exit_count_4h,
  net_accumulation_flow      = EXCLUDED.net_accumulation_flow,
  quality_holder_count       = EXCLUDED.quality_holder_count,
  holder_count               = EXCLUDED.holder_count,
  quality_concentration_pct  = EXCLUDED.quality_concentration_pct,
  avg_quality_rank_score     = EXCLUDED.avg_quality_rank_score,
  accumulator_holder_count   = EXCLUDED.accumulator_holder_count,
  degen_holder_count         = EXCLUDED.degen_holder_count,
  bot_holder_count           = EXCLUDED.bot_holder_count,
  scout_holder_count         = EXCLUDED.scout_holder_count,
  consensus_diversity        = EXCLUDED.consensus_diversity,
  accumulation_score         = EXCLUDED.accumulation_score,
  signal_tier                = EXCLUDED.signal_tier,
  meets_minimum_holders      = EXCLUDED.meets_minimum_holders,
  narrative                  = EXCLUDED.narrative,
  quality_holder_change_24h  = EXCLUDED.quality_holder_change_24h,
  trend_direction            = EXCLUDED.trend_direction,
  computed_at                = NOW()
`;

// ── Dynamic Temporal enrichment ───────────────────────────────────────────────

const parseUtcDate = (val: string | Date | null | undefined): Date | undefined => {
  if (!val) return undefined;
  let str = '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return undefined;
    const pad = (n: number) => String(n).padStart(2, '0');
    str = `${val.getUTCFullYear()}-${pad(val.getUTCMonth() + 1)}-${pad(val.getUTCDate())} ${pad(val.getUTCHours())}:${pad(val.getUTCMinutes())}:${pad(val.getUTCSeconds())}`;
  } else {
    str = String(val).trim();
  }
  if (!str) return undefined;
  
  let isoStr = str.replace(' ', 'T');
  if (/[+-]\d{2}$/.test(isoStr)) {
    isoStr += ':00';
  }
  const hasTimezone = isoStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(isoStr);
  if (!hasTimezone) {
    isoStr += 'Z';
  }
  
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? undefined : d;
};

/**
 * Enriches raw smart money signals with historical changes, trend analysis,
 * Confidence Score, composite Opportunity Score, signalReasons, riskFlags,
 * and dynamic narratives calculated on-the-fly.
 */
async function enrichSignalsWithHistory(rows: SmartMoneySignal[]): Promise<TokenSignalBundle[]> {
  if (rows.length === 0) return [];

  // 1. Resolve target snapshot timestamps based on database trades watermark
  const targets = await db.execute<{ ts_1h: string | Date | null; ts_24h: string | Date | null; ts_7d: string | Date | null }>(sql`
    WITH dataset_window AS (
      SELECT COALESCE(MAX(timestamp), NOW()) AS max_ts FROM trades
    )
    SELECT
      (SELECT snapshot_at FROM token_intel_snapshots ORDER BY ABS(EXTRACT(EPOCH FROM (snapshot_at - (dw.max_ts - INTERVAL '1 hour')))) LIMIT 1) AS ts_1h,
      (SELECT snapshot_at FROM token_intel_snapshots ORDER BY ABS(EXTRACT(EPOCH FROM (snapshot_at - (dw.max_ts - INTERVAL '24 hours')))) LIMIT 1) AS ts_24h,
      (SELECT snapshot_at FROM token_intel_snapshots ORDER BY ABS(EXTRACT(EPOCH FROM (snapshot_at - (dw.max_ts - INTERVAL '7 days')))) LIMIT 1) AS ts_7d
    FROM dataset_window dw
  `);

  const { ts_1h, ts_24h, ts_7d } = targets[0] ?? {};
  const ts1h  = parseUtcDate(ts_1h);
  const ts24h = parseUtcDate(ts_24h);
  const ts7d  = parseUtcDate(ts_7d);

  const maxTsRow = await db.execute<{ max_ts: string | Date | null }>(sql`
    SELECT COALESCE(MAX(timestamp), NOW()) AS max_ts FROM trades
  `);
  const maxTs = parseUtcDate(maxTsRow[0]?.max_ts) ?? new Date();

  // 2. Fetch snapshots for all tokens in query scope in a single batch
  const tokenAddresses = rows.map((r) => r.tokenAddress);
  const targetTimes = [ts1h, ts24h, ts7d].filter((x): x is Date => x !== undefined);
  const snapshotMap = new Map<string, typeof tokenIntelSnapshots.$inferSelect>();

  if (targetTimes.length > 0) {
    const snaps = await db
      .select()
      .from(tokenIntelSnapshots)
      .where(
        and(
          inArray(tokenIntelSnapshots.tokenAddress, tokenAddresses),
          inArray(tokenIntelSnapshots.snapshotAt, targetTimes)
        )
      );
    for (const snap of snaps) {
      const utcSnapshotAt = parseUtcDate(snap.snapshotAt)!;
      const key = `${snap.tokenAddress}|${utcSnapshotAt.getTime()}`;
      snapshotMap.set(key, snap);
    }
  }

  // 2b. Fetch sum of quality_entry_count_4h and quality_exit_count_4h from token_intel_snapshots for the last 24h
  const snapshot24hSums = new Map<string, { entries24h: number; exits24h: number }>();
  if (tokenAddresses.length > 0) {
    const sums = await db
      .select({
        tokenAddress: tokenIntelSnapshots.tokenAddress,
        entries24h: sql<number>`COALESCE(SUM(quality_entry_count_4h), 0)::integer`,
        exits24h: sql<number>`COALESCE(SUM(quality_exit_count_4h), 0)::integer`,
      })
      .from(tokenIntelSnapshots)

      .where(
        and(
          inArray(tokenIntelSnapshots.tokenAddress, tokenAddresses),
          gt(tokenIntelSnapshots.snapshotAt, new Date(maxTs.getTime() - 24 * 60 * 60 * 1000)),
          lte(tokenIntelSnapshots.snapshotAt, maxTs)
        )
      )

      .groupBy(tokenIntelSnapshots.tokenAddress);

    for (const sum of sums) {
      snapshot24hSums.set(sum.tokenAddress.toLowerCase(), {
        entries24h: sum.entries24h,
        exits24h: sum.exits24h,
      });
    }
  }

  // 2c. Fetch freshness metadata for all target tokens in a single batch
  const freshnessMap = new Map<string, {
    tokenMetricsLastUpdated: Date;
    minPositionUpdatedAt: Date | null;
    minWalletScoreLastUpdated: Date | null;
  }>();

  if (tokenAddresses.length > 0) {
    const freshnessData = await db
      .select({
        tokenAddress: tokenMetrics.tokenAddress,
        tokenMetricsLastUpdated: tokenMetrics.lastUpdated,
        minPositionUpdatedAt: sql<Date | null>`(
          SELECT MIN(wp.updated_at)
          FROM wallet_positions wp
          WHERE wp.token_address = ${tokenMetrics.tokenAddress}
        )`,
        minWalletScoreLastUpdated: sql<Date | null>`(
          SELECT MIN(ws.last_updated)
          FROM wallet_positions wp
          JOIN wallet_scores ws ON ws.wallet = wp.wallet
          WHERE wp.token_address = ${tokenMetrics.tokenAddress} AND ws.rank_score >= 80
        )`
      })
      .from(tokenMetrics)
      .where(inArray(tokenMetrics.tokenAddress, tokenAddresses));

    for (const item of freshnessData) {
      freshnessMap.set(item.tokenAddress.toLowerCase(), {
        tokenMetricsLastUpdated: item.tokenMetricsLastUpdated,
        minPositionUpdatedAt: parseUtcDate(item.minPositionUpdatedAt) ?? null,
        minWalletScoreLastUpdated: parseUtcDate(item.minWalletScoreLastUpdated) ?? null,
      });
    }
  }

  // 3. Process, compute deltas, classify trends, and pre-render plain text narratives
  const nowMs = Date.now();
  const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
  return rows.map((row) => {
    const qh = row.qualityHolderCount;

    const classEntries = [
      { classification: 'accumulator', count: row.accumulatorHolderCount },
      { classification: 'degen',       count: row.degenHolderCount       },
      { classification: 'bot',         count: row.botHolderCount         },
      { classification: 'scout',       count: row.scoutHolderCount       },
    ];

    const topClassifications = classEntries
      .filter(c => c.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(c => ({
        classification: c.classification,
        count:          c.count,
        pct:            qh > 0 ? Math.round((c.count / qh) * 1000) / 10 : 0,
      }));

    const getSnap = (ts?: Date) => ts ? snapshotMap.get(`${row.tokenAddress}|${ts.getTime()}`) : undefined;
    
    const isValid = (snap: typeof tokenIntelSnapshots.$inferSelect | undefined, targetTime: Date, maxToleranceMs: number) => {
      if (!snap) return undefined;
      const diff = Math.abs(snap.snapshotAt.getTime() - targetTime.getTime());
      return diff <= maxToleranceMs ? snap : undefined;
    };

    const s24h = isValid(getSnap(ts24h), new Date(maxTs.getTime() - 24 * 60 * 60 * 1000), 12 * 60 * 60 * 1000); // 12h tolerance


    // Deltas
    const qualityHolderChange24h = s24h ? qh - s24h.qualityHolderCount : null;

    const scoreCurrent = parseFloat(String(row.accumulationScore));
    const scorePast    = s24h ? parseFloat(String(s24h.accumulationScore)) : null;
    const accumulationScoreChange24h = (scorePast !== null) ? parseFloat((scoreCurrent - scorePast).toFixed(2)) : null;

    const concCurrent = parseFloat(String(row.qualityConcentrationPct));

    // Classification logic
    let trendDirection: TokenSignalBundle['trend'] = 'UNKNOWN';
    if (s24h) {
      if (qualityHolderChange24h! >= 2 && accumulationScoreChange24h! >= 5.0) {
        trendDirection = 'INCREASING';
      } else if (qualityHolderChange24h! <= -2 && accumulationScoreChange24h! <= -5.0) {
        trendDirection = 'DECREASING';
      } else {
        trendDirection = 'STABLE';
      }
    }

    // Derived 24h metrics from snapshots (no fallback to 4h metrics)
    const hasSnapshots24h = snapshot24hSums.has(row.tokenAddress.toLowerCase());
    const derived24h = snapshot24hSums.get(row.tokenAddress.toLowerCase());
    const qualityEntries24h = hasSnapshots24h ? derived24h!.entries24h : null;
    const qualityExits24h = hasSnapshots24h ? derived24h!.exits24h : null;
    const netAccumulationFlow24h = (qualityEntries24h !== null && qualityExits24h !== null)
      ? qualityEntries24h - qualityExits24h
      : null;

    const concentrationScore = Math.round(concCurrent);

    // Confidence Score calculation
    const C_qh = Math.min(50, 10 * Math.log(1 + qh));
    const consensusDiversity = row.consensusDiversity;
    const C_div = Math.min(1.0, consensusDiversity / 3) * 20;
    
    const totalHolders = row.holderCount;
    let C_size = 5;
    if (totalHolders >= 20) C_size = 20;
    else if (totalHolders >= 10) C_size = 10;

    let C_trend = 0;
    if (trendDirection === 'INCREASING') C_trend = 10;
    else if (trendDirection === 'STABLE') C_trend = 5;

    const confidence = parseFloat((C_qh + C_div + C_size + C_trend).toFixed(2));

    // Opportunity Score calculation
    const S_acc = scoreCurrent;
    let S_growth = 0;
    if (qualityHolderChange24h !== null) {
      const pastQh = qh - qualityHolderChange24h;
      const denominator = Math.max(1, pastQh);
      const growthPct = (qualityHolderChange24h / denominator) * 100;
      
      if (growthPct >= 50) S_growth = 100;
      else if (growthPct >= 25) S_growth = 75;
      else if (growthPct >= 10) S_growth = 50;
      else if (growthPct > 0) S_growth = 25;
      else S_growth = 0;
    } else {
      S_growth = 0;
    }

    let S_trend = 25;
    if (trendDirection === 'INCREASING') S_trend = 100;
    else if (trendDirection === 'STABLE') S_trend = 50;
    else if (trendDirection === 'DECREASING') S_trend = 0;

    const opportunityScore = parseFloat((S_acc * 0.40 + S_growth * 0.30 + S_trend * 0.15 + confidence * 0.15).toFixed(2));

    // Reasons & Risks Rule Engines
    const signalReasons: string[] = [];
    if (scoreCurrent >= 75) signalReasons.push('high_accumulation');
    if (qualityHolderChange24h !== null && qualityHolderChange24h >= 2) signalReasons.push('quality_holder_growth');
    if (trendDirection === 'INCREASING') signalReasons.push('increasing_trend');
    if (
      (netAccumulationFlow24h !== null && netAccumulationFlow24h >= 2) ||
      (qualityEntries24h !== null && qualityEntries24h >= 3)
    ) {
      signalReasons.push('strong_participation');
    }

    const riskFlags: string[] = [];
    if (qh < 5) riskFlags.push('low_holder_count');
    if (concentrationScore >= 50) riskFlags.push('high_concentration');
    if (trendDirection === 'DECREASING') riskFlags.push('decreasing_trend');

    const signalTierMap = {
      STRONG: 'STRONG',
      MODERATE: 'MODERATE',
      WEAK: 'WEAK',
      NOISE: 'NEUTRAL'
    } as const;
    const signalTier = (signalTierMap[row.signalTier as keyof typeof signalTierMap] ?? 'NEUTRAL') as TokenSignalBundle['signalTier'];

    // Precompute plain-language narrative
    let narrative = '';
    const symbol = row.tokenSymbol;
    const meetsMin = row.meetsMinimumHolders;

    if (!meetsMin) {
      narrative = `${symbol} — NEUTRAL (NOISE). ${qh} quality ${qh === 1 ? 'holder' : 'holders'} (minimum 3 required, 10 total holders required).`;
    } else {
      const growthText = qualityHolderChange24h !== null
        ? (qualityHolderChange24h >= 0 ? `gained ${qualityHolderChange24h}` : `lost ${Math.abs(qualityHolderChange24h)}`) + ' quality holders'
        : 'no change data';
      
      narrative = `${symbol} shows ${signalTier.toLowerCase()} smart-money signals. In the last 24h, it ${growthText}. Trend remains ${trendDirection}. Opportunity Score: ${opportunityScore} (Confidence: ${confidence}%).`;
    }

    // Freshness calculation from batched dependencies
    const freshness = freshnessMap.get(row.tokenAddress.toLowerCase());
    const timestamps = [
      row.computedAt,
      freshness?.tokenMetricsLastUpdated,
      freshness?.minPositionUpdatedAt,
      freshness?.minWalletScoreLastUpdated,
    ].filter((t): t is Date => t !== null && t !== undefined);

    const oldestTimestamp = timestamps.length > 0
      ? new Date(Math.min(...timestamps.map(t => t.getTime())))
      : row.computedAt;

    const sourceDataAgeMs = Math.max(0, nowMs - oldestTimestamp.getTime());
    const dataFreshness = sourceDataAgeMs <= STALE_THRESHOLD_MS ? 'LIVE' : 'STALE';

    return {
      tokenAddress:            row.tokenAddress,
      tokenSymbol:             symbol,
      signalTier,
      accumulationScore:       scoreCurrent,
      opportunityScore,
      confidence,
      trend:                   trendDirection,
      qualityHolderCount:      qh,
      holderCount:             row.holderCount,
      qualityConcentrationPct: concCurrent,
      concentrationScore,
      avgQualityRank:          parseFloat(String(row.avgQualityRankScore)),
      qualityEntries4h:        row.qualityEntryCount4h,
      qualityExits4h:          row.qualityExitCount4h,
      netAccumulationFlow:     row.netAccumulationFlow,
      qualityEntries24h,
      qualityExits24h,
      netAccumulationFlow24h,
      topClassifications,
      signalReasons,
      riskFlags,
      qualityHolderChange24h,
      narrative,
      dataFreshness,
      minimumHolders:          meetsMin,
      computedAt:              row.computedAt,
      sourceDataAgeMs,
    };
  });

}

// ── Repository ────────────────────────────────────────────────────────────────

export interface GetTopSignalsOptions {
  limit?:              number;
  minScore?:           number;
  tiers?:              Array<'STRONG' | 'MODERATE' | 'WEAK' | 'NEUTRAL'>;
  excludeBaseTokens?:  boolean;
}

export class SmartMoneySignalsRepository {
  // ── Writes ───────────────────────────────────────────────────────────────────

  /**
   * Full rebuild — recomputes signals for every token in one SQL statement.
   */
  static async rebuildAll(): Promise<void> {
    await db.execute(sql.raw(REBUILD_SQL));
  }

  // ── Reads ────────────────────────────────────────────────────────────────────

  /**
   * Primary agent interface. Returns ranked TokenSignalBundles ready for LLM
   * consumption — sorted by opportunityScore descending.
   */
  static async getTopSignals(options?: GetTopSignalsOptions): Promise<TokenSignalBundle[]> {
    const limit             = options?.limit             ?? 10;
    const minScore          = options?.minScore          ?? 25;
    const tiers             = options?.tiers             ?? ['STRONG', 'MODERATE', 'WEAK'];
    const excludeBaseTokens = options?.excludeBaseTokens ?? true;
    const baseTokenList     = excludeBaseTokens ? [...BSC_BASE_TOKENS] : [];

    const conditions = [
      eq(smartMoneySignals.meetsMinimumHolders, true),
      ...(baseTokenList.length > 0
        ? [notInArray(smartMoneySignals.tokenAddress, baseTokenList)]
        : []),
    ];

    const dbTiers = tiers.map(t => t === 'NEUTRAL' ? 'NOISE' : t);
    if (dbTiers.length > 0) {
      conditions.push(inArray(smartMoneySignals.signalTier, dbTiers));
    }

    const rows = await db
      .select()
      .from(smartMoneySignals)
      .where(and(...conditions));

    const enriched = await enrichSignalsWithHistory(rows);
    let filtered = enriched.filter(s => s.accumulationScore >= minScore);

    // Sort by opportunity score descending
    filtered.sort((a, b) => b.opportunityScore - a.opportunityScore);

    return filtered.slice(0, limit);
  }

  /** Look up the signal bundle for a single token. Returns undefined if not computed. */
  static async getSignal(tokenAddress: string): Promise<TokenSignalBundle | undefined> {
    const rows = await db
      .select()
      .from(smartMoneySignals)
      .where(eq(smartMoneySignals.tokenAddress, tokenAddress.toLowerCase()))
      .limit(1);
    if (!rows[0]) return undefined;
    const enriched = await enrichSignalsWithHistory([rows[0]]);
    return enriched[0];
  }

  /** Alias wrapper for Single Token lookup */
  static async getSignalForToken(tokenAddress: string): Promise<TokenSignalBundle | undefined> {
    return this.getSignal(tokenAddress);
  }

  /** All tokens in the given tier, sorted by opportunityScore descending. */
  static async getSignalsByTier(
    tier: 'STRONG' | 'MODERATE' | 'WEAK' | 'NEUTRAL',
    limit = 50,
  ): Promise<TokenSignalBundle[]> {
    const dbTier = tier === 'NEUTRAL' ? 'NOISE' : tier;
    const rows = await db
      .select()
      .from(smartMoneySignals)
      .where(eq(smartMoneySignals.signalTier, dbTier))
      .limit(limit * 2);

    const enriched = await enrichSignalsWithHistory(rows);
    enriched.sort((a, b) => b.opportunityScore - a.opportunityScore);

    return enriched.slice(0, limit);
  }

  /** Backwards compatibility alias */
  static async getByTier(
    tier: 'STRONG' | 'MODERATE' | 'WEAK',
    limit = 50,
  ): Promise<TokenSignalBundle[]> {
    return this.getSignalsByTier(tier, limit);
  }

  /** Targets tokens with an INCREASING trend direction. */
  static async getIncreasingSignals(limit = 10): Promise<TokenSignalBundle[]> {
    const rows = await db
      .select()
      .from(smartMoneySignals)
      .where(eq(smartMoneySignals.meetsMinimumHolders, true));

    const enriched = await enrichSignalsWithHistory(rows);
    const filtered = enriched.filter(s => s.trend === 'INCREASING');
    filtered.sort((a, b) => b.opportunityScore - a.opportunityScore);

    return filtered.slice(0, limit);
  }

  /** Targets tokens with a DECREASING trend direction. */
  static async getDecreasingSignals(limit = 10): Promise<TokenSignalBundle[]> {
    const rows = await db
      .select()
      .from(smartMoneySignals)
      .where(eq(smartMoneySignals.meetsMinimumHolders, true));

    const enriched = await enrichSignalsWithHistory(rows);
    const filtered = enriched.filter(s => s.trend === 'DECREASING');
    filtered.sort((a, b) => b.opportunityScore - a.opportunityScore);

    return filtered.slice(0, limit);
  }

  /**
   * First-class Emerging Signals interface.
   * Targets tokens that have low quality holder bases but are showing growth,
   * or have recently upgraded from a weak cohort.
   */
  static async getEmergingSignals(limit = 10): Promise<TokenSignalBundle[]> {
    const rows = await db
      .select()
      .from(smartMoneySignals)
      .where(eq(smartMoneySignals.meetsMinimumHolders, true));

    const enriched = await enrichSignalsWithHistory(rows);

    const filtered = enriched.filter(s => {
      const hasGrowth = s.qualityHolderChange24h !== null && s.qualityHolderChange24h > 0;
      const isEmergingCohort = s.qualityHolderCount < 15 && hasGrowth;

      let upgradedTier = false;
      if (s.qualityHolderChange24h !== null) {
        const currentQh = s.qualityHolderCount;
        const pastQh = currentQh - s.qualityHolderChange24h;
        const pastWasWeakOrNoise = pastQh < 5;
        const currentIsModerateOrStrong = currentQh >= 5;
        if (pastWasWeakOrNoise && currentIsModerateOrStrong) {
          upgradedTier = true;
        }
      }

      return isEmergingCohort || upgradedTier;
    });

    filtered.sort((a, b) => b.opportunityScore - a.opportunityScore);

    return filtered.slice(0, limit);
  }

  /** Tier distribution — useful for diagnostics and validation. */
  static async getTierDistribution(): Promise<
    Array<{ tier: string; count: number; avgScore: number }>
  > {
    const rows = await db.execute<{
      signal_tier: string;
      count:       string;
      avg_score:   string;
    }>(sql`
      SELECT
        signal_tier,
        COUNT(*)                                      AS count,
        ROUND(AVG(accumulation_score::numeric), 2)   AS avg_score
      FROM smart_money_signals
      GROUP BY signal_tier
      ORDER BY
        CASE signal_tier
          WHEN 'STRONG'   THEN 1
          WHEN 'MODERATE' THEN 2
          WHEN 'WEAK'     THEN 3
          ELSE                 4
        END
    `);
    return rows.map(r => ({
      tier:     r.signal_tier,
      count:    Number(r.count),
      avgScore: parseFloat(r.avg_score ?? '0'),
    }));
  }

  /** Raw signal row for a token (without bundle transformation). */
  static async getRawSignal(tokenAddress: string): Promise<SmartMoneySignal | undefined> {
    const rows = await db
      .select()
      .from(smartMoneySignals)
      .where(eq(smartMoneySignals.tokenAddress, tokenAddress.toLowerCase()))
      .limit(1);
    return rows[0];
  }
}

