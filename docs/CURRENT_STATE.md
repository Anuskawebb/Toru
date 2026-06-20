# Toru — Current State Audit

> Generated: 2026-06-20. Read-only audit of the `main` branch post-PR #6 merge.
> This document describes what **exists today** — not what is planned.

---

## 1. Product Overview

**What Toru Currently Is:**
Toru is a decentralized autonomous agent platform for copy-trading on BSC. It allows users to deploy AI-driven agents that monitor smart-money wallet activity and execute copy-trades autonomously within configurable risk parameters.

**Problem It Solves:**
Enables non-technical users to follow institutional on-chain flows without managing private keys. TWAK handles custody; users configure risk profiles and the agent handles execution.

**Current User Journey (Landing → Active Agent):**
```
1. User visits landing page → clicks "Launch Terminal"
2. Logs in via Privy (wallet or email/social)
3. Provision endpoint creates users row (privy_id, email, display_name)
4. AuthGate detects onboarding_completed=false → redirects /onboarding
5. Onboarding (5 steps, ~90 seconds):
   Step 1: username + display name + avatar upload
   Step 2: trading experience (BEGINNER | INTERMEDIATE | ADVANCED)
   Step 3: trading goal (CAPITAL_PRESERVATION | BALANCED_GROWTH | AGGRESSIVE_GROWTH | SPECULATIVE)
   Step 4: risk tolerance (LOW | MEDIUM | HIGH) + trading preference (MANUAL | ASSISTED | AUTONOMOUS)
   Step 5: capital range (UNDER_100 | 100_TO_1000 | OVER_1000) → saves all fields, marks onboarding_completed=true
6. Redirect → /execution-center
7. User creates agent: POST /api/agents → agents row (status=DRAFT)
8. User provisions wallet: POST /api/agents/[id]/wallet → TWAK address, execution_accounts row created, agent → PENDING_FUNDING
9. User sends BNB to wallet address on BSC
10. Frontend polls balance every 5-10s; when ≥ MIN_REQUIRED_BNB → funded=true
11. User clicks Activate → POST /api/agents/[id]/activate → agent status → ACTIVE
12. Agent is live (execution is currently MockExecutor)
```

**Current Architecture:**

| Service | Location | Role |
|---------|----------|------|
| Next.js Client | `client/` | Privy auth, onboarding, agent management UI |
| TWAK Sidecar | external (HTTP) | Custodial wallet: address, balance, portfolio, swap |
| Database | PostgreSQL via `packages/db/` | 20+ tables; persistent state |
| Agent Core | `packages/agent-core/` | ExecutionEngine, DecisionEngine, PositionRegistry |
| Watcher | `watcher/` | Polls Mantle RPC, scores trades via Claude Haiku, executes copy-trades |
| Indexer | `indexer/` | Polls BSC, ingests swap events into `trades` table |
| Analytics Worker | `analytics-worker/` | Rebuilds wallet_scores, token_metrics, smart_money_signals every 60s |
| Landing | `landing/` | Marketing page (separate Next.js app) |

---

## 2. Authentication

**Auth Provider:** Privy (`@privy-io/react-auth` + `@privy-io/node`)

**User Model — Exact DB Columns:**
```sql
users (
  id                   varchar(36) PRIMARY KEY,   -- randomUUID() from client
  email                varchar(255) UNIQUE,        -- nullable
  wallet_address       varchar(42) UNIQUE,         -- nullable (Privy custodial wallet)
  display_name         varchar(100),
  privy_id             varchar(255),               -- partial unique index WHERE privy_id IS NOT NULL
  profile_image_url    varchar(255),               -- uploaded to Vercel Blob
  username             varchar(30) UNIQUE,         -- set during onboarding
  experience           varchar(20),                -- BEGINNER | INTERMEDIATE | ADVANCED
  goals                varchar(30),                -- CAPITAL_PRESERVATION | BALANCED_GROWTH | AGGRESSIVE_GROWTH | SPECULATIVE
  risk_tolerance       varchar(10),                -- LOW | MEDIUM | HIGH
  trading_preference   varchar(20),                -- MANUAL | ASSISTED | AUTONOMOUS
  capital_range        varchar(15),                -- UNDER_100 | 100_TO_1000 | OVER_1000
  onboarding_completed boolean DEFAULT false,
  created_at           timestamp DEFAULT now(),
  updated_at           timestamp DEFAULT now()
)
```

**Session Management:**
- Stateless JWT — Privy issues access token per session
- Client passes `Authorization: Bearer <token>` on every API call
- Server validates via `PrivyClient.utils().auth().verifyAccessToken(token)` → extracts `claims.user_id` (Privy ID)
- `getAuthUser()` in `client/lib/server-auth.ts` resolves to DB row

**Login Methods Supported:**
- Privy-managed Web3 wallets (MetaMask, WalletConnect, etc.)
- Email (magic link)
- Google OAuth (email + name extracted from `user.google`)
- Twitter (profile image extracted from `user.twitter.profilePictureUrl`)
- Other Privy-supported providers (Discord, Apple) — not extracting profile data, but auth works

**User Provisioning Flow (step by step from `provision/route.ts`):**
1. Privy JWT received in `Authorization` header
2. `verifyPrivyToken()` → extracts `privyUserId`
3. Optional body: `{ email, displayName, profileImageUrl }`
4. `SELECT FROM users WHERE privy_id = privyUserId`
5. **If found:** COALESCE UPDATE (doesn't overwrite existing values); return `{ userId, onboardingCompleted, username }`
6. **If not found:**
   - Check email conflict: `SELECT FROM users WHERE email = resolvedEmail` — if conflict, set email to null
   - Plain `INSERT` (no ON CONFLICT — partial unique index prevents it)
   - Return `{ userId, onboardingCompleted: false, username: null }`
7. AuthContext stores result, sets `loading: false`
8. AuthGate routes based on `onboardingCompleted`

---

## 3. Onboarding

**Each Step:**

| Step | Route | Data Collected | Storage |
|------|-------|---------------|---------|
| 1 | `/onboarding/step-1` | username (unique), display_name, profile_image_url | OnboardingContext; avatar posted to `/api/me/avatar` → Vercel Blob |
| 2 | `/onboarding/step-2` | experience | OnboardingContext |
| 3 | `/onboarding/step-3` | goals | OnboardingContext |
| 4 | `/onboarding/step-4` | risk_tolerance, trading_preference | OnboardingContext |
| 5 | `/onboarding/step-5` | capital_range | OnboardingContext; PATCH `/api/me/profile` saves everything; sets `onboarding_completed=true` |
| 6 | `/onboarding/step-6` | — | Redirect to `/execution-center` |

**Where Data Is Stored:**
- All onboarding fields live in `users` row (single table)
- Avatar image: Vercel Blob (`avatars/{userId}.{ext}`) — URL stored in `profile_image_url`
- Completion marked atomically with profile save via `PATCH /api/me/profile`

**What Happens After Completion:**
- `markOnboardingComplete()` called in AuthContext
- AuthGate no longer redirects to `/onboarding`
- Execution Center becomes accessible

**Implemented vs Mocked:**
- ✓ IMPLEMENTED: All 5 steps, form validation, step navigation
- ✓ IMPLEMENTED: Username uniqueness check (`/api/users/check-username`, debounced)
- ✓ IMPLEMENTED: Avatar upload (POST `/api/me/avatar` → Vercel Blob → `updateProfileImage()`)
- ✓ IMPLEMENTED: Profile save with conflict resolution (username + email uniqueness)
- ✓ IMPLEMENTED: Onboarding gate (AuthGate + AuthContext loading state)
- ✗ NOT IMPLEMENTED: Onboarding data used to filter/personalize signals or recommendations
- ✗ NOT IMPLEMENTED: Email verification step
- ✗ NOT IMPLEMENTED: "Skip for now" option that still creates a user

---

## 4. Agent System

**Agent DB Schema (Exact Columns):**
```sql
agents (
  id            varchar(50) PRIMARY KEY,       -- 'agent-{8 hex chars}'
  user_id       varchar(36) NOT NULL,           -- FK to users.id
  name          varchar(100) NOT NULL,
  risk_level    varchar(20) DEFAULT 'BALANCED', -- CONSERVATIVE | BALANCED | AGGRESSIVE
  trading_mode  varchar(20) DEFAULT 'AUTONOMOUS', -- AUTONOMOUS | ASSISTED
  status        varchar(20) DEFAULT 'ACTIVE',  -- schema default; POST route inserts 'DRAFT'
  created_at    timestamp DEFAULT now(),
  updated_at    timestamp DEFAULT now()
)
```

⚠️ **Schema inconsistency:** The `agents` table defaults status to `'ACTIVE'` but the POST route hardcodes `status='DRAFT'`. The schema default is never used.

**Agent Creation Flow:**
1. `POST /api/agents` — authenticated user sends `{ name, riskLevel?, tradingMode? }`
2. Validates name non-empty, riskLevel ∈ `['CONSERVATIVE','BALANCED','AGGRESSIVE']`, tradingMode ∈ `['AUTONOMOUS','ASSISTED']`
3. Generates `agentId = 'agent-' + Math.random().toString(16).slice(2,10)` ⚠️ non-cryptographic
4. `INSERT INTO agents (status='DRAFT')`
5. Returns `{ agentId, name, status: 'DRAFT', riskLevel, tradingMode }` + 201

**Ownership Model:**
- `agents.user_id` set at creation to authenticated user's DB ID
- All `/api/agents/[id]/*` routes use `requireAgentOwnership(agentId, userId)` — queries `WHERE id=? AND user_id=?`, returns 403 if not found

**Can a User Have Multiple Agents?**
- ✓ YES — `agents.user_id` is not unique; schema supports N agents per user
- `GET /api/agents` queries `WHERE user_id=userId AND status != 'ARCHIVED'` — returns all
- No server-side limit enforced

**Agent Status Lifecycle:**
```
DRAFT               (created by POST /api/agents)
  ↓
PENDING_FUNDING     (auto-transition in POST /api/agents/[id]/wallet)
  ↓
ACTIVE              (POST /api/agents/[id]/activate after funding confirmed)
  ↓
PAUSED              (no route implemented)
  ↓
ARCHIVED            (no route implemented; GET excludes these)
```

---

## 5. Execution Accounts

**Schema (Exact Columns):**
```sql
execution_accounts (
  id              varchar(36) PRIMARY KEY,
  agent_id        varchar(50) NOT NULL,       -- FK to agents.id (no DB-level FK constraint)
  user_id         varchar(255),               -- nullable
  account_type    varchar(30) NOT NULL,       -- TWAK_AGENT | SMART_ACCOUNT | WALLETCONNECT
  wallet_address  varchar(42) NOT NULL,
  status          varchar(20) DEFAULT 'PENDING', -- PENDING | ACTIVE | SUSPENDED | REVOKED
  metadata        jsonb,                      -- { chain, agentName, riskLevel, tradingMode, twakAgentId, sessionKey }
  created_at      timestamp DEFAULT now(),
  updated_at      timestamp DEFAULT now(),
  UNIQUE (agent_id, wallet_address)
)
```

**Status Lifecycle:**
```
PENDING   (created in POST /api/agents/[id]/wallet — but note: route hardcodes 'ACTIVE' on insert)
  ↓
ACTIVE    (auto on balance check detecting funded=true OR hardcoded on creation)
  ↓
PENDING   (auto if balance drops below MIN_REQUIRED_BNB — detected in readiness route)
  ↓
SUSPENDED (no route implemented)
  ↓
REVOKED   (no route implemented)
```

⚠️ **Bug:** `POST /api/agents/[id]/wallet` creates execution_account with `status='ACTIVE'` (hardcoded), but logical initial status should be `PENDING` (wallet not yet funded). The readiness check then correctly treats unfunded wallets as not ready.

**Relationship to Agents and Users:**
- 1:1 per agent (unique constraint on `agent_id, wallet_address`)
- `user_id` nullable; currently populated with agent's user_id on creation
- No direct user → execution_accounts path; goes through agents

**How They Are Created:**
1. `POST /api/agents/[id]/wallet`
2. Check ownership via `requireAgentOwnership`
3. If row exists: return it (idempotent)
4. Call `twakGetAddress()` → if TWAK unreachable → 503
5. `INSERT INTO execution_accounts (account_type='TWAK_AGENT', status='ACTIVE')`
6. `UPDATE agents SET status='PENDING_FUNDING' WHERE status='DRAFT'`

---

## 6. TWAK Integration

### IMPLEMENTED

| Function | File | What It Does |
|----------|------|-------------|
| `twakIsReachable()` | `client/lib/twak.ts:32` | GET /health, returns boolean |
| `twakGetAddress()` | `client/lib/twak.ts:41` | POST /actions/create_wallet, returns `{ address }` |
| `twakGetBalance()` | `client/lib/twak.ts:50` | POST /actions/wallet_balance, parses wei `{ available, total }` → BNB float |
| `twakGetPortfolio()` | `client/lib/twak.ts:81` | POST /actions/portfolio, returns token holdings array |
| `TwakClient.getWalletStatus()` | `packages/agent-core/.../twak-client.ts:66` | GET wallet status |
| `TwakClient.getSwapQuote()` | `packages/agent-core/.../twak-client.ts:137` | Pre-swap quote |
| `TwakClient.getTokenPrice()` | `packages/agent-core/.../twak-client.ts:155` | Live token price from TWAK oracle |
| `TwakClient.swap()` | `packages/agent-core/.../twak-client.ts:117` | Execute swap (fromToken → toToken, amount, slippage) |

**TWAK balance parsing (wei-aware):**
```typescript
const rawWei = balance.available ?? balance.total ?? '0'
const raw = parseFloat(rawWei)
const bnb = raw > 1e12 ? raw / 1e18 : raw   // convert wei → BNB
```

### PARTIALLY IMPLEMENTED

| Feature | Status |
|---------|--------|
| TwakExecutor (swap execution) | Fully implemented in `packages/agent-core`; **not wired** into ExecutionEngine (still uses MockExecutor) |
| BNB price resolution | Implemented: DB first → TWAK oracle → throws. No hardcoded fallback (correct by design) |

### NOT IMPLEMENTED

| Feature | Notes |
|---------|-------|
| ERC-4337 smart accounts | Schema type `SMART_ACCOUNT` exists; no creation logic |
| WalletConnect integration | Schema type `WALLETCONNECT` exists; no creation logic |
| Account rotation | No route to replace execution_account for an existing agent |
| Gas estimation | No API call for gas prediction before swap |

---

## 7. Funding Flow

**UX Steps:**
1. Agent created (DRAFT)
2. User clicks "Set Up Wallet" → `POST /api/agents/[id]/wallet` → TWAK address returned
3. UI shows deposit address + QR code; user sends BNB to address on BSC
4. Frontend polls `GET /api/agents/[id]/wallet/balance` every 5-10 seconds
5. Balance endpoint auto-updates `execution_accounts.status` to ACTIVE when funded
6. Frontend detects `funded=true`, enables "Activate Agent" button
7. User clicks Activate → `POST /api/agents/[id]/activate`
8. Backend: verifies `agents.status=PENDING_FUNDING`, checks balance ≥ min → `UPDATE agents SET status='ACTIVE'`

**MIN_REQUIRED_BNB:**
```typescript
// client/lib/readiness.ts:6
export const MIN_REQUIRED_BNB = parseFloat(process.env.MIN_REQUIRED_BNB ?? '0.005')
```
- Env var: `MIN_REQUIRED_BNB` (`.env.local` set to `0.001` for testing)
- Production default: `0.005` BNB
- Used in: balance route, activate route, readiness route, frontend display

**State Transitions on Funding:**
```
execution_accounts.status:    PENDING → ACTIVE    (auto via balance route)
agents.status:                unchanged           (still PENDING_FUNDING until /activate)
readiness.walletFunded:       false → true        (derived at request time)
readiness.readyForTrading:    false → true        (when walletCreated + walletFunded + twakConnected)
```

After `POST /api/agents/[id]/activate`:
```
agents.status:  PENDING_FUNDING → ACTIVE
```

---

## 8. Execution Engine

**MockExecutor** (`packages/agent-core/src/execution/mock-executor.ts`):
- Returns `{ success: true, txHash: 'mock_tx_${orderId}' }` immediately
- No network calls; deterministic
- **Currently used in production**

**TwakExecutor** (`packages/agent-core/src/execution/twak-executor.ts`):
- `executeBuy()`: resolves BNB price → calculates BNB amount → calls `TwakClient.swap(BNB → token)`
- `executeSell()`: resolves entry price → calculates token amount → calls `TwakClient.swap(token → BNB)`
- `resolveBnbPrice()`: DB (`PriceService`) → TWAK oracle → throws (no hardcoded fallback)
- **Fully implemented but NOT wired into ExecutionEngine**

**ExecutionEngine** (`packages/agent-core/src/execution/execution-engine.ts`):
- `createOrders(plans, recommendations)` → inserts PENDING `execution_orders` rows
- `processOrders()`:
  1. Fetch PENDING orders from DB
  2. For each order: PENDING → PROCESSING → call `executor.execute()` → FILLED/FAILED
  3. On FILLED: open/close `agent_positions`, insert `execution_transactions`, mark recommendation EXECUTED
  4. Returns `{ ordersProcessed, ordersFilled, ordersFailed, positionsOpened, positionsClosed, durationMs }`
- Executor-agnostic (takes executor via constructor injection)
- **Wire TwakExecutor here to go live**

| Component | Status |
|-----------|--------|
| MockExecutor | ✓ Working, in production |
| TwakExecutor | ✓ Implemented, NOT wired |
| ExecutionEngine orchestration | ✓ Working |
| Order state machine (PENDING→PROCESSING→FILLED/FAILED) | ✓ Working |
| Position tracking (open/close) | ✓ Working |
| Transaction logging | ✓ Working |

---

## 9. Policy System

**Tables:** None found in any migration file.

**APIs:** None found in `client/app/api/`.

**Code implementation:** None found in `packages/agent-core/`.

**Current state:** Design-only. Referenced in `MULTI_TENANT_FOUNDATION.md` and architecture docs.

| Layer | Status |
|-------|--------|
| DB schema (tables) | ✗ Does not exist |
| API routes | ✗ Does not exist |
| Engine enforcement | ✗ Does not exist |
| User risk_tolerance stored | ✓ Stored in users row (not yet read by engine) |
| agents.risk_level stored | ✓ Stored in agents row (not yet read by engine) |

---

## 10. Database State

| Table | Status | Used By |
|-------|--------|---------|
| `users` | ✅ Active | auth-context, provision route, profile route, onboarding |
| `agents` | ✅ Active | agents CRUD routes, ownership middleware |
| `execution_accounts` | ✅ Active | wallet route, balance route, readiness route, activate route |
| `execution_orders` | ✅ Active | ExecutionEngine (create + process orders) |
| `execution_transactions` | ✅ Active | ExecutionEngine (audit trail on FILLED) |
| `agent_positions` | ✅ Active | ExecutionEngine (open/close positions), pnl-updater |
| `trade_recommendations` | ✅ Active | DecisionEngine writes; ExecutionEngine marks EXECUTED |
| `trades` | ✅ Active | Indexer writes; watcher reads for scoring |
| `tokens` | ✅ Active | Indexer writes token metadata |
| `wallet_scores` | ✅ Active | Analytics-worker writes; `/api/traders` reads |
| `wallet_metrics` | ✅ Active | Analytics-worker writes |
| `smart_money_signals` | ✅ Active | Analytics-worker writes; DecisionEngine reads |
| `token_metrics` | ✅ Active | Analytics-worker writes |
| `token_prices` | ✅ Active | Watcher/indexer writes; TwakExecutor reads via PriceService |
| `indexer_state` | ✅ Active | Indexer reads/writes (last processed block) |
| `analytics_runs` | ✅ Active | Analytics-worker writes; landing health API reads |
| `agent_token_watchlist` | ⚠️ Partial | Schema + migration exist; no API routes read/write it yet |
| `agent_trader_watchlist` | ⚠️ Partial | Schema + migration exist; no API routes read/write it yet |
| `portfolio_state` | ⚠️ Partial | Schema exists; pnl-updater may write; `/api/portfolio` is a stub |
| `portfolio_snapshots` | ⚠️ Partial | Schema exists; minimal usage |
| `wallet_positions` | ⚠️ Partial | Written on position close; not surfaced to frontend |
| `price_observations` | ⚠️ Partial | Schema exists; minimal writes |
| `token_discovery_queue` | ⚠️ Partial | Indexer enqueues new tokens; resolution worker unclear |
| `token_intel_snapshots` | 🔴 Planned | Schema exists; no writes found |

---

## 11. Frontend State

| Route | Status | Notes |
|-------|--------|-------|
| `/` (root) | ⚠️ Partial | Redirects to execution center or shows dashboard scaffold; chart data is placeholder |
| `/onboarding` | ✅ Complete | Welcome screen + 5-step flow |
| `/onboarding/step-1` | ✅ Complete | Username, display name, avatar upload |
| `/onboarding/step-2` | ✅ Complete | Experience level selection |
| `/onboarding/step-3` | ✅ Complete | Goal selection |
| `/onboarding/step-4` | ✅ Complete | Risk tolerance + trading preference |
| `/onboarding/step-5` | ✅ Complete | Capital range + profile save + redirect |
| `/onboarding/step-6` | ✅ Complete | Redirect only |
| `/execution-center` | ⚠️ Partial | System status hardcoded ("healthy"); order queue stub; agent list from API |
| `/agents/new` | ✅ Complete | 4-step wizard: name → risk level → trading mode → create |
| `/agents/[id]` | ✅ Complete | 4-step agent setup: wallet → fund → configure → activate |
| `/settings` | 🔴 Placeholder | Shell only |
| `/portfolio` | 🔴 Placeholder | Shell only |
| `/agent-marketplace` | 🔴 Placeholder | Shell only |
| `/agent-intelligence` | 🔴 Placeholder | Shell only |
| `/markets`, `/news`, `/nfts` | 🔴 Placeholder | Shell only |
| Landing (`landing/`) | ✅ Complete | Marketing page, separate Next.js app |

---

## 12. API Inventory

| Path | Method | Purpose | Status |
|------|--------|---------|--------|
| `/api/auth/provision` | POST | Create or update user row on login | ✅ Working |
| `/api/me/profile` | GET, PATCH | Get/update user profile + onboarding fields | ✅ Working |
| `/api/me/avatar` | POST | Upload avatar image to Vercel Blob | ✅ Working |
| `/api/users/check-username` | GET | Check username availability | ✅ Working |
| `/api/agents` | GET | List all non-archived agents for user | ✅ Working |
| `/api/agents` | POST | Create new agent (DRAFT) | ✅ Working |
| `/api/agents/[id]/wallet` | GET, POST | Create / get execution wallet (TWAK) | ✅ Working |
| `/api/agents/[id]/wallet/balance` | GET | Live BNB balance; auto-syncs execution_account status | ✅ Working |
| `/api/agents/[id]/wallet/portfolio` | GET | Token holdings from TWAK | ✅ Working |
| `/api/agents/[id]/activate` | POST | Transition agent PENDING_FUNDING → ACTIVE | ✅ Working |
| `/api/agents/[id]/readiness` | GET | Compute readiness state; auto-sync status | ✅ Working |
| `/api/agents/[id]/config` | GET | Agent token/trader config | ⚠️ Stub (returns empty arrays) |
| `/api/traders` | GET | Top traders from wallet_scores | ✅ Working (reads DB) |
| `/api/signals` | GET | Trade signals / smart money signals | ⚠️ Stub |
| `/api/execution-center` | GET | Dashboard stats + order queue | ⚠️ Partial (hardcoded health stats) |
| `/api/executions` | GET | Execution history | ⚠️ Stub |
| `/api/orders` | GET | Order list | ⚠️ Stub |
| `/api/portfolio` | GET | Portfolio summary | ⚠️ Stub |
| `/api/positions` | GET | Open positions | ⚠️ Stub |
| `/api/tokens/[address]` | GET | Token details | ⚠️ Stub |
| `/api/tokens/[address]/activity` | GET | Token trade activity | ⚠️ Stub |
| `/api/activity` | GET | General activity feed | ⚠️ Stub |
| `/api/system/health` | GET | Service health check | ⚠️ Stub |

---

## 13. Architecture Debt

### Hardcoded Values

| File | Issue | Impact |
|------|-------|--------|
| `client/lib/twak.ts:6` | `API_URL` defaults to `localhost:3000` | TWAK offline = all wallet ops fail |
| `client/app/api/agents/route.ts` | `Math.random()` for agent ID | Non-cryptographic; low collision risk but bad practice |
| `client/app/api/agents/[id]/wallet/route.ts` | `status='ACTIVE'` hardcoded on insert | Should be `PENDING`; contradicts status lifecycle |
| `client/app/execution-center/page.tsx` | System health + risk alerts hardcoded | Dashboard shows "healthy" even when services are down |
| `agents` schema | `DEFAULT 'ACTIVE'` but POST inserts `'DRAFT'` | Schema default is misleading |
| `indexer/src/index.ts` | Single hardcoded wallet address `0xd096705...` | Demo artifact; should be from DB or env |

### Missing Ownership Validation

| Route | Status |
|-------|--------|
| `/api/execution-center` | ⚠️ Returns system-wide stats; unclear if user-scoped |
| `/api/orders`, `/api/executions`, `/api/positions` | ⚠️ Stub routes — no auth check visible |

All `/api/agents/[id]/*` routes correctly use `requireAgentOwnership()`.

### Swallowed Errors

| File | Pattern | Risk |
|------|---------|------|
| `balance/route.ts` | `.catch(() => {})` on status update | DB write failure is silently ignored |
| `readiness/route.ts` | Same pattern | Status sync failure is silent |

### Mocked / Stub Systems

| System | State | Risk |
|--------|-------|------|
| Trade execution | MockExecutor — no real swaps | Users see "executed" trades that never happened on-chain |
| System health dashboard | All services hardcoded "healthy" | No visibility into real service outages |
| Portfolio P&L | `/api/portfolio` stub | Users cannot see actual performance |
| Trade signals API | `/api/signals` stub | Frontend signal display is non-functional |
| Agent config | `/api/agents/[id]/config` returns empty | Token + trader watchlists are not persisted or returned |
| Order queue display | `/api/execution-center` has hardcoded stats | Counts may be wrong |

### Single-Tenant Remnants

- `indexer/src/index.ts`: hardcoded single watched wallet (demo/test artifact)
- Execution Center dashboard not scoped to selected agent (shows system-wide)

---

## 14. Readiness Assessment

| Subsystem | Status | Notes |
|-----------|--------|-------|
| **Authentication** | 🟡 YELLOW | Privy + JWT validation solid; provision flow correct; no multi-session management |
| **User Provisioning** | 🟢 GREEN | Full flow: Privy → SELECT/INSERT → profile update |
| **Onboarding** | 🟢 GREEN | All 5 steps complete; avatar upload; uniqueness checks; profile save |
| **Agent Creation** | 🟢 GREEN | POST /api/agents; ownership enforced; validation correct |
| **Wallet Provisioning (TWAK)** | 🟢 GREEN | Address fetch, DB insert, agent status transition |
| **Balance Detection** | 🟢 GREEN | Live TWAK fetch; wei→BNB conversion; auto-status sync |
| **Agent Activation** | 🟢 GREEN | Balance check, status transition, ownership guard |
| **Trade Execution** | 🟡 YELLOW | MockExecutor working; TwakExecutor implemented but not wired |
| **Risk / Policy Enforcement** | 🔴 RED | Not implemented; risk_level stored but unused |
| **Portfolio P&L** | 🔴 RED | Tables exist; pnl-updater may write; no API surface |
| **Analytics Pipeline** | 🟡 YELLOW | Runs every 60s; wallet_scores + smart_money_signals populated; latency unknown |
| **Indexer** | 🟡 YELLOW | Ingests BSC swaps; single demo wallet hardcoded; real multi-wallet indexing untested |
| **Watcher** | 🟡 YELLOW | Polls Mantle, scores via Claude Haiku; copy-trade execution on-chain exists |
| **Token/Trader Config** | 🔴 RED | Watchlist tables exist; no API reads/writes them; config page is a stub |
| **System Health Monitoring** | 🔴 RED | Dashboard hardcoded; health API is a stub |

---

## 15. Recommended Next Priorities

Ranked by impact × risk reduction, based on what was found in the code.

### Priority 1 — Wire TwakExecutor into ExecutionEngine
**Why:** Every order currently executes as a mock. `TwakExecutor` is fully implemented and correct; it just needs to be injected.
**Files:**
- `packages/agent-core/src/execution/execution-engine.ts` — replace MockExecutor injection
- Create executor factory: `EXECUTOR_TYPE=MOCK|TWAK` env var
- Add integration test with mock TWAK sidecar
**Unblocks:** Real on-chain trade execution.

### Priority 2 — Implement `/api/portfolio` and `/api/positions`
**Why:** Users have no visibility into actual performance. `agent_positions` and `portfolio_state` tables are populated; the API just returns stubs.
**Files:**
- `client/app/api/portfolio/route.ts` — query portfolio_state for authenticated user's agent
- `client/app/api/positions/route.ts` — query agent_positions WHERE status='OPEN' for agent
- Add unrealized P&L = (current_price - entry_price) × quantity
**Unblocks:** Dashboard becomes real; users see actual P&L.

### Priority 3 — Implement Token/Trader Watchlist API
**Why:** `agent_token_watchlist` and `agent_trader_watchlist` tables exist with full schema. The configure step in the agent wizard is currently a stub — saving nothing.
**Files:**
- `client/app/api/agents/[id]/config/route.ts` — implement GET (read watchlists) + PUT (replace watchlists)
- Wire DecisionEngine to filter `smart_money_signals` by agent's trader watchlist
**Unblocks:** Agent configuration actually persists; DecisionEngine can respect user preferences.

### Priority 4 — Fix Execution Account Initial Status + System Health API
**Why:** Two correctness issues that are simple to fix but mask real state.
- `execution_accounts` created with `status='ACTIVE'` should be `status='PENDING'`
- System health dashboard hardcoded; should ping TWAK, DB, analytics-worker
**Files:**
- `client/app/api/agents/[id]/wallet/route.ts:~150` — change `'ACTIVE'` → `'PENDING'`
- `client/app/api/system/health/route.ts` — implement real health checks
- `client/app/execution-center/page.tsx` — consume real health API
**Unblocks:** Accurate state tracking; real observability.

### Priority 5 — Replace Math.random() Agent ID + Enforce Policy by Risk Level
**Why:** Two correctness/safety issues. Agent IDs should use `crypto.randomUUID()`. Risk level is stored but the DecisionEngine ignores it entirely — a HIGH-risk agent behaves identically to a CONSERVATIVE one.
**Files:**
- `client/app/api/agents/route.ts` — replace `Math.random()` with `crypto.randomUUID()` or a namespaced UUID
- `packages/agent-core/src/decision/decision-engine.ts` — read `agents.risk_level` and filter/weight recommendations accordingly (e.g., CONSERVATIVE skips signals with riskScore > threshold)
**Unblocks:** Correct agent IDs; risk level actually affects behavior.
