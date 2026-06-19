-- Phase 7 audit fix P0-2:
-- Enforce at-most-one OPEN position per (agent_wallet, token_address) at the database level.
-- Partial: allows unlimited CLOSED rows for the same pair (full trade history is preserved).
CREATE UNIQUE INDEX IF NOT EXISTS "agent_positions_open_unique"
  ON "agent_positions" ("agent_wallet", "token_address")
  WHERE status = 'OPEN';
