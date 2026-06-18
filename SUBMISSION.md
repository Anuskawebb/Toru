# Aether: AI-Powered Copy-Trading Protocol on Mantle

**Aether is an agent-first, non-custodial copy-trading protocol built natively on Mantle.** It lets anyone deploy an autonomous, AI-driven trading agent that watches the best on-chain traders ("leaders") and automatically mirrors their moves, sized to your own risk profile, executed on-chain, with a plain-English reason attached to every trade.

Most people don't have the time, skill, or conviction to trade DeFi well, yet the talent already exists on-chain. Aether lets you delegate to that talent programmatically: pick a leader, fund a vault, and your agent handles the rest. No custody, no manual clicking, no staring at charts.

---

## What Aether Does

- **Deploy an AI agent vault** for any follower and leader pair (a deterministic, non-custodial smart-contract vault).
- **Watch leaders in real time** using an off-chain watcher that monitors leader swap activity on Mantle.
- **Score every trade with AI.** Each candidate trade is evaluated against your vault's risk rules, producing a natural-language explanation of why it copied or skipped.
- **Execute real on-chain DEX swaps.** Approved trades route through a UniswapV2 / FusionX-compatible router, so P&L is real swap proceeds rather than minted numbers.
- **Manage risk autonomously** with per-vault stop-losses, position tracking, and live P&L, all enforced on-chain.
- **Carry a verifiable agent identity.** The Aether agent is registered on-chain under the ERC-8004 identity standard.

---

## How It Works

```
Mantle (leader swaps) --> Watcher Service --> AI Trade Scorer
                                |                   |
                                +----- decision ----+
                                         |
                                   Keeper / Oracle
                                         |
                                 VaultManager.sol  --swap-->  DEX (V2 router)
                                         |
                                Your Agent Vault  (per follower + leader)
```

1. The watcher detects a leader's swap.
2. The AI scorer judges it against your vault's risk profile and emits a reasoned decision.
3. The keeper pushes the result on-chain via `executeCopyTrade(...)`.
4. VaultManager opens or closes the position by swapping aUSD against the token on a real DEX pool, producing real proceeds and real P&L.

---

## Key Features

- **Agent-first vaults:** Deterministic, non-custodial vault per follower and leader pair.
- **AI trade scoring:** Risk-aware scoring with human-readable reasoning per decision.
- **Real on-chain swaps:** UniswapV2 / FusionX-compatible router with true swap-based P&L.
- **On-chain risk controls:** Per-vault stop-loss, position and P&L tracking.
- **ERC-8004 identity:** Agent registered on-chain as a verifiable AI agent.
- **Autonomous loop:** Continuous poll cycle with live activity logs and status heartbeat.
- **Non-custodial:** Users keep ownership; the keeper only executes, never withdraws.

---

## Tech Stack

- **Frontend:** Next.js 16 (App Router), TailwindCSS, Wagmi, Viem, Privy Auth
- **Watcher / Keeper:** Node.js with TypeScript, Viem
- **Smart Contracts:** Solidity (Hardhat), OpenZeppelin v5
- **Data and Caching:** Prisma with PostgreSQL (Supabase), Upstash Redis
- **AI Engine:** Claude (Haiku) trade reasoning, with a deterministic scorer fallback
- **Network:** Mantle Sepolia Testnet (Chain ID 5003)

---

## Smart Contracts (Mantle Sepolia, Chain ID 5003)

- **VaultManager (core):** [0xe58170bDD79e374bbdB73e55191baE907315d861](https://explorer.sepolia.mantle.xyz/address/0xe58170bDD79e374bbdB73e55191baE907315d861)
- **AgentIdentityRegistry (ERC-8004):** [0xF00ba1db267E1D4E8eBcE4405f5B8015426C6968](https://explorer.sepolia.mantle.xyz/address/0xF00ba1db267E1D4E8eBcE4405f5B8015426C6968)
- **aUSD (stablecoin):** [0x1A315C08f0B841be88C8513205eAE77ef9f544B0](https://explorer.sepolia.mantle.xyz/address/0x1A315C08f0B841be88C8513205eAE77ef9f544B0)
- **DEX (V2-compatible AMM):** [0x9c5D46678F02295d720D8B1146181d289f74423b](https://explorer.sepolia.mantle.xyz/address/0x9c5D46678F02295d720D8B1146181d289f74423b)
- **mWMNT (wrapped MNT):** [0xd19D810bc8cC805bf82C16B689078ce7F5fd8fd3](https://explorer.sepolia.mantle.xyz/address/0xd19D810bc8cC805bf82C16B689078ce7F5fd8fd3)

On mainnet, the `dex` role is swappable to the real FusionX V2 router with no code changes.

---

## What's Next

- Integrate live Bybit and market signals into the scorer.
- Upgrade the scorer to full LLM (Claude) or on-chain ORA inference.
- Deploy to mainnet against real FusionX liquidity.
