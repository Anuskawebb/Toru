CREATE TABLE IF NOT EXISTS "wallet_scores" (
	"wallet" varchar(42) PRIMARY KEY NOT NULL,
	"activity_score"    numeric(5,2) DEFAULT '0' NOT NULL,
	"conviction_score"  numeric(5,2) DEFAULT '0' NOT NULL,
	"breadth_score"     numeric(5,2) DEFAULT '0' NOT NULL,
	"consistency_score" numeric(5,2) DEFAULT '0' NOT NULL,
	"rank_score"        numeric(5,2) DEFAULT '0' NOT NULL,
	"rank_position"     integer,
	"classification"    varchar(20) DEFAULT 'unknown' NOT NULL,
	"trade_count"            integer DEFAULT 0 NOT NULL,
	"unique_tokens"          integer DEFAULT 0 NOT NULL,
	"current_open_positions" integer DEFAULT 0 NOT NULL,
	"active_days"            integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_scores_rank_score_idx"      ON "wallet_scores" USING btree ("rank_score");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_scores_rank_position_idx"   ON "wallet_scores" USING btree ("rank_position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_scores_classification_idx"  ON "wallet_scores" USING btree ("classification");
