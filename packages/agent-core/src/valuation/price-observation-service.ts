import { db, priceObservations, tokenPrices, eq } from '@aether/db';

export const BSC_STABLES = new Set([
  '0x55d398326f99059ff775485246999027b3197955', // USDT
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
  '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
  '0xc5f0f7b031485c54a5441364ff8964d30e3271df'  // FDUSD
]);

export const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
export const DEFAULT_WBNB_PRICE = 600.0; // Fail-safe default price for WBNB in USD

export interface SwapInput {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;   // raw BigInt as string
  amountOut: string;  // raw BigInt as string
  tokenInDecimals: number;
  tokenOutDecimals: number;
  pairAddress?: string; // source pool address
  observedAt?: Date;
}

export class PriceObservationService {
  /**
   * Tracks the latest WBNB price in memory to avoid redundant DB reads on every swap.
   */
  private static cachedWbnbPrice: number | null = null;

  /**
   * Processes a raw swap event, computes USD spot price/volume,
   * identifies the route type, and inserts an observation log.
   */
  public static async recordObservation(input: SwapInput): Promise<void> {
    const tokenIn = input.tokenIn.toLowerCase();
    const tokenOut = input.tokenOut.toLowerCase();
    const observedAt = input.observedAt ?? new Date();

    const isStableIn = BSC_STABLES.has(tokenIn);
    const isStableOut = BSC_STABLES.has(tokenOut);

    const isWbnbIn = tokenIn === WBNB_ADDRESS;
    const isWbnbOut = tokenOut === WBNB_ADDRESS;

    let targetTokenAddress: string | null = null;
    let priceUsd = 0.0;
    let volumeUsd = 0.0;

    // ── Scenario A: Stablecoin Swaps (Direct Price Feeds) ────────────────────
    if (isStableIn || isStableOut) {
      if (isStableOut && !isStableIn) {
        // Token In -> Stablecoin Out (selling token)
        targetTokenAddress = tokenIn;
        const normalizedIn = parseFloat(input.amountIn) / Math.pow(10, input.tokenInDecimals);
        const normalizedOut = parseFloat(input.amountOut) / Math.pow(10, input.tokenOutDecimals);

        if (normalizedIn > 0) {
          priceUsd = normalizedOut / normalizedIn;
          volumeUsd = normalizedOut;
        }
      } else if (isStableIn && !isStableOut) {
        // Stablecoin In -> Token Out (buying token)
        targetTokenAddress = tokenOut;
        const normalizedIn = parseFloat(input.amountIn) / Math.pow(10, input.tokenInDecimals);
        const normalizedOut = parseFloat(input.amountOut) / Math.pow(10, input.tokenOutDecimals);

        if (normalizedOut > 0) {
          priceUsd = normalizedIn / normalizedOut;
          volumeUsd = normalizedIn;
        }
      }

      // If the stablecoin swap updated WBNB directly, cache the WBNB price
      if (targetTokenAddress === WBNB_ADDRESS && priceUsd > 0) {
        this.cachedWbnbPrice = priceUsd;
      }
    }
    // ── Scenario B: WBNB Route Swaps (Multi-Hop Price Feeds) ──────────────────
    else if (isWbnbIn || isWbnbOut) {
      const wbnbPrice = await this.resolveWbnbPrice();

      if (isWbnbOut && !isWbnbIn) {
        // Token In -> WBNB Out
        targetTokenAddress = tokenIn;
        const normalizedIn = parseFloat(input.amountIn) / Math.pow(10, input.tokenInDecimals);
        const normalizedOut = parseFloat(input.amountOut) / Math.pow(10, input.tokenOutDecimals);

        if (normalizedIn > 0) {
          const priceInWbnb = normalizedOut / normalizedIn;
          priceUsd = priceInWbnb * wbnbPrice;
          volumeUsd = normalizedOut * wbnbPrice;
        }
      } else if (isWbnbIn && !isWbnbOut) {
        // WBNB In -> Token Out
        targetTokenAddress = tokenOut;
        const normalizedIn = parseFloat(input.amountIn) / Math.pow(10, input.tokenInDecimals);
        const normalizedOut = parseFloat(input.amountOut) / Math.pow(10, input.tokenOutDecimals);

        if (normalizedOut > 0) {
          const wbnbVolume = normalizedIn;
          volumeUsd = wbnbVolume * wbnbPrice;
          priceUsd = volumeUsd / normalizedOut;
        }
      }
    }

    // Write the observation to database if resolved
    if (targetTokenAddress && priceUsd > 0 && volumeUsd > 0) {
      const sourcePoolAddress = input.pairAddress?.toLowerCase() || null;

      await db.insert(priceObservations).values({
        tokenAddress: targetTokenAddress,
        sourcePoolAddress,
        priceUsd,
        volumeUsd,
        source: 'DEX_SWAP',
        observedAt
      });
    }
  }

  /**
   * Resolves the latest WBNB spot price from cache or database lookup.
   */
  public static async resolveWbnbPrice(): Promise<number> {
    if (this.cachedWbnbPrice !== null) {
      return this.cachedWbnbPrice;
    }

    try {
      const row = await db
        .select()
        .from(tokenPrices)
        .where(eq(tokenPrices.tokenAddress, WBNB_ADDRESS))
        .limit(1);

      if (row[0]) {
        this.cachedWbnbPrice = row[0].priceUsd;
        return row[0].priceUsd;
      }
    } catch {
      // ignore read errors on unbootstrapped table
    }

    return DEFAULT_WBNB_PRICE;
  }

  /**
   * Explicitly updates the cached WBNB price (useful for tests and initialization).
   */
  public static setCachedWbnbPrice(price: number): void {
    this.cachedWbnbPrice = price;
  }
}
