# Phase 6G — Validation Isolation Audit (Part 1)

This report presents a complete audit of Aether's validation script infrastructure. It identifies every table mutation, global delete, global rebuild, and test contamination vector, and details a remediation plan.

---

## Deliverable 1 — Validation Script Audits

### 1. `validate-positions.ts`
* **Tables touched**: `wallet_positions`, `trades`
* **Inserts performed**: 
  * Inserts a mock trade into the `trades` table.
* **Deletes performed**: 
  * Deletes the mock trade: `db.delete(tradesTable).where(eq(tradesTable.txHash, testTxHash))`
* **Truncates performed**: None.
* **Rebuild methods invoked**: 
  * `PositionBuilderService.rebuildAllPositions()`
* **Hidden side-effects**: 
  * **Critical Side-Effect**: `PositionBuilderService.rebuildAllPositions()` calls `PositionRepository.rebuildAll()`, which executes `await tx.delete(walletPositions)` as its first statement. This wipes all live production wallet positions.
* **Risk classification**: **CRITICAL**

---

### 2. `validate-wallet-metrics.ts`
* **Tables touched**: `wallet_metrics`, `trades`, `wallet_positions`
* **Inserts performed**: None.
* **Deletes performed**: None.
* **Truncates performed**: None.
* **Rebuild methods invoked**: 
  * `WalletMetricsRepository.rebuildWallet(wallet)` (for a sample of 5 wallets)
* **Hidden side-effects**: 
  * Rebuilds the metrics for 5 random production wallets. In an offline run, this is safe, but it mutates production data if run against active analytics.
* **Risk classification**: **LOW**

---

### 3. `validate-wallet-scores.ts`
* **Tables touched**: `wallet_scores`, `wallet_metrics`
* **Inserts performed**: None.
* **Deletes performed**: None in the script itself, but the rebuild method modifies the table.
* **Truncates performed**: None.
* **Rebuild methods invoked**: 
  * `WalletScoresRepository.rebuildAll()`
* **Hidden side-effects**: 
  * `WalletScoresRepository.rebuildAll()` executes a batch `INSERT ... ON CONFLICT (wallet) DO UPDATE SET` based on the entire `wallet_metrics` table. This updates all live scores in the database.
* **Risk classification**: **MEDIUM**

---

### 4. `validate-token-metrics.ts`
* **Tables touched**: `token_metrics`, `trades`, `wallet_positions`, `wallet_scores`
* **Inserts performed**: None.
* **Deletes performed**: None in the script itself.
* **Truncates performed**: None.
* **Rebuild methods invoked**: 
  * `TokenMetricsRepository.rebuildToken(token_address)`
  * `TokenMetricsRepository.rebuildAll()`
* **Hidden side-effects**: 
  * `TokenMetricsRepository.rebuildAll()` performs a global batch update on `token_metrics` using `INSERT ... ON CONFLICT DO UPDATE`. It mutates the state of every token.
* **Risk classification**: **MEDIUM**

---

### 5. `validate-smart-money-signals.ts`
* **Tables touched**: `smart_money_signals`, `token_metrics`, `wallet_positions`, `wallet_scores`
* **Inserts performed**: 
  * Inserts mock `token_metrics` and `wallet_positions` for mock tokens (`0x1111...`, `0x2222...`) and mock `wallet_scores` for 10 mock wallets.
* **Deletes performed**: 
  * `DELETE FROM wallet_positions WHERE token_address IN (mockToken, mockToken2)`
  * `DELETE FROM token_metrics WHERE token_address IN (mockToken, mockToken2)`
  * `DELETE FROM wallet_scores WHERE wallet IN (mockWallets)`
* **Truncates performed**: None.
* **Rebuild methods invoked**: 
  * `SmartMoneySignalsRepository.rebuildAll()`
* **Hidden side-effects**: 
  * `SmartMoneySignalsRepository.rebuildAll()` performs a global rebuild of `smart_money_signals`, overwriting the entire table with newly computed signals. If `trades` or other dependencies are in a dirty state (e.g. wiped by other tests), all smart money signals will be cleared.
* **Risk classification**: **HIGH**

---

### 6. `validate-risk-scenarios.ts`
* **Tables touched**: None.
* **Inserts performed**: None.
* **Deletes performed**: None.
* **Truncates performed**: None.
* **Rebuild methods invoked**: None.
* **Hidden side-effects**: None (pure in-memory unit tests).
* **Risk classification**: **LOW**

---

### 7. `validate-valuation-layer.ts`
* **Tables touched**: `price_observations`, `token_prices`, `trades`
* **Inserts performed**: 
  * Inserts test trades into `trades` table.
  * Calls `PriceObservationService.recordObservation()` which inserts into `price_observations`.
* **Deletes performed**: 
  * Wipes the tables: `await db.delete(priceObservations);`, `await db.delete(tokenPrices);`, `await db.delete(trades);`.
* **Truncates performed**: None (uses unconditional DELETE).
* **Rebuild methods invoked**: 
  * `PriceAggregator.aggregatePrices()`
* **Hidden side-effects**: 
  * **Destructive Wipeout**: Wipes all production indexer records and trade logs, leaving the database empty for other analytical queries.
* **Risk classification**: **CRITICAL**

---

### 8. `validate-portfolio-state.ts`
* **Tables touched**: `portfolio_snapshots`, `portfolio_state`, `wallet_positions`, `token_prices`
* **Inserts performed**: 
  * Upserts positions for a test wallet `0x1111...`.
  * Inserts test token prices for mock tokens.
  * Calls `PortfolioStateService.refresh()` which creates state snapshots.
* **Deletes performed**: 
  * Scoped cleanup:
    * `DELETE FROM portfolio_snapshots WHERE agent_wallet = AGENT_WALLET`
    * `DELETE FROM portfolio_state WHERE agent_wallet = AGENT_WALLET`
    * `DELETE FROM wallet_positions WHERE wallet = AGENT_WALLET`
    * `DELETE FROM token_prices WHERE token_address IN (CAKE, SHIT)`
* **Truncates performed**: None.
* **Rebuild methods invoked**: None.
* **Hidden side-effects**: None (cleanly scoped deletions).
* **Risk classification**: **LOW**

---

### 9. `validate-token-intel-snapshots.ts`
* **Tables touched**: `token_intel_snapshots`, `smart_money_signals`, `token_metrics`
* **Inserts performed**: 
  * Inserts mock snapshot, mock signal, mock token metrics.
* **Deletes performed**: 
  * `DELETE FROM token_intel_snapshots WHERE snapshot_at = captureTs`
  * `DELETE FROM smart_money_signals WHERE token_address = mockToken`
  * `DELETE FROM token_metrics WHERE token_address = mockToken`
* **Truncates performed**: None.
* **Rebuild methods invoked**: 
  * `SnapshotService.capture()`
* **Hidden side-effects**: 
  * Wipes snapshots matching the current block timestamp watermark.
* **Risk classification**: **LOW**

---

### 10. `validate-agent-consumption.ts`
* **Tables touched**: `token_intel_snapshots`, `smart_money_signals`
* **Inserts performed**: 
  * Inserts mock snapshots.
* **Deletes performed**: 
  * `DELETE FROM token_intel_snapshots WHERE snapshot_at = captureTs`
  * `DELETE FROM token_intel_snapshots WHERE token_address = tokenAddr AND snapshot_at < maxTs`
* **Truncates performed**: None.
* **Rebuild methods invoked**: 
  * `SnapshotService.capture()`
* **Hidden side-effects**: 
  * Wipes historical snapshots matching the block timestamp watermark.
* **Risk classification**: **LOW**

---

### 11. `validate-e2e-pipeline.ts`
* **Tables touched**: `wallet_positions`, `portfolio_snapshots`, `portfolio_state`, `token_prices`, `trades`, `price_observations`
* **Inserts performed**: 
  * Records observations for CAKE.
  * Inserts E2E agent wallet positions.
* **Deletes performed**: 
  * Scoped cleanups targeting only `E2E_AGENT_WALLET`.
* **Truncates performed**: None.
* **Rebuild methods invoked**: 
  * `PriceAggregator.aggregatePrices()` (scoped by addresses: `[CAKE_ADDRESS, USDT_ADDRESS]`)
* **Hidden side-effects**: 
  * Overwrites WBNB, CAKE, and USDT records in `token_prices` with E2E mock pricing.
* **Risk classification**: **LOW**

---

## Deliverable 2 — Remediation Matrix

| Script | Risk | Recommended Fix |
| :--- | :--- | :--- |
| `validate-positions.ts` | **CRITICAL** | Refactor to avoid calling `PositionBuilderService.rebuildAllPositions()`. Instead, run incremental `applyTrade()` tests and use `PositionRepository.rebuildWallet(testWallet)` scoped to test-specific wallets. |
| `validate-wallet-metrics.ts` | **LOW** | Use a dedicated `TEST_AGENT_WALLET` instead of selecting random wallets from the database. |
| `validate-wallet-scores.ts` | **MEDIUM** | Avoid calling the global `WalletScoresRepository.rebuildAll()`. Test scoring formulas using mock datasets loaded directly into memory or run scoring tests against isolated rows. |
| `validate-token-metrics.ts` | **MEDIUM** | Avoid calling `TokenMetricsRepository.rebuildAll()`. Restrict testing to target tokens and call `TokenMetricsRepository.rebuildToken(token)` for mock tokens only. |
| `validate-smart-money-signals.ts` | **HIGH** | Remove `SmartMoneySignalsRepository.rebuildAll()`. Scrutinize signals enrichment logic using in-memory mock signal models or mock databases with isolated scope. |
| `validate-risk-scenarios.ts` | **LOW** | No database changes. Keep unit test suite isolated. |
| `validate-valuation-layer.ts` | **CRITICAL** | Remove `db.delete(priceObservations)`, `db.delete(tokenPrices)`, and `db.delete(trades)`. Use isolated test token addresses (`TEST_TOKEN_A`, etc.) and delete only records matching those token addresses. |
| `validate-portfolio-state.ts` | **LOW** | Inherently scoped, but refactor to use the shared test-context utility to track mock positions. |
| `validate-token-intel-snapshots.ts` | **LOW** | Scope snapshot deletion to only touch records belonging to mock tokens rather than block-level watermark deletes. |
| `validate-agent-consumption.ts` | **LOW** | Clean up snapshots by mock token address instead of rolling block watermarks. |
| `validate-e2e-pipeline.ts` | **LOW** | Scope WBNB price modifications to test tokens to prevent modifying BNB baseline prices. |

---

## Deliverable 3 — Mutating & Destructive Operations Identified

### Unconditional DELETE Statements
* `packages/db/scripts/validate-valuation-layer.ts` (Lines 31-33):
  * `await db.delete(priceObservations);`
  * `await db.delete(tokenPrices);`
  * `await db.delete(trades);`

### TRUNCATE Statements
* *None.* (Drizzle ORM deletions are handled via `db.delete(table)` which maps to `DELETE FROM table`).

### `rebuildAll()` style operations
* `packages/db/scripts/validate-positions.ts` (Line 19):
  * `PositionBuilderService.rebuildAllPositions()` (triggers global `PositionRepository.rebuildAll()` which runs `DELETE FROM wallet_positions`).
* `packages/db/scripts/validate-wallet-scores.ts` (Line 302):
  * `WalletScoresRepository.rebuildAll()`
* `packages/db/scripts/validate-token-metrics.ts` (Line 292):
  * `TokenMetricsRepository.rebuildAll()`
* `packages/db/scripts/validate-smart-money-signals.ts` (Line 386):
  * `SmartMoneySignalsRepository.rebuildAll()`

---

## Deliverable 4 — Recommended Implementation Order & Effort

### 1. Highest-Risk (Critical/High) Remediation (Effort: 4 hours)
Fix scripts that destroy database state:
* **`validate-valuation-layer.ts`**: Remove global deletes. Use `TEST_TOKEN_A` and `TEST_TOKEN_B` and delete only matching observations.
* **`validate-positions.ts`**: Replace `rebuildAllPositions()` with scoped `rebuildWallet(testWallet)` runs.

### 2. Medium-Risk Remediation (Effort: 3 hours)
Fix scripts that perform global updates:
* **`validate-smart-money-signals.ts`**: Replace `rebuildAll()` with target-specific calculation tests.
* **`validate-token-metrics.ts`**: Replace `rebuildAll()` with targeted token metrics builds.
* **`validate-wallet-scores.ts`**: Replace `rebuildAll()` with mock testing or scoped updates.

### 3. Low-Risk & Integration Remediation (Effort: 2 hours)
Apply unified test contexts across all files:
* Implement `test-context.ts` utility.
* Refactor remaining scripts (`validate-portfolio-state.ts`, `validate-token-intel-snapshots.ts`, `validate-agent-consumption.ts`, `validate-e2e-pipeline.ts`, `validate-wallet-metrics.ts`) to use `withTestContext()` wrapper.
* Implement `validate-live-data-preservation.ts` to prove that consecutive validation runs do not change production record counts.
