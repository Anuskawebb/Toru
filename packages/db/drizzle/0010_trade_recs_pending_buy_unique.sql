-- Phase 8 prerequisite fix 1:
-- Enforce at-most-one PENDING BUY recommendation per (agent_wallet, token_address).
-- Partial: allows unlimited SELL, EXECUTED, EXPIRED, and CANCELLED rows for the same pair.
-- Prevents duplicate BUY recommendations from accumulating across rapid successive cycles.
CREATE UNIQUE INDEX IF NOT EXISTS "trade_recs_pending_buy_unique"
  ON "trade_recommendations" ("agent_wallet", "token_address")
  WHERE action = 'BUY' AND status = 'PENDING';
