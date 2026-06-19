-- Phase 6D: Performance indexes for high-frequency query paths

-- token_intel_snapshots: enrichSignalsWithHistory() queries this table with
-- inArray(tokenAddress) AND inArray(snapshotAt), called on every getTopSignals()
-- invocation. Without this index the planner falls back to a full table scan
-- across all snapshots × tokens on every Decision Engine cycle.
CREATE INDEX IF NOT EXISTS "token_intel_snapshots_addr_time_idx"
  ON "token_intel_snapshots" USING btree ("token_address", "snapshot_at");
--> statement-breakpoint

-- price_observations: PriceAggregator fetches all 1h observations per token
-- in a single batch query (token_address IN (...) AND observed_at >= NOW()-1h).
-- This composite index covers both predicates without a seq scan.
CREATE INDEX IF NOT EXISTS "price_observations_addr_time_idx"
  ON "price_observations" USING btree ("token_address", "observed_at");
