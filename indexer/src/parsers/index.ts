import type { RawEvent, RawSwap, ParseContext } from '../types/index.js';

/**
 * Protocol-specific event parser.
 *
 * Parsers are responsible for:
 *   1. Detecting their protocol's Swap event (canParse)
 *   2. Decoding raw log bytes into a RawSwap (parse)
 *
 * Parsers do NOT produce NormalizedTrade. TradeReconstructor does that from
 * the RawSwap, so all direction/token-derivation logic lives in one place.
 */
export interface EventParser {
  readonly name: string;

  /**
   * Fast synchronous check — topic[0] comparison is enough.
   * Called for every log in every block; keep it O(1).
   */
  canParse(event: RawEvent): boolean;

  /**
   * Decode the event into a RawSwap.
   * May involve async RPC calls (e.g. fetching token pair metadata).
   * Return null for malformed events or edge cases to skip (flash swaps, etc.).
   */
  parse(event: RawEvent, context: ParseContext): Promise<RawSwap | null>;
}
