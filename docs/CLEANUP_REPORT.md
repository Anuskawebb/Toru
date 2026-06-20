# Toro Repository Cleanup Report

> Date: 2026-06-20. Full read-only audit followed by targeted changes.
> No features added. No architecture modified. No functionality changed.

---

## 1. Cleanup Report — What Was Changed

### Phase 1 — Naming (Aether → Toro)

| File | Before | After |
|------|--------|-------|
| `client/package.json` | `"name": "my-project"` | `"name": "toro"` |
| `render.yaml` | `name: aether-watcher` | `name: toro-watcher` |
| `client/app/agent/page.tsx:41` | `"Aether Agent"` | `"Toro Agent"` |
| `client/app/news/page.tsx:49` | `"Aether AI identifies..."` | `"Toro AI identifies..."` |
| `client/app/news/page.tsx:50` | `source: 'Aether Intelligence'` | `source: 'Toro Intelligence'` |
| `client/app/token/[symbol]/page.tsx:161` | `"Aether Recommendation"` | `"Toro Recommendation"` |
| `client/lib/mock-data.ts:287` | `source: 'Aether Intelligence'` | `source: 'Toro Intelligence'` |
| `indexer/package.json:10` | `/tmp/aether-validator.json` | `/tmp/toro-validator.json` |

**Zero remaining `Aether`/`aether` references in source code (`.ts`, `.tsx`, `.json`).**

### Phase 3 — Workspace Wiring (done in prior pass)
- `pnpm-workspace.yaml` — added `packages:` field declaring all workspace members
- `analytics-worker/package.json` — `"@toro/db": "file:../packages/db"` → `"workspace:*"`
- `packages/agent-core/package.json` — `"@toro/db": "file:../db"` → `"workspace:*"`
- `landing/package.json` — added `"@toro/db": "workspace:*"` (was imported but undeclared)

### Phase 4 — .gitignore Fix (done in prior pass)
- Added `**/node_modules` and `**/dist` to root `.gitignore` (was only ignoring `/node_modules`)
- Untracked and removed committed `analytics-worker/node_modules`, `analytics-worker/dist`, `packages/agent-core/node_modules`

---

## 2. Technical Debt Report — Remaining Debt

### Naming Remnants (Intentionally Left)

| Location | Value | Reason Left |
|----------|-------|-------------|
| `landing/app/page.tsx:6` | `https://aether-trader.vercel.app/` | Live deployed URL — changing breaks the link. Coordinate with deployment team. |
| `landing/components/ui/motion-footer.tsx:201` | `https://aether-trader.vercel.app/` | Same deployed URL. |
| `docs/current-system-audit.md` | Multiple "Aether" references | Historical audit document. Describes BSC indexer era. Mark as `[HISTORICAL]` or archive. |
| `docs/AGENT_HANDOFF.md`, `docs/PROJECT_OVERVIEW.md` | `Aether-mantle/` directory path | Documentation references. Cosmetic — update when docs are refreshed. |
| `validation_isolation_audit.md` (root) | "Aether's validation" | Historical audit. Safe to leave or archive. |
| `packages/db/package-lock.json` | `"@aether/db"` in lock | Legacy lock entry. Will resolve on next `pnpm install`. Do not manually edit lockfiles. |
| `watcher/package-lock.json` | `"aether-watcher"` | Legacy lock entry. Same — resolves on reinstall. |
| Mantle network references throughout | `Mantle`, `Mantle Sepolia` | **Correct.** Mantle is the active L2 network. Do NOT replace. |

### Mock Systems (Production-Safe, Intentional)

| System | Location | Classification | Action |
|--------|----------|----------------|--------|
| `MockExecutor` | `packages/agent-core/src/execution/mock-executor.ts` | **Production Mock** — intentional Phase 8A design | Replace with `TwakExecutor` in Phase 8B |
| `mock-data.ts` | `client/lib/mock-data.ts` | **Development Mock** — frontend scaffolding | Replace route-by-route per `FRONTEND_API_MAPPING.md` |
| `mock-data-advanced.ts` | `client/lib/mock-data-advanced.ts` | **Development Mock** — advanced UI scaffolding | Same as above |
| Mock contracts (MockWETH, MockMNT) | `contracts/web3/scripts/` | **Development Mock** — testnet only | Keep; only deployed on Mantle Sepolia testnet |
| Seed wallets | `watcher/scripts/seed.ts` | **Development Mock** — clearly scoped | Keep in scripts/, not in production code |

### Hardcoded Values

| File | Value | Classification | Action |
|------|-------|----------------|--------|
| `client/lib/twak.ts:6` | `'http://127.0.0.1:3000'` | **Acceptable** — env-overridable default | Set `TWAK_API_URL` in production env |
| `client/lib/api.ts:169` | `'http://localhost:3000'` | **Acceptable** — env-overridable default | Set `NEXT_PUBLIC_API_URL` in production env |
| `packages/agent-core/.../twak-config.ts:4` | `'http://127.0.0.1:3000'` | **Acceptable** — env-overridable | Same |
| `client/app/api/system/health/route.ts:8` | `'toro-agent-001'` | **Acceptable** — documented backward-compat default | Env var `TORO_AGENT_ID` overrides |
| `packages/db/src/schema/agents.ts:7` | `'toro-agent-001'` | **Acceptable** — schema backward-compat comment | Document in schema, not a runtime bug |
| `indexer/src/index.ts` | Hardcoded single wallet `0xd096705...` | **Bug Risk** — single-wallet demo artifact | Move to env var `WATCHED_WALLET` |

### Stub API Routes (Functional Gaps)

| Route | Status | Impact |
|-------|--------|--------|
| `GET /api/portfolio` | Returns stub | Users cannot see P&L |
| `GET /api/positions` | Returns stub | No open positions display |
| `GET /api/signals` | Returns stub | Signal feed is empty |
| `GET /api/agents/[id]/config` | Returns empty arrays | Token/trader watchlists not persisted |
| `GET /api/system/health` | Hardcoded "healthy" | No real service health visibility |
| `GET /api/execution-center` | Partially real | Hardcoded system stats mixed with real data |

### Placeholder UI Pages

| Page | Status |
|------|--------|
| `/settings` | Shell only — no content |
| `/portfolio` | Shell only — uses stub API |
| `/agent-marketplace` | Shell only — no content |
| `/agent-intelligence` | Shell only — no content |
| `/markets` | Shell only — no content |
| `/news` | Populated with mock articles only |
| `/nfts` | Shell only — no content |

---

## 3. Risk Report — Potential Future Problems

### HIGH — Execution Gap
**TwakExecutor is implemented but MockExecutor is wired in production.** Every "executed" trade returns `mock_tx_${orderId}` — nothing touches the blockchain. This is Phase 8A by design, but shipping without a clear toggle creates user trust risk. Risk: users believe trades executed when they haven't.

**Mitigation:** Add `EXECUTOR_TYPE=MOCK|TWAK` env var and factory before any public launch.

### HIGH — Single Wallet in Indexer
`indexer/src/index.ts` watches a hardcoded single wallet (`0xd096705...`). Anyone who clones and runs the indexer gets a single-wallet demo — not multi-wallet production behavior. Risk: indexer appears to work but only ingests one wallet's data.

**Mitigation:** Read watched wallets from DB (`wallet_scores` table) or an env var list.

### MEDIUM — System Health Hardcoded
`/api/system/health` returns hardcoded status. The execution center shows all services as "healthy" regardless of actual state. Risk: silent failures invisible to operators.

**Mitigation:** Implement real ping checks for TWAK, DB, analytics-worker, indexer.

### MEDIUM — Deployment URL Stale
`landing/app/page.tsx` and `landing/components/ui/motion-footer.tsx` both link to `https://aether-trader.vercel.app/`. If this domain expires or redirects, all landing page CTAs break.

**Mitigation:** Move to an env var `NEXT_PUBLIC_APP_URL` and update the deployed URL.

### LOW — lockfile Legacy References
`packages/db/package-lock.json` and `watcher/package-lock.json` contain `@aether/db` references. These are harmless (lockfiles are generated artifacts) but create confusion for new contributors. Will auto-resolve on next `pnpm install`.

### LOW — Missing Agents DB Constraint
`agents.status` schema defaults to `'ACTIVE'` but the POST route inserts `'DRAFT'`. Schema default is misleading and will cause confusion for anyone running raw SQL inserts. Risk: manual DB operations create agents in wrong initial state.

---

## 4. Recommended Next Sprint

Based only on current code state. No future visions.

### Sprint Task 1 — Wire TwakExecutor (CRITICAL)
**Files:** `packages/agent-core/src/execution/`
**Why:** MockExecutor in production is the biggest trust/correctness gap. TwakExecutor is fully implemented. Add factory: `EXECUTOR_TYPE=MOCK|TWAK`, default to `MOCK` in dev, `TWAK` in prod.
**Effort:** ~2 hours.

### Sprint Task 2 — Fix Indexer Single-Wallet Hardcode
**File:** `indexer/src/index.ts`
**Why:** Indexer is production-running but only watching one demo wallet. Real multi-wallet ingestion requires reading from DB or config.
**Effort:** ~3 hours.

### Sprint Task 3 — Implement Real Portfolio + Positions APIs
**Files:** `client/app/api/portfolio/route.ts`, `client/app/api/positions/route.ts`
**Why:** `agent_positions` and `portfolio_state` tables are populated by the execution engine and P&L updater. The API is a stub. Users need P&L visibility.
**Effort:** ~4 hours.

### Sprint Task 4 — Real System Health API
**Files:** `client/app/api/system/health/route.ts`, `client/app/execution-center/page.tsx`
**Why:** Dashboard shows hardcoded "healthy". Operators have no visibility into actual service state.
**Effort:** ~2 hours.

### Sprint Task 5 — Fix Deployment URL to Env Var
**Files:** `landing/app/page.tsx`, `landing/components/ui/motion-footer.tsx`
**Why:** `https://aether-trader.vercel.app/` is hardcoded in two places. Move to `NEXT_PUBLIC_APP_URL` to allow environment-specific overrides and prevent stale links.
**Effort:** ~30 minutes.

---

## Naming Reference — What Is What

| Name | Status | Meaning |
|------|--------|---------|
| **Toro** | ✅ Active product name | The platform, brand, agents |
| **Mantle** | ✅ Active L2 network | The blockchain where contracts live |
| **BSC** | ✅ Active indexer chain | The chain the indexer watches |
| **TWAK** | ✅ Active wallet SDK | Custodial execution sidecar |
| Aether | ❌ Legacy codename | Old project name — fully removed from source |
| aether-mantle | ❌ Legacy repo path | Old repo directory name — still in filesystem path only |
| aether-watcher | ❌ Legacy service | Renamed to toro-watcher in render.yaml |
| Aether Intelligence | ❌ Legacy data source label | Replaced with Toro Intelligence |
