# Multi-Tenant Foundation

> Phase 8B.25 — Database and ownership layer. No auth, no sessions, no route protection.

---

## Current State (V1 — Single Operator)

```
Default Operator  (users.id = '00000000-0000-0000-0000-000000000001')
    │
    └── Default Agent  (agents.id = 'toro-agent-001')
            │
            └── TWAK Execution Account  (execution_accounts)
                    wallet: 0x7b88265003435117d8d1adea0cf30fd359474e9b
                    chain:  BSC Mainnet
```

The API routes (`/api/agents/[id]/wallet`, `/api/agents/[id]/readiness`, etc.)
continue to use the `toro-agent-001` slug directly. No frontend change is required.

---

## Target State (V2 — Multi-User)

```
User A ──┬── Agent A1 ── Execution Account (TWAK wallet)
         └── Agent A2 ── Execution Account (TWAK wallet)

User B ──── Agent B1 ── Execution Account (TWAK wallet)
```

Each user can create multiple agents. Each agent has one active execution account
(one TWAK wallet on BSC). Future account types (`SMART_ACCOUNT`, `WALLETCONNECT`)
extend the `execution_accounts.account_type` enum without schema changes.

---

## ER Diagram

```
┌─────────────────────────────┐
│ users                       │
│─────────────────────────────│
│ id            varchar(36) PK│ ← UUID
│ email         varchar(255)  │ ← nullable, unique
│ wallet_address varchar(42)  │ ← identity wallet (NOT trading wallet)
│ display_name  varchar(100)  │
│ privy_id      varchar(255)  │ ← reserved, see §Future Auth
│ created_at    timestamp     │
│ updated_at    timestamp     │
└──────────────┬──────────────┘
               │ 1
               │
               │ N
┌──────────────▼──────────────┐
│ agents                      │
│─────────────────────────────│
│ id            varchar(50) PK│ ← 'toro-agent-001' for default
│ user_id       varchar(36)   │ → users.id
│ name          varchar(100)  │
│ risk_level    varchar(20)   │ ← CONSERVATIVE | BALANCED | AGGRESSIVE
│ trading_mode  varchar(20)   │ ← AUTONOMOUS | ASSISTED
│ status        varchar(20)   │ ← ACTIVE | PAUSED | ARCHIVED
│ created_at    timestamp     │
│ updated_at    timestamp     │
└──────────────┬──────────────┘
               │ 1
               │
               │ N
┌──────────────▼──────────────┐
│ execution_accounts          │
│─────────────────────────────│
│ id             varchar(36) PK│
│ agent_id       varchar(50)   │ → agents.id
│ user_id        varchar(36)   │ → users.id  (denormalised for fast lookup)
│ account_type   varchar(30)   │ ← TWAK_AGENT | SMART_ACCOUNT | WALLETCONNECT
│ wallet_address varchar(42)   │ ← BSC execution wallet
│ status         varchar(20)   │ ← PENDING | ACTIVE | SUSPENDED | REVOKED
│ metadata       jsonb         │ ← type-specific config + legacy agentName/riskLevel
│ created_at     timestamp     │
│ updated_at     timestamp     │
└─────────────────────────────┘
```

> **Note on `user_id` denormalisation**: `execution_accounts.user_id` mirrors
> `agents.user_id`. This avoids a join in hot paths (e.g. balance checks, readiness).
> It is backfilled on write and must be kept in sync when an agent changes owner
> (not a V1 concern).

---

## Seeded Default Records

| Table                | id                                     | Notes                              |
|----------------------|----------------------------------------|------------------------------------|
| `users`              | `00000000-0000-0000-0000-000000000001` | "Default Operator"                 |
| `agents`             | `toro-agent-001`                       | config lifted from metadata at migration time |
| `execution_accounts` | (existing row)                         | `user_id` backfilled to above UUID |

---

## Future Auth — Privy Integration Path

When Privy is wired in, no schema rewrite is needed. The path is:

```
privy_user_id  (Privy JWT claim)
    │
    ▼
users.privy_id  (already exists, populated on first Privy login)
    │
    ▼
users.id  (UUID — stable internal key throughout the system)
    │
    ▼
agents.user_id  →  execution_accounts.user_id
```

**Implementation steps (future PR, not this one):**
1. Add a Privy middleware that reads the JWT and looks up `users` by `privy_id`.
2. If not found, insert a new user row (Privy handles dedup).
3. Replace the hardcoded `AGENT_ID = 'toro-agent-001'` in each route with the
   authenticated user's agent list fetched via `AgentsRepository.getByUserId()`.
4. Route protection is added at the middleware level — the repository layer already
   supports multi-user because `user_id` is a first-class column everywhere.

The default operator row (`00000000-…-0001`) will remain as the system account
for automated processes and the single-operator deployment mode.

---

## What Was NOT Changed

- No API route signatures changed.
- No frontend component changed.
- No execution engine logic changed.
- No TWAK integration changed.
- The `execution_accounts.metadata` JSONB column is preserved as-is (backward compat).
- The existing `toro-agent-001` agent ID continues to work in all routes.

---

## Migration Files

| File | Purpose |
|------|---------|
| `drizzle/0014_users.sql` | Create `users` table |
| `drizzle/0015_agents.sql` | Create `agents` table |
| `drizzle/0016_multi_tenant_backfill.sql` | Seed default user + agent; backfill `execution_accounts.user_id` |
| `scripts/apply-0014-multi-tenant-foundation.ts` | Apply all three in sequence (idempotent) |

---

## Repository Layer

| Class | Location | Methods |
|-------|----------|---------|
| `UsersRepository` | `packages/db/src/repositories/users-repository.ts` | `create`, `getById`, `getByEmail`, `getByWalletAddress`, `getByPrivyId`, `update` |
| `AgentsRepository` | `packages/db/src/repositories/agents-repository.ts` | `create`, `getById`, `getByAgentId`, `getByUserId`, `update` |

Both are exported from `@toro/db` (via `packages/db/src/client.ts`).
