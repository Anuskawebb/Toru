CREATE TABLE IF NOT EXISTS "portfolio_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_wallet" varchar(42) NOT NULL,
	"snapshot_at" timestamp NOT NULL,
	"portfolio_usd" double precision NOT NULL,
	"stablecoin_usd" double precision NOT NULL,
	"token_exposure_usd" double precision NOT NULL,
	"open_positions" integer NOT NULL,
	"unpriced_positions" integer DEFAULT 0 NOT NULL,
	"peak_portfolio_usd" double precision NOT NULL,
	"drawdown_pct" double precision NOT NULL,
	"rolling_loss_pct_24h" double precision NOT NULL,
	"valuation_confidence" double precision DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_state" (
	"agent_wallet" varchar(42) PRIMARY KEY NOT NULL,
	"portfolio_usd" double precision NOT NULL,
	"stablecoin_usd" double precision NOT NULL,
	"token_exposure_usd" double precision NOT NULL,
	"buying_power_usd" double precision NOT NULL,
	"starting_capital_usd" double precision NOT NULL,
	"peak_portfolio_usd" double precision NOT NULL,
	"drawdown_pct" double precision NOT NULL,
	"rolling_loss_pct_24h" double precision NOT NULL,
	"cash_reserve_pct" double precision NOT NULL,
	"total_exposure_pct" double precision NOT NULL,
	"open_risk_pct" double precision NOT NULL,
	"open_positions" integer NOT NULL,
	"unpriced_positions" integer DEFAULT 0 NOT NULL,
	"valuation_confidence" double precision DEFAULT 100 NOT NULL,
	"last_valuation_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_snapshots_snapshot_at_idx" ON "portfolio_snapshots" USING btree ("snapshot_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_snapshots_wallet_snapshot_idx" ON "portfolio_snapshots" USING btree ("agent_wallet","snapshot_at");