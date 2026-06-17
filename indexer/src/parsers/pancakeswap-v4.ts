import { keccak256 } from 'viem';
import { logger } from '../logger.js';
import type { EventParser } from './index.js';
import type { RawEvent, RawSwap, DecodedV4Swap, ParseContext } from '../types/index.js';

// ── Event signature ───────────────────────────────────────────────────────────
//
// PancakeSwap V4 Swap event:
//
//   event Swap(
//     bytes32 indexed id,        // PoolId = keccak256(abi.encode(PoolKey))
//     address indexed sender,    // router / hook (NOT the EOA wallet)
//     int128  amount0,           // SWAPPER perspective: +ve = received, -ve = sent
//     int128  amount1,           // SWAPPER perspective: +ve = received, -ve = sent
//     uint160 sqrtPriceX96,
//     uint128 liquidity,
//     int24   tick,
//     uint24  fee,               // e.g. 800 = 0.08%
//     uint16  protocolFee
//   )
//
// Sign convention verified against real BSC tx 0xa8cee3d12... (2026-06-17):
//   amount0 > 0 → swapper received currency0
//   amount0 < 0 → swapper sent currency0
//
// topics: [sig, poolId, sender]   → length 3
// data:   7 × 32-byte ABI slots   → 448 hex chars + "0x" = 450 chars
//
// Known BSC addresses:
//   PoolManager: 0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b
//   Router:      0x40a1fe393a7f566f27df6ace18e6773be844dafc

const V4_SWAP_SIG =
  'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24,uint16)';

export const V4_SWAP_TOPIC = keccak256(
  new TextEncoder().encode(V4_SWAP_SIG),
) as `0x${string}`;

const EXPECTED_TOPIC_COUNT = 3;
const EXPECTED_DATA_LENGTH = 450; // "0x" + 7 × 64 hex chars

// ── Detection ─────────────────────────────────────────────────────────────────

export function isPancakeSwapV4Swap(event: RawEvent): boolean {
  return (
    event.topics[0] === V4_SWAP_TOPIC &&
    event.topics.length === EXPECTED_TOPIC_COUNT &&
    event.data.length === EXPECTED_DATA_LENGTH
  );
}

// ── Decoding ──────────────────────────────────────────────────────────────────

function requireSlot(slots: readonly string[], i: number, field: string): string {
  const s = slots[i];
  if (s === undefined) throw new Error(`V4 Swap: missing ABI slot ${i} (${field})`);
  return s;
}

function decodeInt256(hex: string): bigint {
  const raw = BigInt('0x' + hex);
  return raw >= 2n ** 255n ? raw - 2n ** 256n : raw;
}

function decodeUint256(hex: string): bigint {
  return BigInt('0x' + hex);
}

export function decodeV4Swap(event: RawEvent): DecodedV4Swap {
  const poolIdTopic = event.topics[1];
  const senderTopic = event.topics[2];

  if (poolIdTopic === undefined || senderTopic === undefined) {
    throw new Error(`V4 Swap: missing indexed topics in tx ${event.txHash}`);
  }

  const hex   = event.data.slice(2);
  const slots = Array.from({ length: 7 }, (_, i) => hex.slice(i * 64, i * 64 + 64));

  return {
    poolId:       poolIdTopic,
    sender:       `0x${senderTopic.slice(26)}` as `0x${string}`,
    amount0:      decodeInt256(requireSlot(slots, 0, 'amount0')),
    amount1:      decodeInt256(requireSlot(slots, 1, 'amount1')),
    sqrtPriceX96: decodeUint256(requireSlot(slots, 2, 'sqrtPriceX96')),
    liquidity:    decodeUint256(requireSlot(slots, 3, 'liquidity')),
    tick:         Number(decodeInt256(requireSlot(slots, 4, 'tick'))),
    fee:          Number(decodeUint256(requireSlot(slots, 5, 'fee'))),
    protocolFee:  Number(decodeUint256(requireSlot(slots, 6, 'protocolFee'))),
  };
}

// ── Parser implementation ─────────────────────────────────────────────────────
//
// V4 amounts are already in swapper perspective — no conversion needed.
// Token identity (token0/token1) cannot be derived from the PoolId hash, so we
// leave those fields absent. TradeReconstructor will use ERC-20 Transfer events
// in siblingEvents to identify which tokens moved.

export const pancakeswapV4Parser: EventParser = {
  name: 'pancakeswap-v4',

  canParse: isPancakeSwapV4Swap,

  async parse(event: RawEvent, context: ParseContext): Promise<RawSwap | null> {
    let decoded: DecodedV4Swap;
    try {
      decoded = decodeV4Swap(event);
    } catch (err) {
      logger.warn('V4 decode failed', {
        txHash: event.txHash,
        error:  err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    logger.debug('V4 swap decoded', {
      txHash:  event.txHash,
      poolId:  decoded.poolId,
      amount0: decoded.amount0.toString(),
      amount1: decoded.amount1.toString(),
      tick:    decoded.tick,
      fee:     decoded.fee,
    });

    return {
      txHash:           event.txHash,
      blockNumber:      event.blockNumber,
      blockTimestampMs: context.blockTimestampMs,
      wallet:           event.wallet,
      contractAddress:  event.contractAddress,
      dex:              'pancakeswap-v4',
      amount0:          decoded.amount0, // swapper perspective — no conversion
      amount1:          decoded.amount1,
      // token0/token1 absent — TradeReconstructor uses siblingEvents
      siblingEvents:    context.siblingEvents,
    };
  },
};
