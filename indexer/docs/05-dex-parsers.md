# 05 — DEX Parsers

## Design Principle

Every parser implements the `EventParser` interface:

```ts
interface EventParser {
  readonly name: string;
  canParse(event: RawEvent): boolean;
  parse(event: RawEvent, context: ParseContext): Promise<RawSwap | null>;
}
```

Parsers produce `RawSwap`, not `NormalizedTrade`. Token direction and trade
identity are resolved in `TradeReconstructor` — keeping that logic in one
place rather than duplicated across three parsers.

The `canParse` → `parse` split exists for performance: `canParse` is called
for every log in every block (synchronous, O(1)); `parse` is only called when
`canParse` returns true.

---

## PancakeSwap V2

**File:** `src/parsers/pancakeswap-v2.ts`

### Event Signature

```
Swap(
  address indexed sender,
  uint256 amount0In,
  uint256 amount1In,
  uint256 amount0Out,
  uint256 amount1Out,
  address indexed to
)

topic0: 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
topics:  [topic0, sender (indexed), to (indexed)]   → 3 topics
data:    [amount0In, amount1In, amount0Out, amount1Out]  → 4 × 32 bytes = 258 chars
```

### Detection

```ts
export function isPancakeSwapV2Swap(event: RawEvent): boolean {
  return (
    event.topics[0] === SWAP_TOPIC &&          // matches V2 signature
    event.topics.length === EXPECTED_TOPIC_COUNT &&  // exactly 3 topics
    event.data.length === EXPECTED_DATA_LENGTH   // exactly 258 chars
  );
}
```

The `data.length` check disambiguates V2 from V3 (which also uses 3 topics
but has 5 data fields = 322 chars).

### Decoding

Raw hex slicing — no ABI decoder library:

```ts
const hex = event.data.slice(2);  // strip "0x"
const amount0In  = BigInt('0x' + hex.slice(0,   64));
const amount1In  = BigInt('0x' + hex.slice(64,  128));
const amount0Out = BigInt('0x' + hex.slice(128, 192));
const amount1Out = BigInt('0x' + hex.slice(192, 256));

// Indexed parameters come from topics
const sender = `0x${event.topics[1].slice(26)}`;  // last 20 bytes of 32-byte topic
const to     = `0x${event.topics[2].slice(26)}`;
```

All four amounts are `uint256` (unsigned). Exactly one of `{amount0In,
amount0Out}` is non-zero; the other is zero. Same for `amount1`.

### Amount Convention

V2 amounts are unsigned. Converting to unified swapper perspective:

```ts
const amount0 = decoded.amount0Out - decoded.amount0In;  // positive = user received token0
const amount1 = decoded.amount1Out - decoded.amount1In;  // positive = user received token1
```

For a standard swap: one of `{amount0In, amount0Out}` is zero, so this gives
either `+amount0Out` or `-amount0In`. In a flash swap both can be non-zero;
the sign arithmetic still holds.

### Token Resolution

V2 pairs expose `token0()` and `token1()` view functions. The parser calls
`getTokenPair(event.contractAddress)` from `pair-cache.ts`. This is an RPC
call on the first encounter; subsequent calls return from the cache instantly.

The pair address is `event.contractAddress` — the contract that emitted the
Swap log. This is the V2 pair, not the router.

### Example

**Tx:** Standard V2 swap, wallet sells 6.51 USDT for 5.19 GOT.

```
event.contractAddress = 0xPAIR_ADDRESS    (USDT/GOT pair)
event.data:
  amount0In  = 6511679909000000000  (6.51 USDT, token0 = USDT)
  amount1In  = 0
  amount0Out = 0
  amount1Out = 5190264207           (5.19 GOT, token1 = GOT, 9 decimals)

amount0 = 0 - 6511679909000000000 = -6511679909000000000  (negative = user sold)
amount1 = 5190264207 - 0          = +5190264207           (positive = user received)

→ RawSwap { amount0: -6.51e18, amount1: +5.19e9, token0: USDT, token1: GOT }
→ NormalizedTrade { tokenIn: USDT, tokenOut: GOT, amountIn: 6.51e18, amountOut: 5.19e9 }
```

---

## PancakeSwap V3

**File:** `src/parsers/pancakeswap-v3.ts`

PancakeSwap V3 is a Uniswap V3 fork. The Swap event structure is identical to
Uniswap V3.

### Event Signature

```
Swap(
  address indexed sender,
  address indexed recipient,
  int256  amount0,       // POOL perspective
  int256  amount1,       // POOL perspective
  uint160 sqrtPriceX96,
  uint128 liquidity,
  int24   tick
)

topic0: keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)")
topics:  [topic0, sender (indexed), recipient (indexed)]  → 3 topics
data:    [amount0, amount1, sqrtPriceX96, liquidity, tick]  → 5 × 32 bytes = 322 chars
```

### Pool Perspective vs Swapper Perspective

V3 uses **pool perspective**: amounts represent how the pool's balances change.

```
amount0 > 0  → token0 flowed INTO the pool   → user SOLD token0
amount0 < 0  → token0 flowed OUT of the pool → user BOUGHT token0
```

This is the **opposite** of V4's swapper perspective. To unify:

```ts
const amount0 = -decoded.poolAmount0;  // negate: pool perspective → swapper perspective
const amount1 = -decoded.poolAmount1;
```

After negation, the same `fromPair` reconstruction logic in
`TradeReconstructor` works for both V2 and V3.

### Signed Integer Decoding

`int256` requires two's complement decoding:

```ts
function decodeInt256(hex: string): bigint {
  const raw = BigInt('0x' + hex);
  return raw >= 2n ** 255n ? raw - 2n ** 256n : raw;
}
```

The same function is used in V4 for `int128` (the threshold is the same
because both types share the sign bit position in their 256-bit ABI slot).

### Token Resolution

Same as V2: `getTokenPair(event.contractAddress)`. V3 pools expose the same
`token0()`/`token1()` interface as V2 pairs. The pair cache is shared.

### Example

**Tx:** V3 swap, wallet sells 7435.03 NEX for 22.46 USDT.

```
Decoded poolAmount0 = +7435032700000000186264514  (NEX flowing into pool)
Decoded poolAmount1 = -22465371274529498278        (USDT flowing out of pool)

After negation (swapper perspective):
  amount0 = -7435032700000000186264514  (user sold NEX = token0)
  amount1 = +22465371274529498278       (user received USDT = token1)

→ NormalizedTrade { tokenIn: NEX, tokenOut: USDT, amountIn: 7435e18, amountOut: 22.46e18 }
```

---

## PancakeSwap V4

**File:** `src/parsers/pancakeswap-v4.ts`

V4 is a fundamentally different architecture from V2 and V3. Understanding
the architecture is necessary to understand why the parser is structured as it is.

### V4 Architecture: The PoolManager

In V2 and V3, each pool is an independent contract. Token transfers happen
directly between the trader's wallet and the pool.

In V4, **all pools live inside a single `PoolManager` contract**
(`0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b` on BSC). Token flows are
tracked as internal balance changes. The actual ERC-20 transfers happen
between contracts in the routing layer (Router → PoolManager → hook
contracts), not between the user's wallet and any pool.

**Consequence:** A V4 swap may produce **zero** ERC-20 Transfer events
involving the user's wallet. The user's wallet is `receipt.from` (the EOA
that signed the tx), but that address may not appear in any Transfer event.

### Event Signature

```
Swap(
  bytes32 indexed id,        // PoolId = keccak256(abi.encode(PoolKey))
  address indexed sender,    // router address, NOT the EOA wallet
  int128  amount0,           // SWAPPER perspective (positive = received)
  int128  amount1,           // SWAPPER perspective (positive = received)
  uint160 sqrtPriceX96,
  uint128 liquidity,
  int24   tick,
  uint24  fee,               // e.g., 800 = 0.08%
  uint16  protocolFee
)

topic0: keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24,uint16)")
topics:  [topic0, poolId (indexed), sender (indexed)]  → 3 topics
data:    [amount0, amount1, sqrtPriceX96, liquidity, tick, fee, protocolFee]
         → 7 × 32 bytes = 448 hex chars + "0x" = 450 chars
```

### Amount Convention

V4 amounts are already in **swapper perspective** — no negation needed.

```
amount0 > 0  → swapper received currency0
amount0 < 0  → swapper sent currency0
```

This is confirmed against real BSC transactions (`0xa8cee3d12...`). The comment
in the source reads:

```ts
// Sign convention verified against real BSC tx 0xa8cee3d12... (2026-06-17)
```

### Token Identity Problem

The V4 Swap event contains a `poolId` (bytes32 hash of the pool's key), but
the pool key is not recoverable from the hash alone. Unlike V2/V3, there is
no `token0()` / `token1()` call available on the PoolManager.

The parser therefore emits a `RawSwap` with `token0` and `token1` absent:

```ts
return {
  // ...
  amount0: decoded.amount0,   // swapper perspective — no conversion
  amount1: decoded.amount1,
  // token0/token1 absent — TradeReconstructor uses siblingEvents
  siblingEvents: context.siblingEvents,
};
```

Token identity is deferred to `TradeReconstructor`. See
`06-trade-reconstruction.md` for how V4 tokens are derived.

### Fee Field

The `fee` field (7th data slot, `uint24`) encodes the pool fee in hundredths
of a basis point. `fee = 800` means 0.08%. This data is decoded and available
in `DecodedV4Swap.fee` but is not currently propagated to `NormalizedTrade`.
It is available for future analytics work.

### Example: Direct V4 Swap

**Tx:** V4 swap, wallet sells 24.849276 FOLKS (6 decimals) for 51.944 USDT.

```
V4 Swap event amounts (swapper perspective):
  amount0 = -24849276         (negative = sent by swapper, FOLKS token)
  amount1 = +51944081671357552111  (positive = received by swapper, USDT)

No wallet-level ERC-20 Transfers exist (V4 internal accounting).
resolveV4Tokens():
  Scans all Transfer events in receipt for amounts matching 24849276 and 51944...
  Finds FOLKS transfer (contract = FOLKS, amount = 24849276) → token0 = FOLKS address
  Finds USDT transfer (contract = USDT, amount = 51944...) → token1 = USDT address

→ fromPair(FOLKS, USDT):
  amount0 (-) = user sent FOLKS  → tokenIn = FOLKS, amountIn = 24849276
  amount1 (+) = user received USDT → tokenOut = USDT, amountOut = 51944...
```

### Example: V4 Swap with Native BNB

**Tx:** V4 swap, wallet sells WBNB for MITO.

```
amount0 = -104265850793844896  (sent: BNB, no ERC-20 Transfer to wallet)
amount1 = +2949023880368269489391  (received: MITO)

resolveV4Tokens():
  Finds MITO transfer → token1 = MITO
  Does NOT find a transfer matching 104265850793844896 (native BNB has no ERC-20)
  One side resolved, one not → WBNB fallback:
    if (token1 !== null && token0 === null && abs0 > 0n) token0 = WBNB;

→ tokenIn = WBNB, amountIn = 104265850793844896 (from Swap amount0 magnitude)
→ tokenOut = MITO, amountOut = 2949023880368269489391
```

---

## Parser Registration Order

```ts
// src/index.ts
const registry = new ParserRegistry()
  .register(pancakeswapV2Parser)
  .register(pancakeswapV3Parser)
  .register(pancakeswapV4Parser);
```

Order matters: V2 and V3 share 3-topic structure but different data lengths,
and V4 uses a completely different topic hash. All three have distinct `topic0`
values, so detection is unambiguous. The registration order has no effect on
correctness, only on iteration order in `ParserRegistry.parse()`.

---

## Adding a New Parser

1. Create `src/parsers/<dex>.ts`.
2. Determine the Swap event signature hash (compute with `keccak256` or look
   up from the contract ABI).
3. Implement `canParse(event)` — compare `event.topics[0]` to the hash,
   validate topic count, validate data length.
4. Implement `parse(event, context)` — decode raw hex into a `RawSwap`.
   Use swapper perspective for `amount0`/`amount1`.
5. Add `token0`/`token1` if the protocol exposes them (call `getTokenPair`
   or equivalent). Leave them absent if token identity must come from Transfers.
6. Call `registry.register(myParser)` in `src/index.ts`.
7. Add the new `dex` string to the `Dex` union type in `src/types/index.ts`.
