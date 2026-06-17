# Recommendations

Generated: 2026-06-17

---

## Final Verdict

**READY WITH MINOR CHANGES**

The parser is correct and the data model is analytically sound. One critical
issue — address normalization — must be fixed before writing the first row to
PostgreSQL. Three moderate improvements should be made in the same migration
to avoid a second schema change when PnL is implemented. Everything else can
proceed as-is.

---

## Evidence

### What is working correctly

- **Parser accuracy for directly-verifiable trades: 100%** (9/9 ERC-20-to-ERC-20
  swaps via standard V2/V3 routers confirm exactly on BscScan).
- **Wallet timelines are clean:** monotonic, no duplicates, no null timestamps
  across all 5 sampled wallets.
- **Token metadata is consistent:** USDT, WBNB, CAKE — zero symbol conflicts,
  zero null addresses, no metadata drift.
- **Wallet attribution is correct:** 20/20 sampled wallets are EOA addresses,
  zero protocol contracts.
- **Multi-hop semantics are correct:** each hop stored separately; txHash
  groups them; design is intentional and documented.
- **Duplicate protection works:** DB unique index absorbs re-inserted trades
  with `ON CONFLICT DO NOTHING`.
- **Position reconstruction works:** net position, FIFO matching, and cost
  basis ratios are all computable from the trades table alone (with a decimals
  JOIN to tokens).

### What is not working / not yet supported

- **69% of trades carry mixed-case addresses** — will silently break every
  wallet query if written to the DB as-is.
- **Decimals not inline** — every PnL/analytics query requires a JOIN to the
  tokens table.
- **No `log_index` or `transaction_index`** — within-block trade ordering is
  non-deterministic (breaks exact FIFO).
- **USD PnL is not feasible yet** — no historical oracle price stored or
  integrated.

---

## Required Before First DB Write

### Fix 1 — Normalize addresses to lowercase (CRITICAL)

Every address stored in the DB must be `address.toLowerCase()`.
Apply at the storage boundary, not in the parser.

**Where:** Add to the storage layer function that builds `InsertTrade`.

```ts
const row: InsertTrade = {
  txHash:          trade.txHash.toLowerCase(),
  wallet:          trade.wallet.toLowerCase(),
  tokenInAddress:  trade.tokenIn.toLowerCase(),
  tokenOutAddress: trade.tokenOut.toLowerCase(),
  // ... rest of fields
};
```

**Why it must happen now:** If any mixed-case row reaches the DB, fixing it
later requires a full-table update and re-verification. The cost of fixing it
now is 4 lines. The cost of fixing it after launch is a migration + potential
data inconsistency window.

---

## Recommended Before Analytics Work Begins

### Fix 2 — Add `token_in_decimals`, `token_out_decimals` to trades table

```sql
ALTER TABLE trades
  ADD COLUMN token_in_decimals  integer NOT NULL DEFAULT 18,
  ADD COLUMN token_out_decimals integer NOT NULL DEFAULT 18;
```

Populate from `resolveTokenMeta` at insert time (already called in the pipeline):

```ts
const metaIn  = await resolveTokenMeta(trade.tokenIn);
const metaOut = await resolveTokenMeta(trade.tokenOut);

const row: InsertTrade = {
  ...normalizedFields,
  tokenInDecimals:  metaIn.decimals,
  tokenOutDecimals: metaOut.decimals,
};
```

This makes every analytics row self-contained. No JOIN required for amount
display or price ratio computation.

### Fix 3 — Add `log_index` to trades table

```sql
ALTER TABLE trades ADD COLUMN log_index integer;
```

`RawEvent.logIndex` is already available in the pipeline. Thread it into
`NormalizedTrade`:

```ts
// src/types/index.ts
export interface NormalizedTrade {
  // ... existing fields ...
  logIndex: number;  // ADD
}
```

Use for analytics sort: `ORDER BY block_number ASC, log_index ASC`.

(Optional: also add `transaction_index` from `receipt.transactionIndex` — this
provides sub-block ordering even for trades from different transactions in the
same block. Lower priority than `log_index`.)

### Fix 4 — Add `pair_address` to trades table

```sql
ALTER TABLE trades ADD COLUMN pair_address varchar(42);
```

Already available in `NormalizedTrade.pairAddress`. Store lowercase.
Required for pool-level analytics and debugging multi-hop routes.

---

## Optional / Future

### USD Price Snapshot

Add `price_in_usd numeric(30,8)` as a nullable column. Populate from an
oracle integration (e.g., PancakeSwap USDT pair price at block time) when
available. Without this, USD PnL requires a separate historical price service
and cannot be computed from the trades table alone.

### `transaction_index`

Add `integer, nullable`. Provides deterministic ordering for trades from
different transactions in the same block when `log_index` values overlap
across receipts. Lower priority than `log_index`.

---

## Summary of Changes

| Change                      | Priority | Scope                                     | Blocker? |
|-----------------------------|----------|-------------------------------------------|----------|
| Lowercase address normalize | CRITICAL | Storage layer, 4 lines                    | YES      |
| Add `token_in/out_decimals` | HIGH     | Schema migration + storage layer          | Soft     |
| Add `log_index`             | HIGH     | Schema migration + NormalizedTrade type   | Soft     |
| Add `pair_address`          | MEDIUM   | Schema migration + storage layer          | No       |
| Add `transaction_index`     | LOW      | Schema migration + receipt extractor      | No       |
| Add `price_in_usd`          | LOW      | Schema migration + oracle integration     | No       |
| Align in-memory dedup key   | LOW      | processor.ts, 1 line                      | No       |

---

## What You Can Build Right Now

With only Fix 1 (address normalization) applied:

- Wallet trade history (chronological list of all trades)
- Token position tracking (gross buys, gross sells, net position in raw BigInt)
- Trader activity rankings (trade count, trade volume by token pair)
- Multi-hop route reconstruction (group by txHash)
- Basic copy-trade lead scoring (trade frequency, token diversity, active hours)
- BscScan-compatible trade audit trail

With Fixes 1 + 2 + 3 applied (all HIGH priority changes):

- Human-readable position sizes (no JOIN overhead)
- Deterministic FIFO ordering within blocks
- Realized PnL in token-denominated terms (e.g., "sold 100 CAKE at 1.2 WBNB/CAKE entry")
- Trader leaderboards by token-denominated profit
- Position entry/exit price tracking

USD PnL requires an additional oracle integration and is independent of
the schema changes above.
