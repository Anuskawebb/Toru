CREATE TABLE IF NOT EXISTS "price_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"price_usd" double precision NOT NULL,
	"volume_usd" double precision NOT NULL,
	"source" varchar(20) NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "smart_money_signals" (
	"token_address" varchar(42) PRIMARY KEY NOT NULL,
	"token_symbol" varchar(50) DEFAULT 'UNKNOWN' NOT NULL,
	"quality_entry_count_1h" integer DEFAULT 0 NOT NULL,
	"quality_entry_count_4h" integer DEFAULT 0 NOT NULL,
	"quality_exit_count_1h" integer DEFAULT 0 NOT NULL,
	"quality_exit_count_4h" integer DEFAULT 0 NOT NULL,
	"net_accumulation_flow" integer DEFAULT 0 NOT NULL,
	"quality_holder_count" integer DEFAULT 0 NOT NULL,
	"holder_count" integer DEFAULT 0 NOT NULL,
	"quality_concentration_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"avg_quality_rank_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"accumulator_holder_count" integer DEFAULT 0 NOT NULL,
	"degen_holder_count" integer DEFAULT 0 NOT NULL,
	"bot_holder_count" integer DEFAULT 0 NOT NULL,
	"scout_holder_count" integer DEFAULT 0 NOT NULL,
	"consensus_diversity" integer DEFAULT 0 NOT NULL,
	"accumulation_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"signal_tier" varchar(10) DEFAULT 'NOISE' NOT NULL,
	"meets_minimum_holders" boolean DEFAULT false NOT NULL,
	"narrative" text DEFAULT '' NOT NULL,
	"quality_holder_change_24h" integer,
	"trend_direction" varchar(12) DEFAULT 'UNKNOWN' NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token_intel_snapshots" (
	"token_address" varchar(42) NOT NULL,
	"snapshot_at" timestamp NOT NULL,
	"quality_holder_count" integer NOT NULL,
	"holder_count" integer NOT NULL,
	"quality_concentration_pct" numeric(5, 2) NOT NULL,
	"quality_entry_count_1h" integer NOT NULL,
	"quality_entry_count_4h" integer NOT NULL,
	"quality_exit_count_1h" integer NOT NULL,
	"quality_exit_count_4h" integer NOT NULL,
	"net_accumulation_flow" integer NOT NULL,
	"avg_quality_rank_score" numeric(5, 2) NOT NULL,
	"accumulation_score" numeric(5, 2) NOT NULL,
	"signal_tier" varchar(10) NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "token_intel_snapshots_token_address_snapshot_at_pk" PRIMARY KEY("token_address","snapshot_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token_metrics" (
	"token_address" varchar(42) PRIMARY KEY NOT NULL,
	"token_symbol" varchar(50) DEFAULT 'UNKNOWN' NOT NULL,
	"token_decimals" integer DEFAULT 18 NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"buy_trades" integer DEFAULT 0 NOT NULL,
	"sell_trades" integer DEFAULT 0 NOT NULL,
	"unique_traders" integer DEFAULT 0 NOT NULL,
	"unique_buyers" integer DEFAULT 0 NOT NULL,
	"unique_sellers" integer DEFAULT 0 NOT NULL,
	"holder_count" integer DEFAULT 0 NOT NULL,
	"quality_holder_count" integer DEFAULT 0 NOT NULL,
	"active_wallet_count" integer DEFAULT 0 NOT NULL,
	"net_holders" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp,
	"last_seen" timestamp,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token_prices" (
	"token_address" varchar(42) PRIMARY KEY NOT NULL,
	"price_usd" double precision NOT NULL,
	"vwap_1m" double precision NOT NULL,
	"vwap_15m" double precision NOT NULL,
	"vwap_1h" double precision NOT NULL,
	"observation_count_1h" integer DEFAULT 0 NOT NULL,
	"liquidity_usd" double precision DEFAULT 0 NOT NULL,
	"route_type" varchar(20) NOT NULL,
	"price_state" varchar(20) DEFAULT 'FRESH' NOT NULL,
	"price_confidence" double precision DEFAULT 100 NOT NULL,
	"manipulation_flag" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_metrics" (
	"wallet" varchar(42) PRIMARY KEY NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"buy_count" integer DEFAULT 0 NOT NULL,
	"sell_count" integer DEFAULT 0 NOT NULL,
	"unique_tokens" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp,
	"last_seen" timestamp,
	"active_days" integer DEFAULT 0 NOT NULL,
	"current_open_positions" integer DEFAULT 0 NOT NULL,
	"total_bought_trades" integer DEFAULT 0 NOT NULL,
	"total_sold_trades" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_scores" (
	"wallet" varchar(42) PRIMARY KEY NOT NULL,
	"activity_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"conviction_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"breadth_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"consistency_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"rank_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"rank_position" integer,
	"classification" varchar(20) DEFAULT 'unknown' NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"unique_tokens" integer DEFAULT 0 NOT NULL,
	"current_open_positions" integer DEFAULT 0 NOT NULL,
	"active_days" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_observations_token_address_idx" ON "price_observations" USING btree ("token_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_observations_observed_at_idx" ON "price_observations" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "smart_money_signals_accumulation_score_idx" ON "smart_money_signals" USING btree ("accumulation_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "smart_money_signals_signal_tier_idx" ON "smart_money_signals" USING btree ("signal_tier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "smart_money_signals_meets_min_holders_idx" ON "smart_money_signals" USING btree ("meets_minimum_holders");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_intel_snapshots_snapshot_at_idx" ON "token_intel_snapshots" USING btree ("snapshot_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_metrics_last_seen_idx" ON "token_metrics" USING btree ("last_seen");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_metrics_unique_traders_idx" ON "token_metrics" USING btree ("unique_traders");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_metrics_quality_holder_count_idx" ON "token_metrics" USING btree ("quality_holder_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_metrics_trade_count_idx" ON "token_metrics" USING btree ("trade_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_prices_price_state_idx" ON "token_prices" USING btree ("price_state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_prices_price_confidence_idx" ON "token_prices" USING btree ("price_confidence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_metrics_last_seen_idx" ON "wallet_metrics" USING btree ("last_seen");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_metrics_trade_count_idx" ON "wallet_metrics" USING btree ("trade_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_scores_rank_score_idx" ON "wallet_scores" USING btree ("rank_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_scores_rank_position_idx" ON "wallet_scores" USING btree ("rank_position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_scores_classification_idx" ON "wallet_scores" USING btree ("classification");