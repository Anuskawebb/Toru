-- Phase 7: Decision Engine schemas
-- trade_recommendations: immutable decision audit trail
-- agent_positions: mutable agent position registry

CREATE TABLE "trade_recommendations" (
  "id"                varchar(36) PRIMARY KEY,
  "agent_wallet"      varchar(42) NOT NULL,
  "token_address"     varchar(42) NOT NULL,
  "token_symbol"      varchar(50) NOT NULL,
  "action"            varchar(8)  NOT NULL,
  "position_size_pct" double precision NOT NULL,
  "estimated_usd"     double precision NOT NULL,
  "entry_price_usd"   double precision NOT NULL,
  "stop_loss_pct"     double precision NOT NULL,
  "take_profit_pct"   double precision NOT NULL,
  "slippage_limit_pct" double precision NOT NULL,
  "risk_tier"         varchar(12) NOT NULL,
  "signal_tier"       varchar(10) NOT NULL,
  "opportunity_score" double precision NOT NULL,
  "conviction_score"  double precision NOT NULL,
  "expected_edge"     double precision NOT NULL,
  "confidence"        double precision NOT NULL,
  "blockers"          jsonb NOT NULL DEFAULT '[]',
  "reasons"           jsonb NOT NULL DEFAULT '[]',
  "warnings"          jsonb NOT NULL DEFAULT '[]',
  "expires_at"        timestamp NOT NULL,
  "decided_at"        timestamp NOT NULL,
  "status"            varchar(12) NOT NULL,
  "created_at"        timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "trade_recs_wallet_idx"    ON "trade_recommendations" ("agent_wallet");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_recs_token_idx"     ON "trade_recommendations" ("token_address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_recs_status_idx"    ON "trade_recommendations" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_recs_decided_at_idx" ON "trade_recommendations" ("decided_at");
--> statement-breakpoint

CREATE TABLE "agent_positions" (
  "id"                varchar(36) PRIMARY KEY,
  "agent_wallet"      varchar(42) NOT NULL,
  "token_address"     varchar(42) NOT NULL,
  "token_symbol"      varchar(50) NOT NULL,
  "recommendation_id" varchar(36),
  "entry_price_usd"   double precision NOT NULL,
  "position_size_usd" double precision NOT NULL,
  "position_size_pct" double precision NOT NULL,
  "stop_loss_pct"     double precision NOT NULL,
  "take_profit_pct"   double precision NOT NULL,
  "current_price_usd" double precision NOT NULL,
  "unrealized_pnl_pct" double precision NOT NULL,
  "status"            varchar(8)  NOT NULL,
  "close_reason"      varchar(20),
  "close_price_usd"   double precision,
  "opened_at"         timestamp NOT NULL,
  "closed_at"         timestamp,
  "updated_at"        timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_positions_wallet_idx"       ON "agent_positions" ("agent_wallet");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_positions_token_idx"        ON "agent_positions" ("token_address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_positions_status_idx"       ON "agent_positions" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_positions_wallet_token_idx" ON "agent_positions" ("agent_wallet", "token_address");
