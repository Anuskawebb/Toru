# Aether — AI-Powered Copy-Trading Protocol on Mantle

Aether is an agent-first copy-trading protocol built natively on Mantle. It empowers users to deploy autonomous, AI-driven copy-trading agents that monitor leader activity on Mantle Mainnet (Agni Finance pools) and execute mirrored trades on Mantle Sepolia Testnet. By combining high-speed execution, non-custodial smart contract vaults, and AI-powered trade scoring, Aether makes institutional-grade automated trading accessible to everyone.

## Architecture

```
Mantle Mainnet (Agni) ──swap events──► Watcher Service ──score──► Claude Haiku (AI)
                                              │                          │
                                              └──────── decision ────────┘
                                                         │
                                                   Keeper Agent
                                                         │
                                              VaultManager.sol (on-chain)
                                                         │
                                                 User's Agent Vault
                                      (deterministic address per follower+leader)
```

## Technology Stack

- **Frontend:** Next.js 16 (App Router), TailwindCSS, Wagmi, Viem, Privy Auth
- **Backend / Watcher:** Node.js (TypeScript), Viem
- **Database:** Prisma ORM, PostgreSQL (Supabase)
- **Caching & Stats:** Upstash Redis
- **AI Engine:** Claude Haiku (with fallback LLM reasoning)
- **On-Chain Ecosystem:** Mantle Sepolia Testnet (Chain ID `5003`), customized `aUSD` stablecoin, smart contract-based agent vaults

---

## Local Development Setup

To run Aether locally, configure the environment variables and boot up the frontend and watcher services.

### 1. Environment Variables Configuration

#### Frontend (`frontend/.env.local`)
Create a `frontend/.env.local` file with the following variables:
```env
# WalletConnect
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=YOUR_PROJECT_ID_HERE

# Supabase Postgres URLs
DATABASE_URL="postgresql://username:password@host:port/database?pgbouncer=true"
DIRECT_URL="postgresql://username:password@host:port/database"

# Upstash Redis
UPSTASH_REDIS_REST_URL=https://your-redis-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_redis_token_here

# Mantle RPC URLs
NEXT_PUBLIC_MANTLE_MAINNET_RPC=https://rpc.mantle.xyz
NEXT_PUBLIC_MANTLE_SEPOLIA_RPC=https://rpc.sepolia.mantle.xyz

# Privy Authentication
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# On-Chain Contract Addresses (Mantle Sepolia Testnet)
NEXT_PUBLIC_FOLLOWER_REGISTRY_ADDRESS=0x...
NEXT_PUBLIC_AUSDC_ADDRESS=0x...
NEXT_PUBLIC_VAULT_MANAGER_ADDRESS=0x...

# Notifications & AI Keys (Optional / Fallbacks)
RESEND_API_KEY="your_resend_api_key"
OPENAI_API_KEY="your_openai_api_key"
```

#### Watcher (`watcher/.env`)
Create a `watcher/.env` file with the following variables:
```env
# Database URLs
DATABASE_URL="postgresql://username:password@host:port/database?pgbouncer=true"
DIRECT_URL="postgresql://username:password@host:port/database"

# Upstash Redis
UPSTASH_REDIS_REST_URL=https://your-redis-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_redis_token_here

# Contracts (Mantle Sepolia Testnet)
FOLLOWER_REGISTRY_ADDRESS=0x...
VAULT_MANAGER_ADDRESS=0x...
AUSDC_ADDRESS=0x...

# Keeper Wallet (triggers copy trades on-chain)
KEEPER_PRIVATE_KEY=your_keeper_private_key

# Copy-trade settings
DEFAULT_COPY_PCT=20
```

### 2. Booting Services

Install dependencies and start development servers:

#### Start Frontend
```bash
cd frontend
npm install
npm run dev
```

#### Start Watcher
```bash
cd watcher
npm install
npm run dev
```

---

## Design Highlights

- **Agent-First Design:** Implements deterministic smart contract vaults per follower-leader pair, non-custodial keeper delegation patterns, and fully automated monitoring loops that update and execute without user intervention.
- **AI Trade Scoring:** Claude Haiku evaluates each leader trade against a vault's risk profile and produces natural-language reasoning explanations for every copy decision.
- **Risk Controls:** Per-vault stop-loss mechanics with in-process registries, dynamic backtesting previews on deployment, and throughput statistic tracking.
- **Autonomous Performance:** Operates on a rapid poll cycle with Redis heartbeat indicators, executing automated trade protection (stop-losses) and copy-trading triggers autonomously while broadcasting real-time logs to user pages.
