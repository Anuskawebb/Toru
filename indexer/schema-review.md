# Schema Review

Generated: 2026-06-17

---

## Current `trades` Table

```sql
CREATE TABLE "trades" (
  "id"               serial PRIMARY KEY,
  "tx_hash"          varchar(66)   NOT NULL,
  "block_number"     bigint        NOT NULL,
  "timestamp"        timestamp     NOT NULL,
  "wallet"           varchar(42)   NOT NULL,
  "dex"              varchar(50)   NOT NULL,
  "token_in_address" varchar(42)   NOT NULL,
  "token_out_address"varchar(42)   NOT NULL,
  "token_in_symbol"  varchar(50)   NOT NULL,
  "token_out_symbol" varchar(50)   NOT NULL,
  "amount_in"        text          NOT NULL,
  "amount_out"       text          NOT NULL,
  "created_at"       timestamp     DEFAULT now() NOT NULL
);

CREATE INDEX  trades_wallet_idx       ON trades (wallet);
CREATE INDEX  trades_tx_hash_idx      ON trades (tx_hash);
CREATE INDEX  trades_timestamp_idx    ON trades (timestamp);
CREATE INDEX  trades_token_in_idx     ON trades (token_in_address);
CREATE INDEX  trades_token_out_idx    ON trades (token_out_address);
CREATE UNIQUE INDEX trades_unique_trade_idx ON trades
  (tx_hash, wallet, token_in_address, token_out_address, amount_in, amount_out, dex);
```

---

## Issue 1 — Address Normalization (CRITICAL)

**Severity:** Critical — will silently corrupt analytics if unfixed

**Problem:**
`NormalizedTrade.tokenIn`, `tokenOut`, and `wallet` are typed as
`` `0x${string}` `` (viem's EIP-55 checksummed format). This means tokens and
wallets are stored with mixed-case letters, e.g.:

```
0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c  (WBNB, checksummed)
0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c  (WBNB, lowercase)
```

69% of trades (1,184 of 1,705) carry mixed-case addresses. PostgreSQL's
`varchar` uses case-sensitive byte comparison. These two strings would be
treated as different addresses — breaking every wallet timeline query, token
trade lookup, and the unique index itself (the same trade could be inserted
twice with different address casings).

**Fix:**
Normalize all addresses to lowercase in the storage layer before any DB
insert. In Drizzle:

```ts
// packages/db/src/storage.ts (or wherever InsertTrade is built)
const row: InsertTrade = {
  ...trade,
  wallet:           trade.wallet.toLowerCase(),
  tokenInAddress:   trade.tokenIn.toLowerCase(),
  tokenOutAddress:  trade.tokenOut.toLowerCase(),
};
```

The `NormalizedTrade` type, the DB schema column widths, and the unique index
do NOT need to change — only the normalization step before insert.

---

## Issue 2 — Decimals Not Inline (MODERATE)

**Severity:** Moderate — analytics dependency, not a data corruption risk

**Problem:**
`amount_in` and `amount_out` are stored as raw BigInt text strings.
Interpreting these as human-readable values requires token decimals (e.g.,
USDT = 6 dec, WBNB = 18 dec). Decimals are only available in the `tokens`
table, forcing every analytics query to JOIN.

For simple per-wallet analytics this is acceptable. For aggregations over
millions of rows (rankings, trader leaderboard), this JOIN at query time is
costly and requires the `tokens` table to be fully populated before queries
can run.

**Options:**

**Option A — Add inline decimals (recommended):**
```sql
ALTER TABLE trades ADD COLUMN token_in_decimals  integer NOT NULL DEFAULT 18;
ALTER TABLE trades ADD COLUMN token_out_decimals integer NOT NULL DEFAULT 18;
```
Pros: self-contained rows, zero JOIN for price math, works even if tokens table
is partially populated. Cons: slight denormalization (decimals duplicated per row).

**Option B — Keep JOIN:**
Keep the current schema. Require that the tokens table is always populated
before analytics run. Accept the JOIN cost. Simpler schema.

Recommendation: Option A. Decimals for a given token never change, so the
"denormalization" concern is theoretical. The performance and simplicity gains
are real.

---

## Issue 3 — Missing `log_index` and `transaction_index` (MODERATE)

**Severity:** Moderate — affects exact FIFO ordering, not overall correctness

**Problem:**
BSC produces one block every ~3 seconds. Multiple trades from the same wallet
within the same block share an identical timestamp. Without `log_index` (the
position of the Swap log within the receipt's log array) and `transaction_index`
(the tx's position within the block), there is no deterministic sort order
for trades within the same block.

Current sort: `ORDER BY block_number ASC, tx_hash ASC`  
`tx_hash` is a hash, so lexicographic sort is not the same as insertion order.
This means FIFO cost basis for high-frequency traders could produce different
results on different runs.

**Fields available in NormalizedTrade and RawEvent:**
`RawEvent.logIndex` is already populated (see `src/types/index.ts` line 37).
`transaction_index` is available from `receipt.transactionIndex` (not
currently extracted into RawEvent or NormalizedTrade).

**Fix:**
```sql
ALTER TABLE trades ADD COLUMN log_index         integer;
ALTER TABLE trades ADD COLUMN transaction_index integer;
```

Both nullable initially (existing data has no values). Populate from the
Swap event's `logIndex` (available in `RawEvent`) and from
`receipt.transactionIndex` (available in the receipt but not currently threaded
through the pipeline).

Correct sort order for analytics: `block_number ASC, transaction_index ASC, log_index ASC`.

---

## Issue 4 — Missing `pair_address` (MINOR)

**Severity:** Minor — useful for debugging and routing analysis

**Problem:**
`NormalizedTrade.pairAddress` (the pool/pair contract that emitted the Swap
event) is NOT stored in the trades table. The DB has no record of which pool
was used for any given trade.

This means:
- No ability to filter trades by liquidity pool without re-querying the chain
- Multi-hop route reconstruction requires full chain replay
- Cross-pool arbitrage detection is impossible from DB alone

**Fix:**
```sql
ALTER TABLE trades ADD COLUMN pair_address varchar(42);
```

Value comes directly from `NormalizedTrade.pairAddress` (always populated).

---

## Issue 5 — Unique Constraint vs In-Memory Dedup Mismatch (MINOR)

**Severity:** Minor — theoretical, not triggered in practice

**Problem:**
The DB unique index covers 7 fields: `(tx_hash, wallet, token_in_address,
token_out_address, amount_in, amount_out, dex)`.

The in-memory dedup key in `processor.ts` covers 5:
`txHash | tokenIn | tokenOut | amountIn | amountOut`

The key is missing `wallet` and `dex`. Scenario: same txHash, same token
pair and amounts, but different `dex` — the in-memory dedup would suppress
the second trade, but the DB would accept both. This can't happen (one Swap
event → one dex value), but the asymmetry is a maintenance hazard.

**Fix:** Align the in-memory key to include `wallet` and `dex`:
```ts
const key = `${trade.txHash}|${trade.wallet.toLowerCase()}|${trade.tokenIn.toLowerCase()}|${trade.tokenOut.toLowerCase()}|${trade.amountIn}|${trade.amountOut}|${trade.dex}`;
```

---

## Issue 6 — `amount_in` / `amount_out` as TEXT (INFORMATIONAL)

**Severity:** Informational — design trade-off, not a bug

BigInt values on BSC can exceed JavaScript's `Number.MAX_SAFE_INTEGER`
(2^53 - 1). PostgreSQL's `numeric` type would handle this natively, but
`bigint` in PostgreSQL only stores 64-bit signed integers (max ~9.2×10^18),
which is smaller than some ERC-20 token raw amounts (18-decimal tokens with
trillions of supply overflow int64).

Current choice of `text` is correct. Analytics queries must cast to `numeric`
for arithmetic:
```sql
SELECT SUM(amount_in::numeric) FROM trades WHERE token_in_address = '0x...'
```

No schema change needed. Document this in the DB package README.

---

## Recommended Schema (Target State)

```sql
CREATE TABLE "trades" (
  "id"                  serial PRIMARY KEY,
  "tx_hash"             varchar(66)  NOT NULL,
  "block_number"        bigint       NOT NULL,
  "transaction_index"   integer,                    -- NEW: tx position in block
  "log_index"           integer,                    -- NEW: Swap log position in receipt
  "timestamp"           timestamp    NOT NULL,
  "wallet"              varchar(42)  NOT NULL,       -- always lowercase
  "dex"                 varchar(50)  NOT NULL,
  "pair_address"        varchar(42),                -- NEW: pool/pair contract
  "token_in_address"    varchar(42)  NOT NULL,      -- always lowercase
  "token_out_address"   varchar(42)  NOT NULL,      -- always lowercase
  "token_in_symbol"     varchar(50)  NOT NULL,
  "token_out_symbol"    varchar(50)  NOT NULL,
  "token_in_decimals"   integer      NOT NULL,      -- NEW: inline, no JOIN needed
  "token_out_decimals"  integer      NOT NULL,      -- NEW: inline, no JOIN needed
  "amount_in"           text         NOT NULL,      -- raw BigInt string
  "amount_out"          text         NOT NULL,      -- raw BigInt string
  "price_in_usd"        numeric(30,8),              -- OPTIONAL: oracle snapshot at trade time
  "created_at"          timestamp    DEFAULT now() NOT NULL
);
```

Indexes remain the same. Unique index should be updated to use lowercase-normalized
columns (enforced at insert time, not at schema level).
