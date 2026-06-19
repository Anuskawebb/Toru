import { type WalletPosition } from '@aether/db';
import { PriceState, type PriceBundle } from '../valuation/price-types.js';
import { type PortfolioValuation, type PositionValuation } from './portfolio-types.js';

/**
 * PortfolioValuationEngine — pure computation, zero I/O.
 *
 * Takes a snapshot of wallet positions and a pre-fetched price map,
 * returns a full PortfolioValuation. All decisions are deterministic.
 *
 * Responsibilities:
 *   - BigInt → human amount conversion (avoids float precision loss)
 *   - Stablecoin vs token classification
 *   - MTM valuation per position
 *   - UNRESOLVABLE / MANIPULATED position handling
 *   - Value-weighted average confidence (valuationConfidence)
 *
 * NOT responsible for:
 *   - Drawdown (requires persisted peak)
 *   - Rolling daily loss (requires historical snapshots)
 *   - DB reads or writes
 */
export class PortfolioValuationEngine {
  /**
   * Computes a full portfolio valuation from positions and a price map.
   *
   * @param agentWallet    Lowercase agent wallet address
   * @param positions      All wallet_positions rows for the agent wallet
   * @param priceMap       Map<tokenAddress, PriceBundle> — pre-fetched by caller
   * @param stablecoins    Set of lowercase stablecoin addresses
   * @param valuedAt       Snapshot timestamp (defaults to now)
   */
  public static compute(
    agentWallet: string,
    positions: WalletPosition[],
    priceMap: Map<string, PriceBundle>,
    stablecoins: Set<string>,
    valuedAt: Date = new Date()
  ): PortfolioValuation {
    const positionValuations: PositionValuation[] = [];

    let portfolioUsd = 0;
    let stablecoinUsd = 0;
    let tokenExposureUsd = 0;
    let openPositions = 0;
    let unpricedPositions = 0;
    let pricedPositionsCount = 0;

    // Weighted average confidence accumulators
    let confidenceWeightedSum = 0;
    let confidenceWeightTotal = 0;

    for (const pos of positions) {
      const addr = pos.tokenAddress.toLowerCase();
      const isStablecoin = stablecoins.has(addr);

      // Parse net amount using BigInt to preserve precision, then convert to human
      const rawNet = BigInt(pos.netAmount);
      if (rawNet <= 0n) {
        // Zero or negative net — closed position, skip
        continue;
      }

      const humanAmount = Number(rawNet) / Math.pow(10, pos.tokenDecimals);
      if (humanAmount <= 0) continue;

      // Stablecoins are always valued at $1.00 with perfect confidence
      if (isStablecoin) {
        const markToMarketUsd = humanAmount * 1.0;
        positionValuations.push({
          tokenAddress:    addr,
          tokenSymbol:     pos.tokenSymbol,
          humanAmount,
          priceUsd:        1.0,
          markToMarketUsd,
          priceState:      PriceState.FRESH,
          priceConfidence: 100,
          isStablecoin:    true,
        });
        stablecoinUsd += markToMarketUsd;
        portfolioUsd  += markToMarketUsd;

        // Stablecoins contribute full confidence
        confidenceWeightedSum += 100 * markToMarketUsd;
        confidenceWeightTotal += markToMarketUsd;
        pricedPositionsCount++;
        continue;
      }

      // Non-stablecoin token — requires PriceService data
      openPositions++;

      const bundle = priceMap.get(addr);
      if (!bundle || bundle.priceState === PriceState.UNRESOLVABLE) {
        // Cannot price this position — exclude from MTM, count as unpriced
        unpricedPositions++;
        positionValuations.push({
          tokenAddress:    addr,
          tokenSymbol:     pos.tokenSymbol,
          humanAmount,
          priceUsd:        0,
          markToMarketUsd: 0,
          priceState:      bundle?.priceState ?? PriceState.UNRESOLVABLE,
          priceConfidence: 0,
          isStablecoin:    false,
        });
        continue;
      }

      // FRESH, STALE, or MANIPULATED — use the stored price (no clamping per 6B.1 design)
      const priceUsd = bundle.priceUsd;
      const markToMarketUsd = humanAmount * priceUsd;

      positionValuations.push({
        tokenAddress:    addr,
        tokenSymbol:     pos.tokenSymbol,
        humanAmount,
        priceUsd,
        markToMarketUsd,
        priceState:      bundle.priceState,
        priceConfidence: bundle.priceConfidence,
        isStablecoin:    false,
      });

      tokenExposureUsd += markToMarketUsd;
      portfolioUsd     += markToMarketUsd;

      // Weight this position's confidence by its USD value
      confidenceWeightedSum += bundle.priceConfidence * markToMarketUsd;
      confidenceWeightTotal += markToMarketUsd;
      pricedPositionsCount++;
    }

    // Value-weighted average confidence (0–100)
    // If all positions are unpriced, confidence is 0
    // If there are unpriced positions, estimate a proxy unpriced value
    // based on the average value of the priced positions.
    let valuationConfidence = 0;
    if (confidenceWeightTotal > 0) {
      const confidenceOfPriced = confidenceWeightedSum / confidenceWeightTotal;
      if (unpricedPositions > 0) {
        const averagePricedPositionValue = confidenceWeightTotal / pricedPositionsCount;
        const unpricedValue = unpricedPositions * averagePricedPositionValue;
        const totalWeight = confidenceWeightTotal + unpricedValue;
        valuationConfidence = Math.round(((confidenceOfPriced * confidenceWeightTotal) / totalWeight) * 100) / 100;
      } else {
        valuationConfidence = Math.round(confidenceOfPriced * 100) / 100;
      }
    }

    return {
      agentWallet:     agentWallet.toLowerCase(),
      valuedAt,
      portfolioUsd:    Math.round(portfolioUsd * 100) / 100,
      stablecoinUsd:   Math.round(stablecoinUsd * 100) / 100,
      tokenExposureUsd: Math.round(tokenExposureUsd * 100) / 100,
      buyingPowerUsd:  Math.round(stablecoinUsd * 100) / 100,  // buying power = stablecoin balance
      openPositions,
      unpricedPositions,
      valuationConfidence,
      positions:       positionValuations,
    };
  }
}
