# Mantle DEX Integration — Top Traders / Leader Activity

This document explains how Aether observes "leader" trading activity on Mantle
by reading swap events directly from an Agni Finance (Algebra V3 fork) pool on
**Mantle Mainnet** (chain id `5000`), and how that feeds the `/api/traders`
endpoint, the traders/discover page, and the watcher's copy-trading pipeline.

If you're new to this codebase: leaders are NOT users of our app. They're
arbitrary wallets that trade on Agni's public USDe/WMNT pool. We watch that
pool's `Swap` events, classify each swap as a BUY or SELL, compute volume and
P&L per address, and rank/display the most active addresses as "traders" that
other users can choose to copy.

## 1. Why Agni Finance, and why this pool

[Agni Finance](https://agni.finance) is the dominant DEX on Mantle and is a
fork of **Algebra V3 / Integral** (the same AMM design used by QuickSwap,
Camelot, etc — concentrated liquidity with a single global pool price,
dynamic fees, and a `globalState()`/`Swap` interface rather than Uniswap V3's
`slot0()`/`Swap`).

The pool we track:

| | |
|---|---|
| Pool address | `0xeAFC4d6D4c3391cd4fc10c85D2f5F972D58C0Dd5` |
| Chain | Mantle Mainnet (`5000`), RPC `https://rpc.mantle.xyz` |
| token0 | USDe — Ethena's synthetic dollar, 18 decimals, **~$1 pegged stable** |
| token1 | WMNT — wrapped MNT, 18 decimals, **volatile** |
| Explorer | https://mantlescan.xyz/address/0xeAFC4d6D4c3391cd4fc10c85D2f5F972D58C0Dd5 |

This is one of the highest-volume pools on Agni and gives us a clean
stable/volatile pair: every swap's USD value can be read straight off the
USDe leg (`amount0`) without needing a separate price oracle for the trade
itself. WMNT's price is still needed for P&L (see §5).

The frontend's `lib/price.ts` (`getWmntPrice`) and the watcher's
`src/price.ts` (`getCurrentWmntPrice`) both read this same pool's
`globalState()` to get the live WMNT/USD price, so the price used for the UI,
P&L, and the copy-trading keeper are all derived from one source of truth.

Two other Agni pools (USDe/USDT, USDC/USDT) were considered as additional
leader-activity sources but are **not currently wired up** — their
token0/token1 ordering and decimals were not verified, and the single
USDe/WMNT pool already provides a representative sample of active traders.
If you add them later, verify `token0()`/`token1()` on-chain first (see §3).

## 2. The non-standard `Swap` event ABI

This is the single most important — and easiest to get wrong — piece of this
integration.

The "standard" Algebra V3 `Swap` event (the one you'll find in most Algebra
SDK docs and in older code in this repo, e.g. the removed
`watcher/src/check-mantle-pool.ts`) has **7 fields**:

```solidity
event Swap(
  address indexed sender,
  address indexed recipient,
  int256 amount0,
  int256 amount1,
  uint160 sqrtPriceX96,
  uint128 liquidity,
  int24 tick
);
```

**Agni's deployed `AlgebraPool` contract extends this with two extra fields**
for protocol fee accounting:

```solidity
event Swap(
  address indexed sender,
  address indexed recipient,
  int256 amount0,
  int256 amount1,
  uint160 sqrtPriceX96,
  uint128 liquidity,
  int24 tick,
  uint128 protocolFeesToken0,
  uint128 protocolFeesToken1
);
```

If you decode logs from this pool using the 7-field ABI, **viem will return
zero matching events** — the topic hash (keccak256 of the event signature,
which includes the full parameter type list) won't match what the contract
actually emits, because the signature includes the trailing
`uint128,uint128`. This was the actual bug that motivated this document: an
earlier implementation used the textbook 7-field ABI and silently scanned 0
swaps.

The verified 9-field ABI (used by `frontend/app/api/traders/route.ts` and
`watcher/src/price.ts`):

```ts
const SWAP_ABI = [{
  anonymous: false,
  inputs: [
    { indexed: true,  name: 'sender',            type: 'address' },
    { indexed: true,  name: 'recipient',         type: 'address' },
    { indexed: false, name: 'amount0',           type: 'int256'  },
    { indexed: false, name: 'amount1',           type: 'int256'  },
    { indexed: false, name: 'sqrtPriceX96',      type: 'uint160' },
    { indexed: false, name: 'liquidity',         type: 'uint128' },
    { indexed: false, name: 'tick',              type: 'int24'   },
    { indexed: false, name: 'protocolFeesToken0', type: 'uint128' },
    { indexed: false, name: 'protocolFeesToken1', type: 'uint128' },
  ],
  name: 'Swap',
  type: 'event',
}] as const;
```

This was confirmed by reading the verified source of the deployed
`AlgebraPool` contract on mantlescan and cross-checking that
`getContractEvents` with this ABI returns real swaps (hundreds of events with
populated `amount0`/`amount1`/`recipient`).

**Rule of thumb:** if you ever see 0 events from a contract you know is
active, suspect an ABI/topic-hash mismatch before suspecting the RPC or block
range.

## 3. Reading pool metadata (`globalState`, `token0`/`token1`)

Agni's `globalState()` has the same 6-field shape as standard Algebra:

```ts
const ALGEBRA_POOL_ABI = [{
  inputs: [],
  name: 'globalState',
  outputs: [
    { name: 'price',              type: 'uint160' }, // sqrtPriceX96
    { name: 'tick',               type: 'int24'   },
    { name: 'fee',                type: 'uint16'  },
    { name: 'timepointIndex',     type: 'uint16'  },
    { name: 'communityFeeToken0', type: 'uint8'   },
    { name: 'communityFeeToken1', type: 'uint8'   },
  ],
  stateMutability: 'view',
  type: 'function',
}] as const;
```

`price` is `sqrtPriceX96` — the square root of the token1/token0 price,
Q64.96 fixed point. To get a human price:

```ts
const raw = Number(sqrtPriceX96) / 2 ** 96; // = sqrt(token1/token0), adjusted for decimals
const token1PerToken0 = raw * raw * 10 ** (token0Decimals - token1Decimals);
```

For our pool (token0=USDe 18dec, token1=WMNT 18dec, decimals cancel out):

```ts
const raw = Number(sqrtPriceX96) / 2 ** 96; // = WMNT per USDe
const wmntPerUsd = raw * raw;
const wmntUsd = 1 / wmntPerUsd; // USDe ≈ $1, so WMNT/USD = 1 / (WMNT per USDe)
```

This is `sqrtPriceX96ToWmntUsd()` in `watcher/src/price.ts` and the inline
calculation in `frontend/lib/price.ts`'s `getWmntPrice()`.

If you ever add a new pool, **always verify `token0()`/`token1()` on-chain**
before assuming an ordering — Algebra pools order tokens by address, not by
"which one is the base asset", so the same token pair can have opposite
ordering on different pools/chains.

## 4. Chunked log scanning (`eth_getLogs` 10,000-block cap)

Mantle's public RPC (`https://rpc.mantle.xyz`) enforces a hard cap of 10,000
blocks per `eth_getLogs`/`getContractEvents` call. Requesting a wider range
throws an RPC error.

`frontend/app/api/traders/route.ts`'s `scanTraders()` handles this by:

1. Computing a lookback window: `RANGE = 50_000n` blocks (~28 hours at
   Mantle's ~2s block time).
2. Walking that window in `CHUNK = 10_000n`-block slices, calling
   `getContractEvents` once per slice and accumulating results:

```ts
const CHUNK = 10_000n;
const RANGE = 50_000n;
const latest = await client.getBlockNumber();
const fromBlock = latest > RANGE ? latest - RANGE : 0n;

for (let start = fromBlock; start < latest; start += CHUNK) {
  const end = start + CHUNK - 1n < latest ? start + CHUNK - 1n : latest;
  const logs = await client.getContractEvents({
    address: POOL, abi: SWAP_ABI, eventName: 'Swap',
    fromBlock: start, toBlock: end,
  });
  // ... accumulate
}
```

`watcher/src/watcher.ts` uses the same chunking pattern for its 12-second
polling loop, but in practice each poll only spans a handful of blocks
(12s / ~2s per block ≈ 6 blocks), so the chunk loop there mostly runs once —
it exists as a safety net for startup gaps or RPC hiccups.

## 5. Classifying BUY/SELL, volume, and net flow

For each `Swap` event:

- `amount0` is the pool's **USDe** balance change. `amount0 < 0` means the
  pool sent USDe **out** to the recipient — i.e. the recipient **bought
  USDe** (sold WMNT). `amount0 > 0` means the recipient sold USDe (bought
  WMNT).
- `amount1` is the pool's **WMNT** balance change, with the opposite sign
  convention relative to the recipient.

```ts
const isBuy = amount0 < 0n; // recipient bought USDe (the "side" used for buy/sell counts)
const usdeValue = Math.abs(Number(formatUnits(amount0, 18))); // USD value of this swap
```

Per-trader running totals (`buys`, `sells`, `volumeUsde`) are accumulated
across all swaps in the lookback window, keyed by `recipient.toLowerCase()`.

For P&L, we also track each trader's **net flow** of each token — i.e. how
much USDe and WMNT they've accumulated or given up over the window. Since
`amount0`/`amount1` are the *pool's* balance changes, the recipient's balance
change is the negation:

```ts
netUsde -= amount0; // recipient's running USDe balance change
netWmnt -= amount1; // recipient's running WMNT balance change
```

## 6. P&L computation

USDe is treated as exactly $1 (it's a stablecoin peg — close enough for
ranking purposes). WMNT's value is fetched live from CoinGecko:

```ts
const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=mantle&vs_currencies=usd');
const mntUsd = (await res.json())?.mantle?.usd ?? 0;
```

A trader's P&L over the lookback window is then:

```ts
const netUsdeNum = Number(formatUnits(netUsde, 18));
const netWmntNum = Number(formatUnits(netWmnt, 18));
const pnlUsd = netUsdeNum + netWmntNum * mntUsd;
```

Intuitively: "how much would this trader's net position changes be worth in
USD today, valuing the USDe leg at $1 and the WMNT leg at the current market
price."

### Limitations

- **Window-bounded**: only swaps within the `RANGE` (50,000 blocks / ~28h)
  lookback are counted. A trader's true all-time P&L is not computed —
  this is a rolling "recent activity" P&L, useful for ranking but not for
  tax/accounting purposes.
- **No cost-basis tracking**: this is a net-flow valuation, not a
  FIFO/LIFO realized-P&L calculation. A trader who bought WMNT at $0.50 and
  it's now $0.60 shows a P&L gain even though they haven't sold — this is
  intentional (it approximates "mark-to-market" for the ranking), but it
  means the number can swing with the live WMNT price even if the trader
  hasn't traded recently.
- **Single pool**: only activity on the USDe/WMNT Agni pool is counted. A
  trader who is highly active on other Mantle DEXs or pools won't show up
  here at all.
- **CoinGecko dependency**: if the CoinGecko request fails, `mntUsd` falls
  back to `0`, which makes the WMNT leg of P&L collapse to `0` (only the
  USDe leg contributes). This degrades gracefully rather than erroring.

## 7. How this feeds the app

### `/api/traders` (`frontend/app/api/traders/route.ts`)

1. Checks an Upstash Redis cache (`stellalpha:traders:v2`, 10-minute TTL) —
   on-chain scans are relatively expensive (5 chunked RPC calls + a CoinGecko
   call), so results are cached.
2. On a cache miss, runs `scanTraders()` as described above and caches the
   result.
3. Enriches each on-chain trader with DB-derived stats via Prisma:
   - `follow.groupBy` → follower count (how many users are copying this
     leader)
   - `paperTrade.groupBy` (status `CLOSED`) → copy-trade count and total P&L
     *generated for followers* (distinct from the on-chain `pnlUsd` computed
     in step 2, which is the *leader's own* trading P&L)
4. Returns a flat JSON array — `address`, `buys`, `sells`, `totalTrades`,
   `volumeUsde`, `pnlUsd`, `followerCount`, `copyTradeCount`, `totalPnl`.

This endpoint is not currently called by any frontend page directly — the
traders/discover page (`app/(app)/traders/page.tsx`) instead uses
`/api/traders/leaderboard`, which ranks traders by **DB-recorded**
`LeaderSwap` rows (written by the watcher's `recordLeaderSwap`, see below)
rather than scanning on-chain logs on each request. `/api/traders` remains
useful as a standalone on-chain view and as a reference implementation of the
scan logic.

### Watcher (`watcher/src/watcher.ts`, `src/parser.ts`, `src/price.ts`)

The watcher runs the same pool-scanning logic continuously (12s HTTP poll,
chunked `getContractEvents`) so that every swap on the USDe/WMNT pool is:

1. Parsed by `parseSwapLog()` into a `TradeIntent` (`side`, `tokenIn`,
   `tokenOut`, `usdValue`, `wmntPrice`).
2. Recorded as a `LeaderSwap` row in the DB (`db.recordLeaderSwap`) —
   this is what `/api/traders/leaderboard` reads from.
3. If the swap's `recipient` is a leader someone is following, the
   copy-trading pipeline (`copy-engine.ts`, `keeper.ts`) is triggered to
   open/close positions on the follower's behalf via `VaultManager` on
   Mantle Sepolia (chain id `5003`).

## 8. Key files reference

| File | Role |
|---|---|
| `frontend/app/api/traders/route.ts` | On-chain scan + P&L, reference implementation |
| `frontend/app/api/traders/leaderboard/route.ts` | DB-backed leaderboard (used by the UI) |
| `frontend/lib/price.ts` | `getWmntPrice()` — live WMNT/USD for the frontend |
| `frontend/config/tokens.ts` | Canonical Mantle Mainnet token addresses (USDe, WMNT, USDC, USDT) |
| `watcher/src/config.ts` | Chain defs (`mantleMainnet`, `mantleSepolia`), `POOLS`, `TOKENS` |
| `watcher/src/price.ts` | `ALGEBRA_SWAP_ABI` (verified 9-field), `getCurrentWmntPrice()` |
| `watcher/src/parser.ts` | `parseSwapLog()` — turns a raw `Swap` log into a `TradeIntent` |
| `watcher/src/watcher.ts` | Polling loop, dedup, copy-trade dispatch |
