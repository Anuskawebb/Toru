import { getTokenPair } from '../cache/pair-cache.js';
import { logger } from '../logger.js';
import type { EventParser } from './index.js';
import type { RawEvent, RawSwap, DecodedV2Swap, ParseContext } from '../types/index.js';

// ── Event signature ───────────────────────────────────────────────────────────
//
// Swap(address indexed sender, uint256 amount0In, uint256 amount1In,
//      uint256 amount0Out, uint256 amount1Out, address indexed to)
//
// keccak256("Swap(address,uint256,uint256,uint256,uint256,address)")
// = 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822

const SWAP_TOPIC =
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822' as const;

const EXPECTED_DATA_LENGTH = 258; // "0x" + 4 × 64 hex chars
const EXPECTED_TOPIC_COUNT = 3;   // [sig, sender, to]

// ── Detection ─────────────────────────────────────────────────────────────────

export function isPancakeSwapV2Swap(event: RawEvent): boolean {
  return (
    event.topics[0] === SWAP_TOPIC &&
    event.topics.length === EXPECTED_TOPIC_COUNT &&
    event.data.length === EXPECTED_DATA_LENGTH
  );
}

// ── Decoding ──────────────────────────────────────────────────────────────────

function decodeSwap(event: RawEvent): DecodedV2Swap {
  const hex = event.data.slice(2);

  const amount0In  = BigInt('0x' + hex.slice(0,   64));
  const amount1In  = BigInt('0x' + hex.slice(64,  128));
  const amount0Out = BigInt('0x' + hex.slice(128, 192));
  const amount1Out = BigInt('0x' + hex.slice(192, 256));

  const senderTopic = event.topics[1];
  const toTopic     = event.topics[2];

  if (senderTopic === undefined || toTopic === undefined) {
    throw new Error(`V2 Swap: missing indexed topics in tx ${event.txHash}`);
  }

  const sender = `0x${senderTopic.slice(26)}` as `0x${string}`;
  const to     = `0x${toTopic.slice(26)}`     as `0x${string}`;

  return { sender, to, amount0In, amount1In, amount0Out, amount1Out };
}

// ── Parser implementation ─────────────────────────────────────────────────────

export const pancakeswapV2Parser: EventParser = {
  name: 'pancakeswap-v2',

  canParse: isPancakeSwapV2Swap,

  async parse(event: RawEvent, context: ParseContext): Promise<RawSwap | null> {
    let decoded: DecodedV2Swap;
    try {
      decoded = decodeSwap(event);
    } catch (err) {
      logger.warn('V2 decode failed', {
        txHash: event.txHash,
        error:  err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    let token0: `0x${string}`;
    let token1: `0x${string}`;
    try {
      ({ token0, token1 } = await getTokenPair(event.contractAddress));
    } catch (err) {
      logger.warn('V2 pair lookup failed', {
        pair:  event.contractAddress,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    // Convert unsigned V2 in/out amounts to unified swapper perspective:
    //   positive = user received (amountOut leg)
    //   negative = user sent (amountIn leg)
    const amount0 = decoded.amount0Out - decoded.amount0In;
    const amount1 = decoded.amount1Out - decoded.amount1In;

    return {
      txHash:           event.txHash,
      blockNumber:      event.blockNumber,
      blockTimestampMs: context.blockTimestampMs,
      wallet:           event.wallet,
      contractAddress:  event.contractAddress,
      dex:              'pancakeswap-v2',
      amount0,
      amount1,
      token0,
      token1,
      siblingEvents:    context.siblingEvents,
    };
  },
};
