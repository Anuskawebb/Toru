# 04 — Event Extraction

## Overview

Event extraction is the step that converts raw transaction receipts into
protocol-neutral `RawEvent` objects. It is a deliberate separation point:
everything before this is network/block infrastructure; everything after is
protocol-specific parsing.

The entire module is one function in one file:

```ts
// src/extractors/events.ts
export function extractEvents(receipt: Receipt): RawEvent[]
```

---

## `RawEvent` — The Canonical Log Shape

```ts
// src/types/index.ts
interface RawEvent {
  txHash:          `0x${string}`;
  blockNumber:     bigint;
  logIndex:        number;
  contractAddress: `0x${string}`;   // the contract that emitted the log
  topics:          readonly `0x${string}`[];
  data:            `0x${string}`;   // ABI-encoded non-indexed parameters
  wallet:          `0x${string}`;   // always receipt.from (the EOA)
}
```

Every event type (Swap, Transfer, Approval, etc.) in every receipt is
converted to this shape. The protocol-specific parsers then inspect
`topics[0]` to decide whether to handle the event.

---

## Extraction Logic

```ts
export function extractEvents(receipt: Receipt): RawEvent[] {
  if (receipt.status === 'reverted') return [];
  if (receipt.logs.length === 0) return [];

  return receipt.logs.map((log, i): RawEvent => ({
    txHash:          receipt.transactionHash,
    blockNumber:     receipt.blockNumber,
    logIndex:        log.logIndex ?? i,
    contractAddress: log.address,
    topics:          log.topics,
    data:            log.data,
    wallet:          receipt.from,
  }));
}
```

### Reverted Transactions

`receipt.status === 'reverted'` returns an empty array immediately. Reverted
transactions have no state changes and no meaningful logs — any Swap event
in a reverted tx did not execute.

### Log Index

`log.logIndex ?? i` — viem types `logIndex` as `number | null`. Some BSC
archive nodes return `null` for log index. The fallback uses the map index
`i` (position of the log within this receipt's log array). This is a local
position, not a block-global position — it remains consistent for ordering
within the same receipt but cannot be compared across different transactions.

### Wallet Attribution

`wallet: receipt.from` — this is the EOA that signed the transaction.
It is set once in `extractEvents` and never modified downstream. All
`NormalizedTrade` records inherit this value as the trader's identity.

**Why `receipt.from` and not `topics[1]`/`topics[2]` (the Swap event's
`sender` field)?**

The Swap event `sender` is typically the router contract, not the user.
For example, in a V2 swap: `sender = 0x10ed43c71871...` (PancakeSwap V2 Router).
The EOA is always `receipt.from` regardless of how many contract hops the
call chain traverses. See `09-known-edge-cases.md` for aggregator cases where
even `receipt.from` requires scrutiny.

---

## What Events Are Extracted

**All events from every non-reverted receipt** are extracted. This is intentional:

- The parsers' `canParse()` function is a fast topic0 comparison — the cost
  of checking every log is negligible.
- V4 trade reconstruction needs ERC-20 Transfer events from the same receipt
  to identify which tokens moved. Those Transfer events are not Swap events
  and would be discarded if only Swap-like events were extracted.

The result is that `extractEvents` returns a mixed array that may include
Swap events, Transfer events, Approval events, and any other events in the
receipt. The caller (`BlockProcessor`) partitions this:

```ts
// Build per-tx sibling map for V4 token derivation
const eventsByTx = new Map<string, RawEvent[]>();
for (const event of allEvents) {
  let list = eventsByTx.get(event.txHash);
  if (list === undefined) { list = []; eventsByTx.set(event.txHash, list); }
  list.push(event);
}

// Filter to parseable events only
const parseable = allEvents.filter((ev) => this.registry.canParse(ev));
```

Parsers receive only the events they can parse. However, each `RawSwap`
(output of a parser) carries the full `siblingEvents` array for its
transaction — the complete receipt log list. This is how the V4 reconstructor
can read ERC-20 Transfer events without a separate log-fetch RPC call.

---

## Event Types Encountered in Practice

| Event | Topic0 | Purpose in pipeline |
|---|---|---|
| V2 Swap | `0xd78ad9…` | Parsed by `pancakeswap-v2.ts` |
| V3 Swap | `keccak256(V3_SIG)` | Parsed by `pancakeswap-v3.ts` |
| V4 Swap | `keccak256(V4_SIG)` | Parsed by `pancakeswap-v4.ts` |
| ERC-20 Transfer | `0xddf252ad…` | Read by `trade-reconstructor.ts` (V4 token derivation) |
| ERC-20 Approval | — | Extracted, ignored |
| Sync (V2 reserve update) | — | Extracted, ignored |
| Mint/Burn (LP events) | — | Extracted, ignored |
| Any other event | — | Extracted, ignored |

The ERC-20 Transfer topic is hardcoded in `trade-reconstructor.ts`:

```ts
const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
```

This is `keccak256("Transfer(address,address,uint256)")` — stable and canonical.

---

## `ParseContext` — What Parsers Receive

```ts
// src/types/index.ts
interface ParseContext {
  blockTimestampMs: number;
  siblingEvents: RawEvent[];
}
```

`blockTimestampMs` is the block's Unix timestamp in milliseconds (derived
from `block.timestamp * 1000` in `normalise()`).

`siblingEvents` is the full `RawEvent[]` for the transaction that emitted
this event — all logs from the same receipt, not filtered. This gives parsers
and the reconstructor full access to Transfer events, other Swap events in
the same multi-hop tx, etc.
