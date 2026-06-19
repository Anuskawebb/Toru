ALTER TABLE "trades" ADD COLUMN "log_index" integer;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "pair_address" varchar(42);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "token_in_decimals" integer DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "token_out_decimals" integer DEFAULT 18 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_block_number_idx" ON "trades" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_wallet_block_idx" ON "trades" USING btree ("wallet","block_number");