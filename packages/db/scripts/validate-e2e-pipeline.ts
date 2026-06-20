/**
 * End-to-End Pipeline Validation
 *
 * Exercises the full path from Price Observation → Aggregation → Portfolio
 * Valuation → Portfolio State → Risk Engine with real DB calls.
 *
 * Also exercises the Signal pipeline (getTopSignals) to verify the
 * enrichment layer is intact before feeding into the Risk Engine.
 *
 * Assumes a live DB with indexed trades. Isolated test data uses a dedicated
 * E2E_AGENT_WALLET so normal agent state is never touched.
 */
import { PriceObservationService, BSC_STABLES, WBNB_ADDRESS } from '../../agent-core/src/valuation/price-observation-service.js';
import { PriceAggregator } from '../../agent-core/src/valuation/price-aggregator.js';
import { PortfolioValuationEngine } from '../../agent-core/src/portfolio/portfolio-valuation-engine.js';
import { PortfolioStateService } from '../../agent-core/src/portfolio/portfolio-state-service.js';
import { RiskEngine, type RiskInput } from '../../agent-core/src/risk/risk-engine.js';
import { SmartMoneySignalsRepository } from '../src/repositories/smart-money-signals-repository.js';
import { PositionRepository } from '../src/repositories/position-repository.js';
import {
  db, queryClient,
  walletPositions, tokenPrices, priceObservations, portfolioSnapshots, portfolioState,
  eq, inArray, sql,
} from '../src/client.js';

const E2E_AGENT_WALLET = '0xe2e0000000000000000000000000000000000001';
const USDT_ADDRESS     = '0x55d398326f99059ff775485246999027b3197955';
const CAKE_ADDRESS     = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';

let totalChecks = 0;
let passCount   = 0;
let failCount   = 0;

function pass(label: string, detail = '') {
  totalChecks++;
  passCount++;
  console.log(`  PASS  ${label}${detail ? ': ' + detail : ''}`);
}

function fail(label: string, detail = '') {
  totalChecks++;
  failCount++;
  console.error(`  FAIL  ${label}${detail ? ': ' + detail : ''}`);
}

function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

// ── Cleanup guard ───────────────────────────────────────────────────────────

// State captured before the test mutates price tables, used to restore exactly
// the rows that existed before Section 1 runs.
let priceSnapshotMaxObsId = -1;              // max price_observations id (any token) before test
let priceSnapshotTokenAddresses: string[] = []; // token_prices addresses that existed before test
let priceSnapshotRows: any[] = [];           // full token_prices rows that existed before test

async function capturePreTestPriceState() {
  // Capture max price_observations id (we'll delete any rows written above this watermark)
  const obsRows = await db
    .select({ id: priceObservations.id })
    .from(priceObservations)
    .orderBy(sql`id DESC`)
    .limit(1);
  priceSnapshotMaxObsId = obsRows.length > 0 ? obsRows[0]!.id : -1;

  // Snapshot the full token_prices table so we can restore it exactly
  priceSnapshotRows = await db.select().from(tokenPrices);
  priceSnapshotTokenAddresses = priceSnapshotRows.map((r: any) => r.tokenAddress);
}

async function restorePreTestPriceState() {
  // Delete all price_observations inserted during this test run (id > pre-test watermark)
  if (priceSnapshotMaxObsId >= 0) {
    await db
      .delete(priceObservations)
      .where(sql`${priceObservations.id} > ${priceSnapshotMaxObsId}`);
  } else {
    // Nothing existed before — delete everything written during the test
    await db.delete(priceObservations);
  }

  // Delete any token_prices rows added by the test that did NOT exist before
  const allCurrent = await db.select({ a: tokenPrices.tokenAddress }).from(tokenPrices);
  const newAddresses = allCurrent
    .map((r: any) => r.a)
    .filter((a: string) => !priceSnapshotTokenAddresses.includes(a));
  if (newAddresses.length > 0) {
    await db.delete(tokenPrices).where(inArray(tokenPrices.tokenAddress, newAddresses));
  }

  // Restore any pre-existing token_prices rows the test may have overwritten
  for (const row of priceSnapshotRows) {
    await db
      .insert(tokenPrices)
      .values(row)
      .onConflictDoUpdate({
        target: tokenPrices.tokenAddress,
        set: {
          priceUsd:           row.priceUsd,
          vwap1m:             row.vwap1m,
          vwap15m:            row.vwap15m,
          vwap1h:             row.vwap1h,
          observationCount1h: row.observationCount1h,
          liquidityUsd:       row.liquidityUsd,
          routeType:          row.routeType,
          priceState:         row.priceState,
          priceConfidence:    row.priceConfidence,
          manipulationFlag:   row.manipulationFlag,
          updatedAt:          row.updatedAt,
        },
      });
  }
}

async function cleanup() {
  await db.delete(walletPositions).where(eq(walletPositions.wallet, E2E_AGENT_WALLET));
  await db.delete(portfolioSnapshots).where(eq(portfolioSnapshots.agentWallet, E2E_AGENT_WALLET));
  await db.delete(portfolioState).where(eq(portfolioState.agentWallet, E2E_AGENT_WALLET));
  // Restore CAKE price tables to their exact pre-test state (snapshot-and-restore pattern)
  await restorePreTestPriceState();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Toru E2E Pipeline Validation');
  console.log('='.repeat(64));

  // Capture pre-test CAKE price state BEFORE any cleanup or mutation
  await capturePreTestPriceState();
  await cleanup(); // ensure clean state before starting (restores to snapshot)

  // ── Section 1: Price Aggregation (batch path) ─────────────────────────────
  section('1. Price Aggregation — batch query correctness & performance');
  {
    // Record a fresh observation for CAKE via WBNB route
    PriceObservationService.setCachedWbnbPrice(600.0); // set known BNB price
    await PriceObservationService.recordObservation({
      tokenIn:          WBNB_ADDRESS,
      tokenOut:         CAKE_ADDRESS,
      amountIn:         (1e18).toString(),          // 1 BNB
      amountOut:        (3.0 * 1e18).toString(),    // 3 CAKE → price = 200 USD/CAKE
      tokenInDecimals:  18,
      tokenOutDecimals: 18,
      observedAt:       new Date(),
    });

    // Measure batch aggregation time for a small set
    const t0 = Date.now();
    await PriceAggregator.aggregatePrices(new Date(), undefined, [CAKE_ADDRESS, USDT_ADDRESS]);
    const elapsedMs = Date.now() - t0;

    if (elapsedMs < 5000) {
      pass('aggregatePrices() for 2 tokens completed', `${elapsedMs}ms < 5000ms`);
    } else {
      fail('aggregatePrices() took too long', `${elapsedMs}ms`);
    }

    // Verify the CAKE price row was written correctly
    const priceRows = await db.select().from(tokenPrices).where(eq(tokenPrices.tokenAddress, CAKE_ADDRESS));
    const cakePrice = priceRows[0];

    if (cakePrice) {
      pass('CAKE token_prices row exists after aggregation');
    } else {
      fail('CAKE token_prices row missing after aggregation');
    }

    if (cakePrice && cakePrice.priceUsd > 0) {
      pass('CAKE price_usd is positive', `$${cakePrice.priceUsd.toFixed(4)}`);
    } else {
      fail('CAKE price_usd is zero or missing');
    }

    if (cakePrice && ['FRESH', 'STALE', 'UNRESOLVABLE', 'MANIPULATED'].includes(cakePrice.priceState)) {
      pass('CAKE price_state is valid enum', cakePrice.priceState);
    } else {
      fail('CAKE price_state is invalid', cakePrice?.priceState ?? 'null');
    }

    if (cakePrice && cakePrice.vwap1h >= 0 && cakePrice.vwap15m >= 0 && cakePrice.vwap1m >= 0) {
      pass('CAKE VWAP fields are non-negative');
    } else {
      fail('CAKE VWAP fields invalid');
    }

    if (cakePrice && cakePrice.priceConfidence >= 0 && cakePrice.priceConfidence <= 100) {
      pass('CAKE price_confidence in [0, 100]', `${cakePrice.priceConfidence}`);
    } else {
      fail('CAKE price_confidence out of range', `${cakePrice?.priceConfidence}`);
    }
  }

  // ── Section 2: Portfolio Valuation Engine ────────────────────────────────
  section('2. Portfolio Valuation — stablecoin + token positions');
  {
    // Insert a USDT (stablecoin) position and a CAKE (token) position
    const usdtHuman  = 10000;
    const cakeHuman  = 50;
    const usdtRaw    = (BigInt(usdtHuman) * BigInt(1e6)).toString();   // USDT = 6 decimals
    const cakeRaw    = (BigInt(cakeHuman) * BigInt(1e18)).toString();  // CAKE = 18 decimals

    await PositionRepository.upsertPosition({
      wallet:        E2E_AGENT_WALLET,
      tokenAddress:  USDT_ADDRESS,
      tokenSymbol:   'USDT',
      tokenDecimals: 6,
      totalBought:   usdtRaw,
      totalSold:     '0',
      netAmount:     usdtRaw,
      firstTradeAt:  new Date(),
      lastTradeAt:   new Date(),
      tradeCount:    1,
    });

    await PositionRepository.upsertPosition({
      wallet:        E2E_AGENT_WALLET,
      tokenAddress:  CAKE_ADDRESS,
      tokenSymbol:   'CAKE',
      tokenDecimals: 18,
      totalBought:   cakeRaw,
      totalSold:     '0',
      netAmount:     cakeRaw,
      firstTradeAt:  new Date(),
      lastTradeAt:   new Date(),
      tradeCount:    1,
    });

    const positions = await PositionRepository.getWalletPositions(E2E_AGENT_WALLET);

    // Build price map from what aggregation wrote
    const priceRow = await db.select().from(tokenPrices).where(eq(tokenPrices.tokenAddress, CAKE_ADDRESS));
    const priceMap = new Map<string, { priceUsd: number; priceState: any; priceConfidence: number }>();
    if (priceRow[0]) {
      priceMap.set(CAKE_ADDRESS, {
        priceUsd:        priceRow[0].priceUsd,
        priceState:      priceRow[0].priceState as any,
        priceConfidence: priceRow[0].priceConfidence,
      });
    }

    const valuation = PortfolioValuationEngine.compute(
      E2E_AGENT_WALLET,
      positions,
      priceMap as any,
      BSC_STABLES,
      new Date()
    );

    if (valuation.portfolioUsd > 0) {
      pass('portfolioUsd is positive', `$${valuation.portfolioUsd.toFixed(2)}`);
    } else {
      fail('portfolioUsd is zero — positions not valued');
    }

    if (Math.abs(valuation.stablecoinUsd - usdtHuman) < 1) {
      pass('stablecoinUsd equals USDT position', `$${valuation.stablecoinUsd.toFixed(2)}`);
    } else {
      fail('stablecoinUsd mismatch', `expected ~${usdtHuman}, got ${valuation.stablecoinUsd}`);
    }

    if (valuation.tokenExposureUsd > 0) {
      pass('tokenExposureUsd is positive (CAKE position valued)', `$${valuation.tokenExposureUsd.toFixed(2)}`);
    } else {
      fail('tokenExposureUsd is zero — CAKE position not priced');
    }

    if (valuation.valuationConfidence > 0 && valuation.valuationConfidence <= 100) {
      pass('valuationConfidence in (0, 100]', `${valuation.valuationConfidence}`);
    } else {
      fail('valuationConfidence out of range', `${valuation.valuationConfidence}`);
    }

    if (valuation.openPositions === 1) {
      pass('openPositions === 1 (CAKE only, USDT is stablecoin)');
    } else {
      fail('openPositions mismatch', `expected 1, got ${valuation.openPositions}`);
    }

    // ── Section 3: Portfolio State Engine ─────────────────────────────────
    section('3. Portfolio State Engine — bootstrap path');
    {
      const svc = new PortfolioStateService({ agentWalletAddress: E2E_AGENT_WALLET, startingCapitalUsd: 10000 });
      const { snapshot } = await svc.refresh();

      // Explicit bootstrap path assertion — this section failed before the C3/C4 fix
      // because the constructor and refresh() were called with wrong signatures
      pass('Bootstrap path reached (constructor + refresh() API correct)');

      if (snapshot.drawdownPct === 0) {
        pass('Bootstrap: drawdownPct initialized to 0%');
      } else {
        fail('Bootstrap: drawdownPct should be 0 on first run', `got ${snapshot.drawdownPct}`);
      }

      if (snapshot.rollingLossPct24h === 0) {
        pass('Bootstrap: rollingLossPct24h initialized to 0%');
      } else {
        fail('Bootstrap: rollingLossPct24h should be 0 on first run', `got ${snapshot.rollingLossPct24h}`);
      }

      if (snapshot.portfolioUsd === valuation.portfolioUsd) {
        pass('Snapshot portfolioUsd matches valuation');
      } else {
        fail('Snapshot portfolioUsd mismatch', `snapshot=${snapshot.portfolioUsd} valuation=${valuation.portfolioUsd}`);
      }

      // Exposure percentage bounds — portfolioUsd > startingCapitalUsd in this test
      // ($10000 USDT + $10000 in CAKE = $20000 > $10000 starting capital)
      if (snapshot.cashReservePct >= 0 && snapshot.cashReservePct <= 100) {
        pass('cashReservePct bounded [0, 100] with portfolioUsd > startingCapitalUsd', `${snapshot.cashReservePct}%`);
      } else {
        fail('cashReservePct out of bounds — denominator bug not fixed', `${snapshot.cashReservePct}%`);
      }

      if (snapshot.totalExposurePct >= 0 && snapshot.totalExposurePct <= 100) {
        pass('totalExposurePct bounded [0, 100] with portfolioUsd > startingCapitalUsd', `${snapshot.totalExposurePct}%`);
      } else {
        fail('totalExposurePct out of bounds — denominator bug not fixed', `${snapshot.totalExposurePct}%`);
      }

      // With $10000 stablecoin and $10000 token exposure in a $20000 portfolio: 50/50
      if (snapshot.cashReservePct === 50 && snapshot.totalExposurePct === 50) {
        pass('portfolioUsd > startingCapitalUsd: exposure percentages relative to current portfolio');
      } else {
        fail('portfolioUsd > startingCapitalUsd: incorrect exposure percentages',
          `cash=${snapshot.cashReservePct}% exposure=${snapshot.totalExposurePct}% (expected 50%/50% for $10k/$10k in $20k portfolio)`);
      }

      // Verify portfolio_state row was persisted atomically
      const stateRows = await db.select().from(portfolioState).where(eq(portfolioState.agentWallet, E2E_AGENT_WALLET));
      if (stateRows.length === 1) {
        pass('portfolio_state row persisted after first refresh (atomic transaction)');
      } else {
        fail('portfolio_state row missing after first refresh', `rows=${stateRows.length}`);
      }

      // Verify portfolio_snapshots row was persisted in same transaction
      const snapRows = await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.agentWallet, E2E_AGENT_WALLET));
      if (snapRows.length === 1) {
        pass('portfolio_snapshots row persisted in same transaction as state');
      } else {
        fail('portfolio_snapshots row missing — transaction may have split', `rows=${snapRows.length}`);
      }

      const state = stateRows[0];
      if (state && state.startingCapitalUsd === 10000) {
        pass('startingCapitalUsd preserved at initial value', `$${state.startingCapitalUsd}`);
      } else {
        fail('startingCapitalUsd wrong', `expected 10000, got ${state?.startingCapitalUsd}`);
      }

      // ── Section 4: Risk Engine with real portfolio state ─────────────────
      section('4. Risk Engine — live portfolio state + signal bundle');
      {
        const liveSignals = await SmartMoneySignalsRepository.getTopSignals({
          tiers: ['STRONG', 'MODERATE', 'WEAK'],
          limit: 1,
        });

        if (liveSignals.length === 0) {
          // No signals in DB yet (fresh environment) — use a mock bundle
          console.log('  INFO  No live signals in DB; using mock bundle for Risk Engine test');

          const mockBundle = {
            tokenAddress:             '0xmock',
            tokenSymbol:              'MOCK',
            signalTier:               'STRONG' as const,
            accumulationScore:        80,
            opportunityScore:         85,
            confidence:               80,
            trend:                    'INCREASING' as const,
            qualityHolderCount:       25,
            holderCount:              200,
            qualityConcentrationPct:  15.0,
            concentrationScore:       15,
            avgQualityRank:           85.0,
            qualityEntries4h:         5,
            qualityExits4h:           1,
            netAccumulationFlow:      4,
            qualityEntries24h:        10,
            qualityExits24h:          2,
            netAccumulationFlow24h:   8,
            topClassifications:       [],
            signalReasons:            [],
            riskFlags:                [],
            qualityHolderChange24h:   8,
            narrative:                'Mock narrative for E2E test',
            dataFreshness:            'LIVE' as const,
            minimumHolders:           true,
            computedAt:               new Date(),
          };

          const input: RiskInput = {
            signal:                      mockBundle,
            marketPrice:                 1.05,
            smartMoneyVWAP:             1.00,
            poolLiquidityUsd:           150000,
            simulatedValueRetentionPct: 99.0,
            portfolio: {
              currentDrawdownPct: snapshot.drawdownPct,
              dailyLossPct:       snapshot.rollingLossPct24h,
              cashReservePct:     (valuation.stablecoinUsd / valuation.portfolioUsd) * 100,
              totalExposurePct:   (valuation.tokenExposureUsd / valuation.portfolioUsd) * 100,
              openRiskPct:        (valuation.tokenExposureUsd / valuation.portfolioUsd) * 100,
              openPositions:      valuation.openPositions,
            },
          };

          const decision = RiskEngine.evaluate(input);

          if (typeof decision.allowed === 'boolean') {
            pass('RiskEngine returned a valid decision', `allowed=${decision.allowed} tier=${decision.riskTier}`);
          } else {
            fail('RiskEngine decision.allowed is not boolean');
          }

          if (decision.positionSizePct >= 0 && decision.positionSizePct <= 100) {
            pass('positionSizePct in [0, 100]', `${decision.positionSizePct}%`);
          } else {
            fail('positionSizePct out of range', `${decision.positionSizePct}`);
          }

          if (decision.blockers.every(b => typeof b === 'string')) {
            pass('all blockers are strings', `count=${decision.blockers.length}`);
          } else {
            fail('blockers contain non-string values');
          }

        } else {
          const liveSignal = liveSignals[0]!;
          const priceRows2 = await db.select().from(tokenPrices).where(
            eq(tokenPrices.tokenAddress, liveSignal.tokenAddress)
          );
          const livePrice = priceRows2[0];

          const marketPrice    = livePrice?.priceUsd ?? 1.0;
          const smartMoneyVwap = livePrice?.vwap1h   ?? 1.0;

          const input: RiskInput = {
            signal:                      liveSignal,
            marketPrice,
            smartMoneyVWAP:             smartMoneyVwap,
            poolLiquidityUsd:           livePrice?.liquidityUsd ?? 0,
            simulatedValueRetentionPct: 99.0,
            portfolio: {
              currentDrawdownPct: snapshot.drawdownPct,
              dailyLossPct:       snapshot.rollingLossPct24h,
              cashReservePct:     (valuation.stablecoinUsd / valuation.portfolioUsd) * 100,
              totalExposurePct:   (valuation.tokenExposureUsd / valuation.portfolioUsd) * 100,
              openRiskPct:        (valuation.tokenExposureUsd / valuation.portfolioUsd) * 100,
              openPositions:      valuation.openPositions,
            },
          };

          const decision = RiskEngine.evaluate(input);

          if (typeof decision.allowed === 'boolean') {
            pass('RiskEngine processed live signal', `allowed=${decision.allowed} tier=${decision.riskTier} signal=${liveSignal.tokenSymbol}`);
          } else {
            fail('RiskEngine returned invalid decision for live signal');
          }

          if (decision.positionSizePct >= 0 && decision.positionSizePct <= 100) {
            pass('positionSizePct in [0, 100]', `${decision.positionSizePct}%`);
          } else {
            fail('positionSizePct out of range', `${decision.positionSizePct}`);
          }

          if (!decision.allowed || decision.reasons.length > 0) {
            pass('decision includes reasons or blockers', `reasons=${decision.reasons.length} blockers=${decision.blockers.length}`);
          } else {
            fail('allowed decision has no reasons — audit trail missing');
          }
        }
      }
    }
  }

  // ── Section 5: WBNB Cache — TTL and cold-start behaviour ────────────────
  section('5. WBNB price cache — TTL and cold-start (fail-closed)');
  {
    // 5A: Cache hit — should return cached value immediately
    PriceObservationService.setCachedWbnbPrice(650.0);
    const price1 = await PriceObservationService.resolveWbnbPrice();
    if (price1 === 650.0) {
      pass('5A: Fresh cache returns set value', `$${price1}`);
    } else {
      fail('5A: Fresh cache returned wrong value', `expected 650, got ${price1}`);
    }

    // 5B: Cache update — subsequent setCachedWbnbPrice replaces old value
    PriceObservationService.setCachedWbnbPrice(700.0);
    const price2 = await PriceObservationService.resolveWbnbPrice();
    if (price2 === 700.0) {
      pass('5B: Cache updated correctly via setCachedWbnbPrice', `$${price2}`);
    } else {
      fail('5B: setCachedWbnbPrice did not update cache', `expected 700, got ${price2}`);
    }

    // 5C: Cold-start — reset cache and check DB or fail-closed behaviour.
    //     If the DB has a WBNB token_prices row (e.g. from a prior run), the DB price is used.
    //     If no DB row exists, resolveWbnbPrice() must return null — never a hardcoded default.
    PriceObservationService.resetWbnbCache();
    const wbnbDbRows = await db.select().from(tokenPrices).where(eq(tokenPrices.tokenAddress, WBNB_ADDRESS));
    const coldPrice = await PriceObservationService.resolveWbnbPrice();

    if (wbnbDbRows.length === 0) {
      if (coldPrice === null) {
        pass('5C: Cold-start with no DB row: resolveWbnbPrice() returns null (fail-closed, no hardcoded default)');
      } else {
        fail('5C: Cold-start: hardcoded WBNB fallback still active', `expected null, got ${coldPrice}`);
      }
    } else {
      if (coldPrice === wbnbDbRows[0]!.priceUsd) {
        pass('5C: Cold-start with DB row: resolveWbnbPrice() uses persisted price', `$${coldPrice}`);
      } else {
        fail('5C: Cold-start: DB price not returned correctly', `expected ${wbnbDbRows[0]?.priceUsd}, got ${coldPrice}`);
      }
    }

    // 5D: Verify WBNB-routed observations are skipped (not errored) when price unavailable.
    //     recordObservation() must return cleanly without throwing when wbnbPrice is null.
    PriceObservationService.resetWbnbCache();
    await db.delete(tokenPrices).where(eq(tokenPrices.tokenAddress, WBNB_ADDRESS));
    try {
      await PriceObservationService.recordObservation({
        tokenIn:          WBNB_ADDRESS,
        tokenOut:         CAKE_ADDRESS,
        amountIn:         (1e18).toString(),
        amountOut:        (3e18).toString(),
        tokenInDecimals:  18,
        tokenOutDecimals: 18,
        observedAt:       new Date(),
      });
      pass('5D: recordObservation() returns without throw when WBNB price unavailable');
    } catch (e) {
      fail('5D: recordObservation() threw when WBNB price unavailable', String(e));
    }

    // Restore original WBNB DB rows if they existed before this test
    if (wbnbDbRows.length > 0) {
      await db.insert(tokenPrices).values(wbnbDbRows);
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  await cleanup();

  console.log('\n' + '='.repeat(64));
  console.log(`Result: ${passCount} PASS  ${failCount} FAIL  (${totalChecks} checks)`);

  await queryClient.end();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
