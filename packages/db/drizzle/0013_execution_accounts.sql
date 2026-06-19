CREATE TABLE IF NOT EXISTS "execution_accounts" (
  "id"             varchar(36) PRIMARY KEY,
  "agent_id"       varchar(50) NOT NULL,
  "user_id"        varchar(255),
  "account_type"   varchar(30) NOT NULL,
  "wallet_address" varchar(42) NOT NULL,
  "status"         varchar(20) NOT NULL DEFAULT 'PENDING',
  "metadata"       jsonb,
  "created_at"     timestamp DEFAULT now() NOT NULL,
  "updated_at"     timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "exec_accounts_agent_wallet_idx"
  ON "execution_accounts" ("agent_id", "wallet_address");

CREATE INDEX IF NOT EXISTS "exec_accounts_agent_id_idx"
  ON "execution_accounts" ("agent_id");

CREATE INDEX IF NOT EXISTS "exec_accounts_user_id_idx"
  ON "execution_accounts" ("user_id");

CREATE INDEX IF NOT EXISTS "exec_accounts_status_idx"
  ON "execution_accounts" ("status");
