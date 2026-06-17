CREATE TABLE IF NOT EXISTS "indexer_state" (
	"chain" varchar(50) PRIMARY KEY NOT NULL,
	"last_processed_block" bigint NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token_discovery_queue" (
	"address" varchar(42) PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempted_at" timestamp,
	"resolved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tokens" (
	"address" varchar(42) PRIMARY KEY NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"decimals" integer NOT NULL,
	"image_url" text,
	"coingecko_id" varchar(100),
	"verified" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"block_number" bigint NOT NULL,
	"timestamp" timestamp NOT NULL,
	"wallet" varchar(42) NOT NULL,
	"dex" varchar(50) NOT NULL,
	"token_in_address" varchar(42) NOT NULL,
	"token_out_address" varchar(42) NOT NULL,
	"token_in_symbol" varchar(50) NOT NULL,
	"token_out_symbol" varchar(50) NOT NULL,
	"amount_in" text NOT NULL,
	"amount_out" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_wallet_idx" ON "trades" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_tx_hash_idx" ON "trades" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_timestamp_idx" ON "trades" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_token_in_address_idx" ON "trades" USING btree ("token_in_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_token_out_address_idx" ON "trades" USING btree ("token_out_address");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trades_unique_trade_idx" ON "trades" USING btree ("tx_hash","wallet","token_in_address","token_out_address","amount_in","amount_out","dex");