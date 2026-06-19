import { keccak256 } from 'viem';
import { getTokenPair } from '../cache/pair-cache.js';
import { getPoolFactory } from '../cache/factory-cache.js';
import { logger } from '../logger.js';
import type { EventParser } from './index.js';
import type { RawEvent, RawSwap, ParseContext, Dex } from '../types/index.js';

// ── Event signature ───────────────────────────────────────────────────────────
//
// Uniswap V3 is concentrated liquidity. The Swap event is identical to Algebra:
//
//   event Swap(
//     address indexed sender,
//     address indexed recipient,
//     int256  amount0,      // POOL perspective: +ve = into pool (user sold token0)
//     int256  amount1,      // POOL perspective: +ve = into pool (user sold token1)
//     uint160 sqrtPriceX96,
//     uint128 liquidity,
//     int24   tick
//   )
//
// topics: [sig, sender, recipient]   → length 3
// data:   5 × 32-byte ABI slots      → 320 hex chars + "0x" = 322 chars

const V3_SWAP_SIG = 'Swap(address,address,int256,int256,uint160,uint128,int24)';

export const V3_SWAP_TOPIC = keccak256(
  new TextEncoder().encode(V3_SWAP_SIG),
) as `0x${string}`;

const EXPECTED_TOPIC_COUNT = 3;  // [sig, sender(indexed), recipient(indexed)]
const EXPECTED_DATA_LENGTH = 322; // "0x" + 5 × 64 hex chars

// ── Strongly typed V3 decoded swap ────────────────────────────────────────────

export interface DecodedV3Swap {
  sender:       `0x${string}`;
  recipient:    `0x${string}`;
  poolAmount0:  bigint; // pool perspective (positive = into pool)
  poolAmount1:  bigint;
  sqrtPriceX96: bigint;
  liquidity:    bigint;
  tick:         number;
}

// ── Detection ─────────────────────────────────────────────────────────────────

export function isV3Swap(event: RawEvent): boolean {
  return (
    event.topics[0] === V3_SWAP_TOPIC &&
    event.topics.length === EXPECTED_TOPIC_COUNT &&
    event.data.length === EXPECTED_DATA_LENGTH
  );
}

// ── Decoding ──────────────────────────────────────────────────────────────────

function decodeInt256(hex: string): bigint {
  const raw = BigInt('0x' + hex);
  return raw >= 2n ** 255n ? raw - 2n ** 256n : raw;
}

function requireSlot(slots: readonly string[], i: number, field: string): string {
  const s = slots[i];
  if (s === undefined) throw new Error(`V3 Swap: missing ABI slot ${i} (${field})`);
  return s;
}

export function decodeV3Swap(event: RawEvent): DecodedV3Swap {
  const senderTopic    = event.topics[1];
  const recipientTopic = event.topics[2];

  if (senderTopic === undefined || recipientTopic === undefined) {
    throw new Error(`V3 Swap: missing indexed topics in tx ${event.txHash}`);
  }

  const hex   = event.data.slice(2);
  const slots = Array.from({ length: 5 }, (_, i) => hex.slice(i * 64, i * 64 + 64));

  return {
    sender:       `0x${senderTopic.slice(26)}`    as `0x${string}`,
    recipient:    `0x${recipientTopic.slice(26)}`  as `0x${string}`,
    poolAmount0:  decodeInt256(requireSlot(slots, 0, 'amount0')),
    poolAmount1:  decodeInt256(requireSlot(slots, 1, 'amount1')),
    sqrtPriceX96: BigInt('0x' + requireSlot(slots, 2, 'sqrtPriceX96')),
    liquidity:    BigInt('0x' + requireSlot(slots, 3, 'liquidity')),
    tick:         Number(decodeInt256(requireSlot(slots, 4, 'tick'))),
  };
}

// ── Factory function ──────────────────────────────────────────────────────────

interface V3StyleConfig {
  dex: Dex;
  factories: readonly string[];
}

export function createV3StyleParser(config: V3StyleConfig): EventParser {
  const allowedFactories = new Set(config.factories.map((addr) => addr.toLowerCase()));

  return {
    name: config.dex,

    canParse: isV3Swap,

    async parse(event: RawEvent, context: ParseContext): Promise<RawSwap | null> {
      // 1. Verify pool factory matches
      try {
        const factory = await getPoolFactory(event.contractAddress);
        if (!allowedFactories.has(factory)) {
          return null; // fallthrough to next registered parser
        }
      } catch (err) {
        logger.debug('V3 style factory check failed/reverted', {
          pool:  event.contractAddress,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }

      // 2. Decode swap event data
      let decoded: DecodedV3Swap;
      try {
        decoded = decodeV3Swap(event);
      } catch (err) {
        logger.warn('V3 style decode failed', {
          txHash: event.txHash,
          error:  err instanceof Error ? err.message : String(err),
        });
        return null;
      }

      // 3. Resolve pool tokens
      let token0: `0x${string}`;
      let token1: `0x${string}`;
      try {
        ({ token0, token1 } = await getTokenPair(event.contractAddress));
      } catch (err) {
        logger.warn('V3 style pool lookup failed', {
          pool:  event.contractAddress,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }

      // Negate pool-perspective amounts → swapper perspective (same as V4 convention)
      const amount0 = -decoded.poolAmount0;
      const amount1 = -decoded.poolAmount1;

      logger.debug('V3 style swap decoded', {
        txHash:       event.txHash,
        pool:         event.contractAddress,
        poolAmount0:  decoded.poolAmount0.toString(),
        poolAmount1:  decoded.poolAmount1.toString(),
        tick:         decoded.tick,
        token0,
        token1,
      });

      return {
        txHash:           event.txHash,
        blockNumber:      event.blockNumber,
        logIndex:         event.logIndex,
        blockTimestampMs: context.blockTimestampMs,
        wallet:           event.wallet,
        contractAddress:  event.contractAddress,
        dex:              config.dex,
        amount0,
        amount1,
        token0,
        token1,
        siblingEvents:    context.siblingEvents,
      };
    },
  };
}
