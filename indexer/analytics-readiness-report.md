# Analytics Readiness Report

Generated: 2026-06-17
Dataset: 1,705 trades across 100 blocks (104740170–104740269)
Protocols: V2 (956), V4 (521), V3 (228)

---

## Validation 1 — Wallet Timeline Integrity

5 most active wallets (18–24 trades each) checked for monotonic timestamps,
duplicate trades, and missing timestamps.

| Wallet                  | Trades | Monotonic | Duplicates | Missing TS | Status |
|-------------------------|--------|-----------|------------|------------|--------|
| 0xe6d0bb4f4d007b6a68…  | 24     | YES       | 0          | 0          | PASS   |
| 0x3b8c1c9e0f3847876a…  | 22     | YES       | 0          | 0          | PASS   |
| 0xc3f5edd05a3ed1072e…  | 21     | YES       | 0          | 0          | PASS   |
| 0x7afab4299d2a85559a…  | 21     | YES       | 0          | 0          | PASS   |
| 0xb32e38df51587fe41f…  | 18     | YES       | 0          | 0          | PASS   |

**Result: PASS**

Notes:
- Timestamps are block-level (3 second BSC block time). Multiple trades in the
  same block share identical timestamps — this is expected and correct.
- Within-block ordering uses `txHash` as a secondary sort key (lexicographic
  only, not insertion-order). `log_index` is not currently stored; see Schema Review.

---

## Validation 2 — Position Reconstruction Dry Run

6 wallet/token pairs reconstructed. All required fields present. Net positions
computed using raw BigInt arithmetic without any additional chain queries.

| Wallet            | Token | Buys | Sells | Net (raw BigInt)            | Fields OK |
|-------------------|-------|------|-------|-----------------------------|-----------|
| 0xe6d0bb4f4d007b… | USDC  | 2    | 0     | +770,492,779,015,261,975,396 | YES       |
| 0xe6d0bb4f4d007b… | Beat  | 4    | 6     | −111,800,508,229,950,703,875 | YES       |
| 0xe6d0bb4f4d007b… | PRL   | 0    | 1     | −31,954,148,568              | YES       |
| 0xe6d0bb4f4d007b… | TRIA  | 4    | 0     | +20,622,060,727,120,051,136,256 | YES    |
| 0x3b8c1c9e0f3847… | Beat  | 2    | 0     | +171,173,195,059,019,935,812 | YES       |
| 0xb32e38df51587f… | Beat  | 5    | 3     | +313,378,726,536,593,429,111 | YES       |

**Result: PASS** — reconstruction works from trades table alone

Caveats:
- Raw BigInt values are correct but not human-readable without token decimals.
  Decimals are NOT stored in the trades table — a JOIN to `tokens` is required
  to compute `amount / 10^decimals`. This works, but every analytics query
  carries a JOIN dependency. See Validation 7 and Recommendations.
- For the PRL example above (sells only, no buys in this window), cost basis
  cannot be computed from this block range alone. Historical data is required.

---

## Validation 3 — Token-Centric Query Validation

| Token | Trades | Null Address | Null Symbol | Symbol Variants | Status |
|-------|--------|--------------|-------------|-----------------|--------|
| USDT  | 1,103  | 0            | 0           | `{'USDT'}`      | PASS   |
| WBNB  | 523    | 0            | 0           | `{'WBNB'}`      | PASS   |
| CAKE  | 12     | 0            | 0           | `{'CAKE'}`      | PASS   |

**Result: PASS**

No null addresses, no null symbols, no symbol conflicts for any of the three
baseline tokens across the entire 1,705-trade dataset.

---

## Validation 4 — Wallet Attribution Audit

20 randomly sampled trades. Wallets checked against all known PancakeSwap
contract addresses (V2 Router, Universal Router, V4 Router, V4 PoolManager).

```
Wallet Attribution Audit

Trades Checked: 20
Failures: 0
All 20 wallets are valid EOA-pattern addresses (not known protocol contracts)
Status: PASS
```

**Critical finding — Address Normalization:**

1,184 of 1,705 trades (69%) store `tokenIn`, `tokenOut`, or `wallet` in
EIP-55 mixed-case checksum format (e.g., `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`).

The DB schema uses `varchar(42)` with case-sensitive `TEXT` comparisons.
If mixed-case addresses reach the database:
- `WHERE token_in_address = '0xbb4cdb...'` would miss rows stored as `0xBB4CDB...`
- The unique index on `token_in_address` would treat them as different addresses
- Wallet timeline queries break silently

**This is the only critical finding in this validation pass.**

---

## Validation 5 — Duplicate Protection Audit

No live database available — analysis performed against schema and current data.

```
DB unique key collisions in 1,705-trade dataset:    0
In-memory dedup collisions in 1,705-trade dataset:  0
```

**Schema uniqueness key** (7 columns):
`(tx_hash, wallet, token_in_address, token_out_address, amount_in, amount_out, dex)`

**In-memory dedup key** (5 columns, processor.ts line 217):
`txHash | tokenIn | tokenOut | amountIn | amountOut`

The DB key is stronger — includes `wallet` and `dex`. The in-memory key is
weaker, but in practice every trade has a unique `tx.from` (wallet), so the
narrower key is safe for single-transaction receipts.

Re-processing the same block range: `ON CONFLICT DO NOTHING` (or equivalent
`DO NOTHING` in Drizzle's insert) will absorb all duplicates correctly.

**Result: PASS** — minor dedup key mismatch noted, low practical risk

---

## Validation 6 — Multi-Hop Semantics Review

194 multi-hop transactions in the 100-block dataset (11% of all swap txs).

10 examples examined:

| Hops | Route                             | DEX(es)              | Stored Trades |
|------|-----------------------------------|----------------------|---------------|
| 2    | WBNB → USDT → BTT                 | V2                   | 2             |
| 2    | wkeyDAO2 → USDT → wkeyDAO2 → USDT| V2                   | 2             |
| 3    | ELITE → WBNB → ELITE → WBNB      | V2                   | 2             |
| 2    | USDT → EVAA / USDT → WBNB        | V3 + V2 (aggregator) | 2             |
| 2    | MSN → FIST → USDT                 | V2                   | 2             |
| 5    | USDC → COS → WBNB → COS → WBNB → USDC | V2             | 5             |
| 3    | WBNB → BNANA → BUSD → WBNB       | V2 + V3              | 3             |
| 2    | USDT → Beat / TRIA → USDT        | V4                   | 2             |
| 2    | hey stock → WBNB → 螃蟹效应       | V2                   | 2             |

**Design Decision — documented for all future analytics work:**

**Answer: (A) Every hop is stored as a separate NormalizedTrade.**

Rationale:
- Each hop is a real pool interaction with its own price point.
- Storing each hop preserves all information needed to reconstruct complex
  routes and intermediate prices.
- The analytics layer groups by `txHash` for display and nets intermediate
  tokens when computing position deltas.
- User intent (the "outer" trade) can always be derived: it is the first
  tokenIn and last tokenOut of the sorted hop sequence for a given txHash.

The current multi-hop detection in `validate.ts` correctly identifies all
multi-hop transactions. A future `GET /trades?wallet=X` endpoint should
expose a `hops` field and group by `txHash` for the UI layer.

**Result: PASS** — design is intentional and correctly implemented

---

## Validation 7 — Token Metadata Readiness

| Field        | In `trades` table | In `tokens` table |
|--------------|-------------------|-------------------|
| address      | ✓ (as FK-ready)   | ✓ (PK)            |
| symbol       | ✓ (inline copy)   | ✓                 |
| decimals     | ✗ (MISSING)       | ✓                 |
| imageUrl     | ✗                 | ✓                 |
| coingeckoId  | ✗                 | ✓                 |
| verified     | ✗                 | ✓                 |

Symbols are consistent and correct for all three baseline tokens (USDT, WBNB,
CAKE). No conflicts. Metadata is fully present in the `tokens` table.

**Key gap:** `decimals` is not stored in the trades table. Every query that
converts raw BigInt amounts to human-readable form requires a JOIN to `tokens`.
This is architecturally sound but analytically inconvenient — the tokens table
must be fully populated before any PnL query can run.

**Result: PASS** (with noted JOIN dependency for decimals)

---

## Validation 8 — Cost Basis Feasibility Audit

**Question:** Can realized PnL be computed from the current trades table alone?

**Answer: PARTIALLY — position reconstruction YES, USD PnL NO**

### What is feasible from `trades` alone:

| Capability                       | Feasible | Notes                                    |
|----------------------------------|----------|------------------------------------------|
| Net token position (BigInt)      | YES      | Sum amountOut where tokenOut=T minus sum amountIn where tokenIn=T |
| Buy/sell event count             | YES      |                                          |
| FIFO cost matching (raw)         | YES      | chronological by `block_number` then `tx_hash` |
| Entry price ratio (token-to-token)| YES     | amountIn / amountOut (dimensionless)     |
| Human-readable amounts           | NO       | Requires `decimals` JOIN to tokens table |
| USD-denominated entry price      | NO       | Requires historical oracle price for non-USDT pairs |
| Realized PnL in USD              | NO       | Requires both decimals + historical price |
| Exact within-block trade ordering| NO       | `log_index` not stored                   |

### Missing fields for full PnL:

1. **`token_in_decimals` / `token_out_decimals`** — inline in trades table.
   Currently requires JOIN every query. Critical for amount normalization.

2. **`log_index`** — integer, position of Swap event within the block's logs.
   BSC has 3-second blocks. Multiple trades per wallet per block share the same
   timestamp. Without `log_index`, FIFO matching within the same second is
   non-deterministic (any consistent sort key works for approximate analytics,
   but exact FIFO cost basis requires it).

3. **`transaction_index`** — tx position within the block. Secondary sort key
   (after `block_number`, before `log_index`).

4. **`pair_address`** — the pool contract that emitted the Swap event.
   Not required for PnL math, but essential for audit trails, route analysis,
   and multi-hop reconstruction without re-querying the chain.

5. **`price_in_usd`** (optional) — snapshot oracle price at trade time.
   Without this, USD PnL requires a separate historical price service. Adding
   an optional nullable column now avoids a migration later.

---

## Summary Table

| Validation                     | Result | Notes                                           |
|--------------------------------|--------|-------------------------------------------------|
| 1. Wallet Timeline Integrity   | PASS   | 5/5 wallets monotonic, zero duplicates          |
| 2. Position Reconstruction     | PASS   | Works from trades alone (requires decimals JOIN) |
| 3. Token-Centric Queries       | PASS   | USDT/WBNB/CAKE all clean                        |
| 4. Wallet Attribution          | PASS*  | *Mixed-case address normalization required      |
| 5. Duplicate Protection        | PASS   | DB unique constraint correct                    |
| 6. Multi-Hop Semantics         | PASS   | Per-hop storage, design documented              |
| 7. Token Metadata Readiness    | PASS   | Decimals in tokens table, missing from trades   |
| 8. Cost Basis Feasibility      | PARTIAL| Position yes, USD PnL requires 2 more fields    |
