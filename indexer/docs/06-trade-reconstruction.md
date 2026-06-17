# 06 — Trade Reconstruction

## What is a `NormalizedTrade`?

```ts
// src/types/index.ts
interface NormalizedTrade {
  txHash:           `0x${string}`;
  blockNumber:      bigint;
  blockTimestampMs: number;
  wallet:           `0x${string}`;
  pairAddress:      `0x${string}`;
  tokenIn:          `0x${string}`;
  tokenOut:         `0x${string}`;
  amountIn:         bigint;
  amountOut:        bigint;
  dex:              Dex;
}
```

### Field Definitions

| Field | Type | Meaning |
|---|---|---|
| `txHash` | `0x${string}` | Transaction hash. Groups multi-hop trades. |
| `blockNumber` | `bigint` | Block number (bigint, safe for BSC's large numbers). |
| `blockTimestampMs` | `number` | Block Unix timestamp in milliseconds. Not tx-level. |
| `wallet` | `0x${string}` | EOA that submitted the transaction (`receipt.from`). |
| `pairAddress` | `0x${string}` | Pool/pair contract that emitted the Swap event. |
| `tokenIn` | `0x${string}` | Address of the token the wallet sold. |
| `tokenOut` | `0x${string}` | Address of the token the wallet received. |
| `amountIn` | `bigint` | Raw amount of `tokenIn` sold (without decimal normalization). |
| `amountOut` | `bigint` | Raw amount of `tokenOut` received. |
| `dex` | `Dex` | `'pancakeswap-v2' \| 'pancakeswap-v3' \| 'pancakeswap-v4'` |

**`amountIn` and `amountOut` are raw token amounts** (integer, in the token's
smallest unit). To convert to human-readable: `amount / 10^decimals`. The
`formatAmount()` helper in `tokens/registry.ts` does this without floating point.

**`blockTimestampMs`** is block-level, not transaction-level. All transactions
in the same block share the same timestamp. On BSC (3s blocks), multiple
trades from the same wallet in the same block will have identical timestamps.

**`pairAddress`** is the contract address that emitted the Swap event:
- V2: the pair contract (e.g., `USDT/WBNB` pair)
- V3: the pool contract
- V4: the PoolManager contract (`0xa0ffb9c1...`) — same address for all V4 pools

---

## `RawSwap` — The Intermediate Format

```ts
interface RawSwap {
  txHash:           `0x${string}`;
  blockNumber:      bigint;
  blockTimestampMs: number;
  wallet:           `0x${string}`;
  contractAddress:  `0x${string}`;
  dex:              Dex;
  amount0:          bigint;        // unified swapper perspective
  amount1:          bigint;        // unified swapper perspective
  token0?:          `0x${string}`; // absent for V4
  token1?:          `0x${string}`; // absent for V4
  siblingEvents:    readonly RawEvent[];
}
```

All parsers produce `RawSwap` with amounts in **swapper perspective**:
- `amount > 0`: user received this currency
- `amount < 0`: user sent this currency

The V2 parser subtracts (net: `out - in`). The V3 parser negates (pool → swapper).
V4 amounts are already in swapper perspective from the chain.

---

## Reconstruction Entry Point

```ts
// src/reconstruction/trade-reconstructor.ts
export function reconstructTrade(raw: RawSwap): NormalizedTrade | null {
  if (raw.token0 !== undefined && raw.token1 !== undefined) {
    return fromPair(raw, raw.token0, raw.token1);
  }

  const resolved = resolveV4Tokens(raw);
  if (resolved !== null) {
    return fromPair(raw, resolved.token0, resolved.token1);
  }

  return fromTransfers(raw);
}
```

Three strategies, applied in priority order:

---

## Strategy 1 — `fromPair` (V2 and V3)

Used when `token0` and `token1` are known (always true for V2 and V3).

```ts
function fromPair(raw, token0, token1): NormalizedTrade | null {
  const { amount0, amount1 } = raw;

  if (amount0 < 0n && amount1 > 0n) {
    // User sent token0, received token1
    return makeNormalized(raw, token0, token1, -amount0, amount1);
  }
  if (amount0 > 0n && amount1 < 0n) {
    // User received token0, sent token1
    return makeNormalized(raw, token1, token0, -amount1, amount0);
  }

  // Both same sign → flash swap or degenerate event; skip
  return null;
}
```

**Why both-same-sign → skip?**

In a legitimate standard swap exactly one side is positive (received) and one
is negative (sent). If both are positive or both negative, the event is either:
- A flash swap (borrow + repay in the same tx — no net trade for this wallet)
- A malformed/degenerate event that doesn't represent a user swap

Flash swaps are deliberately skipped — they are not trader activity.

---

## Strategy 2 — `resolveV4Tokens` (V4 primary)

V4 Swap events don't include token addresses. Instead, the reconstructor
matches the Swap event's absolute amounts against ERC-20 Transfer amounts
found anywhere in the same receipt.

```ts
function resolveV4Tokens(raw): { token0, token1 } | null {
  const transfers = extractTransfers(raw.siblingEvents);  // all ERC-20 Transfers in receipt
  const abs0 = abs(raw.amount0);
  const abs1 = abs(raw.amount1);

  let token0 = null;
  let token1 = null;

  for (const t of transfers) {
    if (t.amount === abs0 && token0 === null) token0 = t.token;
    if (t.amount === abs1 && token1 === null) token1 = t.token;
  }

  // Native BNB fallback: if exactly one side is unresolved, it's likely BNB
  if (token0 !== null && token1 === null && abs1 > 0n) token1 = WBNB;
  if (token1 !== null && token0 === null && abs0 > 0n) token0 = WBNB;

  if (token0 !== null && token1 !== null) return { token0, token1 };
  return null;
}
```

**Amount matching:** Scans all Transfer events (not wallet-specific) for any
transfer whose `value` matches the Swap's absolute amount. This works because
V4's internal accounting routes the exact pool amount through ERC-20 Transfers
between protocol contracts — the amount in the Swap event and the Transfer
events are the same integer.

**Native BNB fallback:** BNB has no ERC-20 contract, so no Transfer event
exists for the BNB leg of a swap. If exactly one side resolves and the other
doesn't, the missing side is assumed to be BNB and substituted with the WBNB
canonical address. The amount comes from the signed Swap field.

**WBNB is the canonical form for native BNB** throughout the entire platform.
This is a deliberate design decision — WBNB has a fixed address and decimal
count, making it unambiguous in analytics queries.

**Why not always use wallet-level Transfers?**

V4's PoolManager-based accounting means the wallet address (`receipt.from`)
may not appear in any Transfer event at all. The tokens route through the
router → PoolManager → hook contracts, never reaching the EOA directly via
ERC-20 transfers. Wallet-level transfer matching would silently fail for all
V4 trades.

---

## Strategy 3 — `fromTransfers` (V4 fallback)

Used when amount-based matching in Strategy 2 fails to identify both tokens.
This is the wallet-level Transfer fallback.

```ts
function fromTransfers(raw): NormalizedTrade | null {
  const walletLow = raw.wallet.toLowerCase();
  const transfers = extractTransfers(raw.siblingEvents);

  const sent = transfers.filter(t => t.from.toLowerCase() === walletLow && t.amount > 0n);
  const recv = transfers.filter(t => t.to.toLowerCase()   === walletLow && t.amount > 0n);

  // Both ERC-20
  if (sent.length > 0 && recv.length > 0) {
    // Take first sent, last received (last-hop for multi-hop)
    return makeNormalized(raw, sent[0].token, recv[recv.length-1].token,
                          sent[0].amount, recv[recv.length-1].amount);
  }

  // Sent native BNB, received ERC-20
  if (sent.length === 0 && recv.length > 0) {
    const bnbIn = raw.amount0 < 0n ? -raw.amount0 : raw.amount1 < 0n ? -raw.amount1 : null;
    if (!bnbIn || bnbIn === 0n) return null;
    return makeNormalized(raw, WBNB, recv[recv.length-1].token, bnbIn, recv[recv.length-1].amount);
  }

  // Sent ERC-20, received native BNB
  if (recv.length === 0 && sent.length > 0) {
    const bnbOut = raw.amount0 > 0n ? raw.amount0 : raw.amount1 > 0n ? raw.amount1 : null;
    if (!bnbOut || bnbOut === 0n) return null;
    return makeNormalized(raw, sent[0].token, WBNB, sent[0].amount, bnbOut);
  }

  // No wallet-level transfers found at all
  logger.warn('Trade reconstruction failed — no Transfer events match wallet', {...});
  return null;
}
```

**When does this succeed?**

When the user's wallet appears directly in Transfer events — which happens
for non-aggregated V2/V3 swaps with standard ERC-20 tokens:
- Standard V2: `transferFrom(wallet, pair, amount)` → wallet appears in Transfer.from
- Standard V3: same.
- V4 via direct router (rare): wallet appears if the router doesn't take custody.

**When does this fail?**

- V4 with PoolManager internal accounting (most V4 trades) — no wallet-level Transfers.
- Aggregator routes where a relay contract is `receipt.from` but the actual
  user's intent is encoded elsewhere.

---

## Multi-Hop Semantics

A multi-hop swap emits multiple Swap events in the same transaction. Each
Swap event goes through the full parser → reconstruction pipeline independently.

**One Swap event → one `NormalizedTrade`.**

A 3-hop swap produces 3 `NormalizedTrade` records with the same `txHash`.
They are distinguished by `tokenIn`/`tokenOut`/`pairAddress`.

**Why store per-hop, not per-transaction?**

- Each hop is a real pool interaction with its own price point.
- Per-hop storage preserves intermediate token prices, pool identities, and
  amounts — all necessary for accurate PnL and routing analysis.
- Aggregating to a single tx-level trade would lose the intermediate token
  and the intermediate price.

**How analytics should consume multi-hop:**

The analytics layer receives a list of `NormalizedTrade` objects. For display,
group by `txHash`. For position tracking, net intermediate tokens to zero:
if wallet "buys" WBNB in hop 1 and "sells" WBNB in hop 2 of the same tx,
the WBNB net position delta is zero.

**In-memory deduplication** in `BlockProcessor` prevents the same trade from
appearing twice when V4's `fromTransfers` fallback produces the same result
for multiple Swap events in a multi-hop tx:

```ts
const key = `${trade.txHash}|${trade.tokenIn.toLowerCase()}|
             ${trade.tokenOut.toLowerCase()}|${trade.amountIn}|${trade.amountOut}`;
if (seen.has(key)) continue;
```

---

## Reconstruction Assumptions

| Assumption | Where it matters |
|---|---|
| `receipt.from` is the trader's EOA | All protocols — wallet attribution |
| Exactly one of {amount0, amount1} is positive in a standard swap | V2/V3 `fromPair` |
| V4 ERC-20 Transfer amounts equal the Swap event amounts | V4 `resolveV4Tokens` |
| Native BNB is representable as WBNB | V4 native BNB fallback |
| The "last" received Transfer is tokenOut in a multi-hop | `fromTransfers` |
| Flash swaps have same-sign amounts and should be skipped | `fromPair` |

These assumptions hold for the vast majority of standard BSC swaps.
Deviations are documented in `09-known-edge-cases.md`.
