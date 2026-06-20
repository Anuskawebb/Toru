# Toro

AI-powered copy-trading on BSC. Users deploy autonomous agents that track smart-money wallets, score signals, and execute trades — all within configurable risk limits.

---

## Architecture

```
BSC Mainnet
    │
    ▼
indexer/              — ingests on-chain swaps into the database
    │
    ▼
analytics-worker/     — rebuilds wallet scores, token metrics, smart-money signals every 60s
    │
    ▼
packages/agent-core/  — DecisionEngine + ExecutionEngine (reads signals, places orders)
    │
    ▼
TWAK sidecar          — custodial wallet service (swap execution on BSC)
    │
    ▼
client/               — Next.js app (auth, onboarding, agent management UI)
landing/              — marketing page
```

---

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`npm install -g pnpm`)
- PostgreSQL database (Supabase recommended)
- TWAK sidecar running locally (see below)

---

## 1. Clone & Install

```bash
git clone https://github.com/Anuskawebb/Toru.git
cd Toru
pnpm install
```

---

## 2. Environment Variables

### Client (`client/.env.local`)

```env
# Database
DATABASE_URL="postgresql://user:password@host:5432/db?pgbouncer=true"

# Auth — Privy (https://privy.io)
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# TWAK sidecar (custodial wallet service)
TWAK_API_URL=http://127.0.0.1:3002
TWAK_HMAC_SECRET=your_twak_hmac_secret
TWAK_WALLET_PASSWORD=your_twak_wallet_password

# Avatar uploads — Vercel Blob (https://vercel.com/storage/blob)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...

# Funding threshold for agent activation (default: 0.005 BNB, use 0.001 for testing)
MIN_REQUIRED_BNB=0.001
```

### Indexer (`indexer/.env`)

```env
# Database
DATABASE_URL="postgresql://user:password@host:5432/db?pgbouncer=true"

# BSC RPC — use a private node for production (QuickNode, NodeReal, Ankr)
BSC_RPC_URL=https://bsc-dataseed.binance.org

# Optional tuning
CHECKPOINT_FILE=./checkpoint.json
FETCH_CONCURRENCY=5
BATCH_SIZE=100
BATCH_DELAY_MS=200
LOG_LEVEL=info
```

### Analytics Worker (`analytics-worker/.env`)

```env
DATABASE_URL="postgresql://user:password@host:5432/db?pgbouncer=true"
```

---

## 3. Database Setup

Run migrations from the db package:

```bash
cd packages/db
pnpm db:migrate
```

---

## 4. Running Services

Open a terminal for each service.

### Client (main app)

```bash
pnpm client
# runs: pnpm --filter toro dev
# → http://localhost:3000
```

### Landing page

```bash
pnpm dev
# runs: pnpm --filter landing dev
# → http://localhost:3001
```

### Indexer (BSC swap ingestion)

```bash
pnpm indexer
# runs: pnpm --filter @toro/indexer start
```

### Analytics worker (scores + signals)

```bash
pnpm analytics-worker
# runs: pnpm --filter @toro/analytics-worker start
# rebuilds wallet_scores, token_metrics, smart_money_signals every 60s
```

---

## 5. TWAK Sidecar

TWAK is the custodial wallet service that handles BSC wallet creation and swap execution. It runs as a separate HTTP service.

The client expects it at `TWAK_API_URL` (default `http://127.0.0.1:3002`).

Without TWAK running:
- Agent wallet creation will fail (503)
- Balance checks will return 0
- Trade execution will not work

---

## User Flow

```
Sign in (Privy)
    → Onboarding (5 steps: profile, experience, goal, risk, capital)
    → Create agent (name, risk level, trading mode)
    → Provision wallet (TWAK creates a BSC wallet for the agent)
    → Fund wallet (send BNB ≥ MIN_REQUIRED_BNB to the agent address)
    → Activate agent (status → ACTIVE)
    → Agent executes copy-trades based on smart-money signals
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, TailwindCSS, Privy Auth |
| Database | PostgreSQL + Drizzle ORM (`@toro/db`) |
| Wallet custody | TWAK sidecar (BSC) |
| Blockchain indexing | Custom BSC indexer (viem) |
| Analytics | Background worker — wallet scores, token metrics |
| Avatar storage | Vercel Blob |

---

## Monorepo Structure

```
client/               Next.js app (main product)
landing/              Marketing landing page
packages/
  db/                 Shared database client + schema (Drizzle)
  agent-core/         ExecutionEngine, DecisionEngine, TwakExecutor
indexer/              BSC blockchain indexer
analytics-worker/     Wallet scoring + signal generation
docs/                 Architecture docs, audit reports
```
