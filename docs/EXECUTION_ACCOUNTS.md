# Execution Accounts — Design Document

**Status:** Design only. No implementation exists yet.  
**Phase:** Pre-8B planning. Implementation begins in Phase 8B (TWAK) and Phase 8C (Smart Account).

---

## What Is an Execution Account?

An execution account is the on-chain identity through which Toru submits trades. Today this is a single `agentWallet` address hard-coded into `ExecutionEngineConfig`. The execution account abstraction replaces that hardcoded address with a structured record that tracks:

- **Who owns it** (user or Toru system)
- **What type it is** (TWAK, Smart Account, WalletConnect)
- **Its lifecycle state** (PENDING → ACTIVE → SUSPENDED → REVOKED)
- **The wallet address** it controls or delegates from

---

## Proposed Schema

```sql
CREATE TABLE execution_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  user_id         VARCHAR(255),                -- NULL for system/agent-owned accounts (TWAK V1)
  agent_id        VARCHAR(50) NOT NULL,        -- Stable agent identifier (survives wallet rotation)

  -- Account type
  account_type    VARCHAR(30) NOT NULL,        -- See types below
  wallet_address  VARCHAR(42) NOT NULL,        -- The on-chain address

  -- Lifecycle
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',

  -- Metadata (JSONB for type-specific data)
  metadata        JSONB,

  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (agent_id, wallet_address)
);
```

### Account Types

| `account_type` | Description |
|---|---|
| `TWAK_AGENT` | TWAK-managed agent wallet. Toru controls keys via TWAK SDK. User has no direct key access. |
| `SMART_ACCOUNT` | ERC-4337 smart account or Safe. Toru acts as a session key / delegated module. User retains ownership. |
| `WALLETCONNECT` | User's external wallet connected via WalletConnect. Toru submits transactions; user signs each one. |

### Status Lifecycle

```
PENDING ──► ACTIVE ──► SUSPENDED ──► REVOKED
              │                          ▲
              └──────────────────────────┘
                    (direct revoke)
```

| Status | Meaning |
|---|---|
| `PENDING` | Account created but not yet funded or verified |
| `ACTIVE` | Ready to execute trades |
| `SUSPENDED` | Temporarily paused (risk limit hit, user pause) |
| `REVOKED` | Permanently deactivated (user requested or security event) |

### Metadata (JSONB — type-specific)

**TWAK_AGENT:**
```json
{
  "twakAgentId": "toro-agent-001",
  "registeredAt": "2026-06-19T00:00:00Z",
  "network": "bsc-mainnet"
}
```

**SMART_ACCOUNT:**
```json
{
  "delegationType": "session-key",
  "sessionKeyAddress": "0x...",
  "sessionExpiry": "2026-07-19T00:00:00Z",
  "moduleAddress": "0x...",
  "ownerAddress": "0x..."
}
```

**WALLETCONNECT:**
```json
{
  "wcTopic": "abc123",
  "connectedAt": "2026-06-19T00:00:00Z",
  "chainId": 56
}
```

---

## Ownership Model

### V1 — TWAK_AGENT (Custodial)

```
Toru System
  └── TWAK SDK
        └── Agent Wallet (Toru holds keys)
              └── BSC Swaps
```

- `user_id` is NULL — the account belongs to the Toru system
- User authorizes Toru to trade on their behalf via the onboarding flow
- No on-chain delegation; Toru simply controls the private key via TWAK
- Risk: user must trust Toru with execution authority

### V2 — SMART_ACCOUNT (Non-Custodial)

```
User's Smart Account (user holds keys)
  └── Delegates to Toru Session Key / Module
        └── Toru executes within policy constraints
              └── BSC Swaps
```

- `user_id` is set — the account belongs to the user
- Toru never holds the user's private key
- Trading authority is revokable on-chain by the user at any time
- Toru's permissions are bounded by `execution_policies` (see `EXECUTION_POLICIES.md`)

---

## Lifecycle

### TWAK_AGENT Onboarding Flow

```
1. User completes onboarding wizard
2. Toru calls TWAK SDK: createAgentWallet(userId, config)
3. TWAK returns wallet_address
4. INSERT execution_accounts (account_type=TWAK_AGENT, status=PENDING, ...)
5. User funds the wallet (minimum balance check)
6. UPDATE execution_accounts SET status='ACTIVE'
7. ExecutionEngine uses this account's wallet_address for all orders
```

### SMART_ACCOUNT Onboarding Flow (Phase 8C+)

```
1. User connects existing Safe or ERC-4337 account
2. Toru generates a session key (ephemeral keypair)
3. User signs a delegation transaction (grants session key trading scope)
4. INSERT execution_accounts (account_type=SMART_ACCOUNT, status=PENDING, metadata={...})
5. Delegation confirmed on-chain
6. UPDATE execution_accounts SET status='ACTIVE'
7. ExecutionEngine uses session key to submit transactions
```

### Suspension

Triggered by:
- Risk engine: drawdown exceeds configured limit
- Policy engine: daily loss limit breached
- User: manual pause from settings UI

```sql
UPDATE execution_accounts
SET status = 'SUSPENDED', updated_at = NOW()
WHERE agent_id = $1 AND status = 'ACTIVE';
```

### Revocation

Triggered by:
- User: "Stop trading" / "Close agent"
- For SMART_ACCOUNT: user also calls `revokeSessionKey()` on-chain

```sql
UPDATE execution_accounts
SET status = 'REVOKED', updated_at = NOW()
WHERE id = $1;
```

---

## Migration Path: V1 → V2

The `agentWallet` field in `execution_orders`, `portfolio_state`, and `agent_positions` maps directly to `execution_accounts.wallet_address`. Migration is additive:

1. Create `execution_accounts` table (no existing data changes)
2. Backfill one row for the existing agent wallet:
   ```sql
   INSERT INTO execution_accounts (agent_id, account_type, wallet_address, status, user_id)
   VALUES ('toro-agent-001', 'TWAK_AGENT', '0x1111...', 'ACTIVE', NULL);
   ```
3. Update `ExecutionEngineConfig` to look up `wallet_address` from `execution_accounts` instead of using hardcoded config
4. Existing `agentWallet` columns in other tables remain valid — they are wallet addresses, unchanged

No existing tables need schema changes. The new table is purely additive.

---

## What the ExecutionEngine Needs to Change

Currently:
```typescript
const engine = new ExecutionEngine({ agentId: 'toro-agent-001', agentWallet: '0x...' }, executor)
```

After migration:
```typescript
const account = await ExecutionAccountRepository.getActive(agentId)
const engine = new ExecutionEngine({ agentId, agentWallet: account.wallet_address }, executor)
```

The engine internals are unchanged. Only the config source changes.

---

## Open Questions (Not Blocking Phase 8B)

1. **Multi-account per user:** Should one user be able to have multiple execution accounts (e.g. one for conservative strategy, one for aggressive)? If yes, `execution_policies` must reference `execution_account_id`, not just `agent_id`.

2. **Account rotation:** When a TWAK agent wallet is compromised, how is a replacement wallet created and the open positions migrated?

3. **Session key expiry:** SMART_ACCOUNT session keys have an expiry. The system needs to proactively renew or warn the user before expiry.
