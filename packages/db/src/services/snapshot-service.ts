import { db } from '../client.js';
import { sql } from 'drizzle-orm';

export class SnapshotService {
  /**
   * Captures a consistent snapshot of the current smart_money_signals.
   *
   * Anchors snapshot_at to the dataset's MAX(timestamp) to keep backfills consistent.
   * Overwrites duplicate snapshots on conflict (idempotent pipeline execution).
   */
  static async capture(): Promise<void> {
    await db.execute(sql`
      WITH watermark AS (
        SELECT COALESCE(MAX(timestamp), NOW()) AS max_ts FROM trades
      )
      INSERT INTO token_intel_snapshots (
        token_address,
        snapshot_at,
        quality_holder_count,
        holder_count,
        quality_concentration_pct,
        quality_entry_count_1h,
        quality_entry_count_4h,
        quality_exit_count_1h,
        quality_exit_count_4h,
        net_accumulation_flow,
        avg_quality_rank_score,
        accumulation_score,
        signal_tier,
        computed_at
      )
      SELECT
        token_address,
        (SELECT max_ts FROM watermark) AS snapshot_at,
        quality_holder_count,
        holder_count,
        quality_concentration_pct,
        quality_entry_count_1h,
        quality_entry_count_4h,
        quality_exit_count_1h,
        quality_exit_count_4h,
        net_accumulation_flow,
        avg_quality_rank_score,
        accumulation_score,
        signal_tier,
        NOW() AS computed_at
      FROM smart_money_signals
      ON CONFLICT (token_address, snapshot_at) DO UPDATE SET
        quality_holder_count      = EXCLUDED.quality_holder_count,
        holder_count              = EXCLUDED.holder_count,
        quality_concentration_pct = EXCLUDED.quality_concentration_pct,
        quality_entry_count_1h    = EXCLUDED.quality_entry_count_1h,
        quality_entry_count_4h    = EXCLUDED.quality_entry_count_4h,
        quality_exit_count_1h     = EXCLUDED.quality_exit_count_1h,
        quality_exit_count_4h     = EXCLUDED.quality_exit_count_4h,
        net_accumulation_flow     = EXCLUDED.net_accumulation_flow,
        avg_quality_rank_score    = EXCLUDED.avg_quality_rank_score,
        accumulation_score        = EXCLUDED.accumulation_score,
        signal_tier               = EXCLUDED.signal_tier,
        computed_at               = EXCLUDED.computed_at
    `);
  }
}
