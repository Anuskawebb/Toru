CREATE TABLE IF NOT EXISTS "wallet_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" varchar(42) NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"token_symbol" varchar(50) NOT NULL,
	"token_decimals" integer NOT NULL,
	"total_bought" text DEFAULT '0' NOT NULL,
	"total_sold" text DEFAULT '0' NOT NULL,
	"net_amount" text DEFAULT '0' NOT NULL,
	"first_trade_at" timestamp NOT NULL,
	"last_trade_at" timestamp NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_positions_wallet_idx" ON "wallet_positions" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_positions_token_address_idx" ON "wallet_positions" USING btree ("token_address");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_positions_wallet_token_idx" ON "wallet_positions" USING btree ("wallet","token_address");