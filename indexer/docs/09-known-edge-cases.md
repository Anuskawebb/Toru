# 09 — Known Edge Cases

This document catalogs every known edge case encountered during parser
development and the validation audit, with current handling and limitations.

---

## 1. Native BNB — Input Side

**Scenario:** User calls `swapExactETHForTokens` on V2 router (or equivalent
on V3). The transaction carries a `msg.value`; the user sent native BNB, not
WBNB ERC-20.

**On-chain behavior:** The router wraps BNB into WBNB internally
(`WBNB.deposit{value: amount}()`), then sends WBNB to the pair. The
ERC-20 Transfer for WBNB shows `from = router`, not `from = wallet`.

**What BscScan shows:** No WBNB ERC-20 Transfer from wallet. The ETH value
appears as an internal transaction.

**Current handling:**

- V2/V3: `fromPair` uses the signed Swap amounts, not Transfer events.
  `amount0`/`amount1` from the Swap event correctly reflects the native BNB
  amount. The pair cache gives `token0 = WBNB`, so the reconstruction produces
  `tokenIn = WBNB, amountIn = <BNB_amount>`.
- V4: `resolveV4Tokens` cannot find a Transfer matching the BNB amount
  (no ERC-20 Transfer exists). The WBNB fallback triggers if the other side
  (token received) is resolved: `if (token1 !== null && token0 === null) token0 = WBNB`.

**Result:** Correctly produces `tokenIn = WBNB`. The amount is taken from the
Swap event (pool perspective), which matches the amount the pool received after
wrapping — same as the BNB the user sent (no fee loss on WBNB.deposit).

**BscScan verification limitation:** Cannot verify via Token Transfers tab.
Use the BscScan internal transactions tab or the Events tab.

---

## 2. Native BNB — Output Side

**Scenario:** User calls `swapExactTokensForETH`. Router receives WBNB from
pool, calls `WBNB.withdraw(amount)`, and sends native BNB directly to the user.

**On-chain behavior:** WBNB Transfer goes `pair → router`. Router sends native
BNB to wallet. No WBNB ERC-20 Transfer goes to the wallet.

**What BscScan shows:** No WBNB Transfer to wallet in Token Transfers tab.
BNB appears in the ETH internal transactions section.

**Current handling:**

- V2/V3: `fromPair` uses the signed Swap amounts. Pool reports WBNB amount;
  reconstruction produces `tokenOut = WBNB`. Amount is from Swap event.
- V4: `fromTransfers` or `resolveV4Tokens` handles via WBNB fallback —
  if wallet receives no ERC-20 but Swap has a positive amount, that amount
  is attributed to WBNB.

**Result:** Correctly produces `tokenOut = WBNB`. Amount matches what the
pool sent out (before the router's unwrap step, which is lossless).

**BscScan verification limitation:** Same as above — Token Transfers tab
doesn't show this.

---

## 3. V4 PoolManager Internal Accounting

**Scenario:** Any V4 swap.

**On-chain behavior:** V4's PoolManager holds all pool balances internally.
Token movements between pools and between the user and pools happen as
internal PoolManager balance updates, not as direct ERC-20 Transfers to/from
the user's wallet. The ERC-20 Transfers in the receipt go between protocol
contracts (router → PoolManager, hook contracts, etc.).

**Consequence:** The wallet address (`receipt.from`) appears in **zero**
ERC-20 Transfer events in most V4 transactions. `fromTransfers` will fail
(returns `null` with a warning). `resolveV4Tokens` succeeds by matching
amounts from any Transfer, not wallet-specific ones.

**Verified empirically:** For tx `0x4f14a15e...` (USDT→BTW V4 swap, wallet
`0xab5430b...`): 12 ERC-20 Transfer events in receipt, wallet address in zero
of them. Amounts from the V4 Swap event matched correctly against Transfer
values in the receipt.

**Current handling:** `resolveV4Tokens` is the primary strategy for V4.
It does NOT filter by wallet — it finds any Transfer with an amount matching
the Swap event's absolute amount.

**Limitation:** If two different tokens happen to have ERC-20 Transfers with
the same raw amount in the same receipt, the first match wins. This is
extremely unlikely in practice (amounts are raw integers with 18 decimal
places) but theoretically possible.

---

## 4. Fee-on-Transfer Tokens (Above Threshold)

**Scenario:** Token with a transfer fee above the detection threshold (>0.5%).

**On-chain behavior:** When the pool sends the token via `transfer()`, the
token contract deducts a fee. The pool sends `X`, the recipient receives
`X - fee`. The Swap event reports `X` (what left the pool). The wallet
receives `X - fee`.

**Current handling:** `checkFeeOnTransfer()` in `audit.ts` detects tokens
with round-trip ratio deviating more than 0.5%. These tokens are excluded
from the audit candidate set.

In the main indexer pipeline, fee-on-transfer tokens are NOT filtered — their
trades are still recorded. `amountOut` reflects the pool's reported output
(pre-fee). The actual wallet receipt is `amountOut - fee`.

**Limitation for analytics:** `amountOut` for fee-on-transfer tokens is an
overstatement of what the wallet actually received. PnL calculations will
be slightly overstated for the output side, and slightly understated for the
input side (when the token is sold, the pool receives less than `amountIn`).

---

## 5. Fee-on-Transfer Tokens (Below Threshold)

**Scenario:** Token with a fee below the 0.5% detection threshold.

**Example:** ELEU token (~0.3% fee). Wallet sent 3954.266 ELEU; pool received
3942.403 ELEU (confirmed via receipt Transfer event inspection). Difference:
~0.3%, below `FEE_THRESHOLD = 0.005`.

**Current handling:** Not detected. The trade passes all automated assertions.
The Swap event reports the pool-level amount (3942.403 ELEU), which differs
from the wallet-level Transfer amount (3954.266 ELEU) by ~11.86 ELEU.

**Impact on BscScan verification:** BscScan's Token Transfers tab shows the
wallet-level amount (what left the wallet), not the pool-level amount. For
ELEU, this caused a verification mismatch of ~11.86 tokens.

**Impact on analytics:** For input tokens with sub-threshold fees, `amountIn`
is slightly understated (pool received less than wallet sent). For output
tokens, same issue applies. The error is bounded by the fee rate (< 0.5%).

---

## 6. Aggregator-Routed Trades

**Scenario:** User interacts with an aggregator (1inch, Paraswap, etc.) rather
than directly with a PancakeSwap router. The aggregator may use permit2 or
internal custody, resulting in no direct wallet-level ERC-20 Transfer.

**On-chain behavior:** The wallet signs a transaction to the aggregator. The
aggregator submits its own transaction (or uses permit2 to batch). In some
cases, `receipt.from` is the user's wallet, but no token transfer appears
FROM the wallet — the aggregator uses a pre-approved allowance or a gasless
relay.

**Current handling:**

- `receipt.from` is still the user's EOA — wallet attribution is correct.
- V2/V3 `fromPair` reconstruction works correctly (uses Swap event amounts,
  not Transfer events) — trade amounts are correct.
- `fromTransfers` fallback will fail (no wallet-level Transfers), but it's
  not needed if `fromPair` succeeds.
- For V4 via aggregator, same applies: `resolveV4Tokens` works if Transfer
  amounts match; `fromTransfers` fails.

**Limitation:** Multi-hop via aggregator may produce reconstruction failures
if the aggregator uses a routing strategy that produces unusual Transfer
patterns. Currently handled gracefully (returns null, logs warning, skips).

---

## 7. Flash Swaps

**Scenario:** A flash swap borrows tokens and repays in the same transaction.
For V2: both `amount0In` and `amount0Out` are non-zero for the same token.

**On-chain behavior (V2):** The Swap event has non-zero values for both `In`
and `Out` fields of the same token. After the `amount0 = amount0Out - amount0In`
calculation, the sign depends on which is larger.

**Current handling:**

The `fromPair` function skips events where both amounts have the same sign:

```ts
// Both same sign → flash swap or degenerate; skip
if (!(amount0 < 0n && amount1 > 0n) && !(amount0 > 0n && amount1 < 0n)) {
  return null;
}
```

If a flash swap's net amounts happen to produce opposite signs (e.g., user
borrowed token0, repaid less than borrowed, and paid with token1), it would
pass the sign check and be recorded as a trade. This is technically correct —
the user did have a net position change — but may not match the user's intent.

**Impact:** Flash swaps are generally skipped (same-sign amounts). Net-positive
flash swaps may occasionally be recorded. This edge case has no known impact
on the current dataset.

---

## 8. Multi-Hop Deduplication (V4 fromTransfers)

**Scenario:** A multi-hop V4 swap produces N Swap events. If `resolveV4Tokens`
fails for some hops and `fromTransfers` is used, all hops may produce the
same `NormalizedTrade` (same wallet-level Transfers, same tokens, same amounts).

**Current handling:**

In-memory deduplication in `BlockProcessor`:

```ts
const key = `${trade.txHash}|${trade.tokenIn.toLowerCase()}|
             ${trade.tokenOut.toLowerCase()}|${trade.amountIn}|${trade.amountOut}`;
if (seen.has(key)) continue;
```

The first occurrence is kept; duplicates are discarded.

**Consequence:** For multi-hop V4 where `fromTransfers` is used, only the
first reconstruction is kept. If the hops genuinely have different amounts
(different intermediates), the dedup key will differ and both are kept.

---

## 9. Non-Standard Token Metadata

**Scenario:** Token uses `bytes32` instead of `string` for `symbol()`, or
doesn't implement `symbol()` or `decimals()` at all.

**Examples:** Some older BSC tokens, some rebasing tokens, proxy contracts
without proper ABI.

**Current handling:**

In `token-cache.ts`:

```ts
} catch {
  const meta = {
    symbol:   address.slice(0, 8) + '…',
    decimals: 18,
  };
  // stored in cache and returned
}
```

The fallback produces a truncated address stub as the symbol and assumes 18
decimals. The trade is still recorded with the stub symbol.

**Impact on display:** Symbol shows as `0xBB4CDB…` instead of a readable name.
**Impact on amounts:** If the actual decimals differ from 18, `amountInFormatted`
will be wrong by `10^(actual - 18)` orders of magnitude.

**Known affected tokens:** Rare. Common BSC tokens use standard ERC-20 ABI.

---

## 10. Reverted Transactions

**Scenario:** User submits a swap that reverts (slippage exceeded, contract
error, etc.).

**Current handling:** `extractEvents` returns `[]` for `receipt.status ===
'reverted'`. No events are extracted, no parsing occurs, no trade is recorded.

**Result:** Reverted transactions are completely invisible in the normalized
trade output. This is correct behavior.

---

## 11. Pending Blocks

**Scenario:** `getBlock` is called with a block tag that returns a pending block
(no block hash or number yet).

**Current handling:**

```ts
if (raw.number === null || raw.hash === null) {
  throw new Error('Received pending block — only finalised blocks are supported');
}
```

Throws immediately. `BlockProcessor` and `BlockPoller` only call `getBlock`
with explicit block numbers or `'latest'` (which BSC returns as finalized on
the same-tick basis). This error should not occur in normal operation.
