# Architecture Evolution Summary — Toru

**How Toru evolves from TWAK Agent Wallet today to Delegated Smart Account Trading in the future — without rewriting the intelligence layer.**

---

## The Core Constraint

Toru's intelligence pipeline — indexer, analytics, decision engine, risk engine — must never be touched during execution architecture changes. These layers are chain-agnostic and account-agnostic. They produce signals and recommendations. How those recommendations are executed is a separate concern.

```
[INTELLIGENCE LAYER — never changes]

BSC Chain
  ↓
Indexer
  ↓
Wallet Metrics → Wallet Scores → Token Metrics → Smart Money Signals
  ↓
Decision Engine → Trade Recommendations
  ↓
Risk Engine

[EXECUTION LAYER — this is what evolves]

Trade Recommendations
  ↓
Execution Engine
  ↓
Executor Interface  ← THE SEAM
  ↓
[MockExecutor | TwakExecutor | SmartAccountExecutor | WalletConnectExecutor]
  ↓
BSC
```

The `Executor` interface at `packages/agent-core/src/execution/executor.ts` is the architectural seam. Everything above it is stable. Everything below it can evolve freely.

---

## Today — TWAK Agent Wallet (V1)

```
User
  ↓ authorizes Toru during onboarding
Toru
  ↓
TWAK SDK (holds agent private key)
  ↓
BSC (PancakeSwap swap)
```

**Characteristics:**
- Custodial — Toru (via TWAK) controls the private key
- Simple — no on-chain delegation, no session keys
- Fast to ship — TWAK SDK handles key management
- User trust model: "I trust Toru to trade on my behalf and not steal my funds"
- Risk: Toru has full control of the agent wallet

**Implementation status:** `TwakExecutor` not yet built. `MockExecutor` is active. Phase 8B implements `TwakExecutor`.

---

## Phase 8B — TwakExecutor Ships

```
execution_accounts table          (new — tracks agent wallet)
  ↓
ExecutionEngine (unchanged)
  ↓
TwakExecutor                      (new — implements Executor)
  ↓
TWAK SDK → PancakeSwap V3 on BSC
```

**What changes:**
- `TwakExecutor` implements the existing `Executor` interface
- `execution_accounts` table created — one row for the TWAK agent wallet
- `execution_policies` table created — default policy applied per account
- Orchestrator selects `TwakExecutor` based on `account_type = 'TWAK_AGENT'`

**What does NOT change:**
- `ExecutionEngine` — zero modifications
- `DecisionEngine`, `RiskEngine` — untouched
- All analytics tables — untouched
- `MockExecutor` — kept for tests

---

## Phase 8C — Smart Account (V2)

```
User's Smart Account
  ↓ deploys or connects via ZeroDev / Biconomy
Toru Session Key (ephemeral — Toru holds but cannot transfer user's funds)
  ↓ UserOperation via ERC-4337 bundler
BSC EntryPoint
  ↓
PancakeSwap V3
```

**Characteristics:**
- Non-custodial — user retains full ownership of their smart account
- Toru holds only a scoped session key (can swap specific tokens up to policy limits, cannot transfer)
- Session key has expiry (30 days) — user can also revoke on-chain at any time
- User trust model: "I grant Toru a bounded permission. I can revoke it anytime. Toru cannot exceed my policy limits."

**What changes:**
- `SmartAccountExecutor` implements `Executor`
- `execution_permissions` table created — tracks session key address and expiry
- `execution_accounts.account_type` = `SMART_ACCOUNT` for these users
- Onboarding adds a "Connect Smart Account" path alongside "Create TWAK Wallet"
- `executor-factory.ts` routes to correct executor based on account type

**What does NOT change:**
- `ExecutionEngine` — still zero modifications
- Everything above the Executor interface — untouched

---

## Policy Layer — Runs Across Both Versions

```
Trade Recommendations (from DecisionEngine)
  ↓
PolicyEngine.evaluate(order, policy)
  ├── BLOCKED → policy_violations log, order CANCELLED
  └── APPROVED → Executor.execute(order)
```

The `PolicyEngine` is injected into `ExecutionEngine` as an optional dependency. It applies identically for both `TwakExecutor` and `SmartAccountExecutor` — the Executor never sees a blocked trade.

```
V1 (TWAK)       V2 (Smart Account)
     │                  │
     ▼                  ▼
execution_policies (shared table, same schema)
     │                  │
     ▼                  ▼
PolicyEngine.evaluate() (same code, same logic)
     │                  │
     ▼                  ▼
TwakExecutor    SmartAccountExecutor
```

---

## Migration Path at Each Phase

### Now (Pre-8B)

```
MockExecutor (hardcoded in orchestrator)
agentWallet = string from config
```

### After Phase 8B

```
TwakExecutor (selected from execution_accounts.account_type)
agentWallet = execution_accounts.wallet_address
execution_policies enforced
```

### After Phase 8C

```
executor-factory.ts selects TwakExecutor OR SmartAccountExecutor
execution_permissions tracks session key state
Onboarding supports both paths
```

### After Phase V2 (future)

```
FK constraints added to execution_orders, agent_positions → execution_accounts
Multi-account per user (multiple concurrent strategies)
WalletConnectExecutor for power users
```

---

## The Intelligence Layer Is Insulated

At no point in this evolution does any of the following change:

| Layer | Stays Untouched |
|---|---|
| `indexer/` | ✅ BSC polling, trade ingestion |
| `wallet_metrics`, `wallet_scores` | ✅ Behavioral scoring |
| `token_metrics`, `smart_money_signals` | ✅ Signal generation |
| `DecisionEngine` | ✅ Signal evaluation, recommendation creation |
| `RiskEngine` | ✅ Portfolio risk assessment |
| `ExecutionEngine` | ✅ Order lifecycle, position registry |
| `Executor` interface | ✅ The seam — never changes |

The intelligence layer doesn't know or care whether the downstream executor is a mock, a TWAK wallet, an ERC-4337 account, or a multisig Safe. It produces a recommendation. The executor handles the rest.

---

## Summary Table

| Phase | Executor | Account Type | Custodial | User Trust Model |
|---|---|---|---|---|
| 8A (today) | MockExecutor | — | N/A | Test only |
| 8B | TwakExecutor | TWAK_AGENT | Yes | Trust Toru + TWAK |
| 8C | SmartAccountExecutor | SMART_ACCOUNT | No | Grant bounded session key |
| 8C+ | WalletConnectExecutor | WALLETCONNECT | No | Sign each tx manually |
| V2 | All above | Multi-account | Mixed | User chooses per account |

---

## New Docs in This Batch

| Document | Purpose |
|---|---|
| `EXECUTION_ACCOUNTS.md` | Schema, lifecycle, and migration path for the execution_accounts table |
| `EXECUTION_POLICIES.md` | Policy system design — schema, validation rules, enforcement flow |
| `SMART_ACCOUNT_VISION.md` | Comparison of Safe / ERC-4337 / session keys / delegation with recommendation |
| `EXECUTOR_ARCHITECTURE.md` | Review of existing Executor interface, future implementors, and suggested improvements |
| `V2_DATABASE_PLAN.md` | All new tables with full SQL, relationships, and phased migration strategy |
