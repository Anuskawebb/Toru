# Smart Account Vision — Design Document

**Status:** Research and design only. No implementation.  
**Phase:** Future (Phase 8C+). TWAK (Phase 8B) ships first.

---

## Problem Statement

Toru V1 (TWAK) is custodial: the agent wallet's private key is managed by TWAK on behalf of the user. The user trusts Toru not to misuse it. This is fine for a hackathon demo but is a significant barrier for a real product — users with meaningful capital will not hand keys to a third party.

Smart accounts solve this: the user retains ownership of their wallet and grants Toru a bounded, revocable permission to trade on their behalf.

---

## Options Compared

### Option A — Safe (Gnosis Safe)

A multisig smart contract wallet. Toru is added as a module or co-signer.

**How it works:**
- User deploys or connects an existing Safe
- Toru is added as a Safe Module (can execute transactions within module permissions)
- Module permissions define what Toru can do (specific tokens, max amounts, time bounds)
- User can remove the module at any time

**Pros:**
- Mature, battle-tested ($100B+ TVL)
- Safe{Core} Protocol supports custom modules with permission scoping
- Widely deployed — many DeFi users already have a Safe
- Module-based permissions are on-chain and verifiable

**Cons:**
- Requires user to have or deploy a Safe
- Module deployment requires gas from the user
- Adding new Safe versions is a different SDK (safe-core-sdk vs safe-ethers-lib)
- Safe is primarily EVM mainnet-focused; BSC support exists but is less common

---

### Option B — ERC-4337 Smart Accounts (Account Abstraction)

Standard interface for smart contract accounts on any EVM chain. Each account is a contract, and transactions go through a bundler and EntryPoint.

**How it works:**
- User creates an ERC-4337 account (via Biconomy, ZeroDev, Alchemy, or Candide)
- Toru is granted as a session key or validator plugin
- Session key has scoped permissions: allowed tokens, max amounts, expiry date
- No bundler cost for the user if Toru paymasters gas

**Pros:**
- Standard — works with any ERC-4337 account regardless of provider
- Gas abstraction: Toru can paymaster gas fees for a smoother UX
- Session keys can be tight-scoped (exact tokens, exact amounts, exact time window)
- EIP-7702 (upcoming) will let EOAs adopt 4337 behavior retroactively

**Cons:**
- BSC ERC-4337 bundler infrastructure is less mature than Ethereum L1/L2
- Session key management is complex (rotation, expiry tracking, renewal UX)
- More moving parts: account factory, EntryPoint, bundler, paymaster

---

### Option C — Session Keys (EIP-7715 / Wallet-Native)

Wallets like MetaMask, Coinbase Wallet, and Rabby are implementing native session key support. The user grants a session key to Toru directly through the wallet's UI.

**How it works:**
- User connects wallet (EIP-6963 or WalletConnect)
- Toru calls `wallet_grantPermissions` (EIP-7715)
- Wallet returns a signed session key scoped to Toru's allowed actions
- Toru uses the session key to submit transactions directly

**Pros:**
- No smart contract deployment required — works with EOAs
- Permission grant happens in the user's existing wallet (no new account setup)
- Upcoming standard — multiple wallet providers implementing simultaneously
- Clean UX: "Grant Toru permission to trade on your behalf" → one click in wallet

**Cons:**
- EIP-7715 is not yet finalized — wallet support is still limited
- Permissions are signed by the wallet but enforcement is off-chain (the wallet trusts Toru to honor scope)
- No on-chain revocation — user must revoke via wallet UI, not verifiable by smart contract

---

### Option D — Delegated Permissions via Delegate.cash / EIP-7702

Delegation registries allow an EOA to delegate actions to another address without giving up keys.

**How it works:**
- User calls `delegate.cash` registry to grant Toru's address a specific delegated right
- Toru's executor checks the registry before acting on a user's behalf
- EIP-7702 (shipping in Ethereum Pectra, ~2025) allows EOAs to temporarily behave like smart contracts

**Pros:**
- Minimal UX friction — one transaction to delegate
- No account migration required
- EIP-7702 makes EOAs first-class citizens for delegation

**Cons:**
- Delegate.cash permissions are not transaction-level (can't scope to specific tokens or amounts)
- EIP-7702 is very new — BSC adoption timeline uncertain

---

## Recommendation for Toru

**Short term (Phase 8B):** TWAK custodial agent wallet. Get real execution working first.

**Medium term (Phase 8C):** Implement **ERC-4337 with session keys** via ZeroDev or Biconomy.

Rationale:
1. ZeroDev and Biconomy both support BSC
2. Session keys can be tightly scoped to Toru's exact use case (specific token list, max amount per trade, 30-day expiry)
3. The `execution_accounts` table already has metadata JSONB to store session key address and expiry
4. Gas abstraction via paymaster dramatically improves onboarding UX (user never pays gas during normal operation)
5. ERC-4337 is the standard direction for the entire EVM ecosystem — future-proof

**Long term (Phase 8D+):** Adopt **EIP-7715 session keys** when wallet support matures. This would let users grant Toru permissions directly in MetaMask/Rabby without deploying any contracts.

---

## How Toru Would Receive Delegated Trading Permissions

### ERC-4337 Implementation

```
1. User creates ERC-4337 account (via ZeroDev SDK in Toru onboarding)
   - Account factory deploys the user's smart account on BSC

2. Toru generates an ephemeral session key (keypair)
   - Private key stored server-side in TWAK or encrypted KMS
   - Public key stored in execution_accounts.metadata.sessionKeyAddress

3. User signs a UserOperation that enables the session key:
   - Permitted actions: swap on PancakeSwap
   - Permitted tokens: [list from execution_policy.allowed_tokens]
   - Max value per tx: execution_policy.max_trade_usd
   - Expiry: 30 days

4. Session key is active on-chain

5. Toru's TwakExecutor (or SmartAccountExecutor):
   - Builds a UserOperation for the intended swap
   - Signs with the session key
   - Submits to bundler
   - Bundler submits to EntryPoint on BSC
   - EntryPoint verifies session key permissions, executes swap
```

---

## Permission Revocation

### Revocation by User

Two paths depending on account type:

**TWAK_AGENT:** User clicks "Stop Trading" in Toru UI → Toru sets `execution_accounts.status = 'REVOKED'` → ExecutionEngine stops processing orders for this account. No on-chain action needed (Toru controls the key).

**SMART_ACCOUNT (ERC-4337):** User calls `disableSessionKey(sessionKeyAddress)` on their smart account. Toru also sets `execution_accounts.status = 'REVOKED'` in DB. Even if DB is not updated, the on-chain revocation means any UserOperation from the session key will be rejected by the EntryPoint.

### Revocation by Session Key Expiry

Session keys have an expiry timestamp. The `execution_accounts` table tracks this in `metadata.sessionExpiry`. Before submitting any order, the SmartAccountExecutor checks:

```typescript
if (new Date(account.metadata.sessionExpiry) < new Date()) {
  // Trigger renewal flow or suspend account
  await suspendAccount(account.id, 'SESSION_KEY_EXPIRED')
  return { success: false, errorMessage: 'session_key_expired' }
}
```

---

## How Stop-Loss and Risk Limits Would Be Enforced

### Off-Chain Enforcement (Today + Phase 8B)

The `RiskEngine` and `PolicyEngine` enforce limits in the Toru backend before any transaction is submitted. If a stop-loss is hit:
1. `DecisionEngine` generates a SELL recommendation
2. `ExecutionEngine` creates a SELL order
3. `PolicyEngine` approves it (SELL orders are always approved if stop-loss triggered)
4. Executor submits the SELL transaction

This works for both TWAK and Smart Account — the enforcement is in Toru's code, not on-chain.

### On-Chain Enforcement (Future)

For full trustlessness, risk limits could be encoded in a smart contract:

```solidity
// Session key permission — only callable by Toru session key
// Reverts if position loss exceeds stop-loss threshold
function executeWithStopLoss(
  address tokenIn,
  address tokenOut,
  uint amountIn,
  uint stopLossBps,        // 800 = 8%
  uint entryPriceUsd
) external onlySessionKey {
  uint currentPrice = oracle.getPrice(tokenIn);
  uint lossFromEntry = (entryPriceUsd - currentPrice) * 10000 / entryPriceUsd;
  require(lossFromEntry <= stopLossBps, "stop-loss limit");
  // proceed with swap
}
```

This is aspirational — not planned for Phase 8C. Off-chain enforcement is sufficient for the product today.

---

## Integration with Existing Execution Engine

The `Executor` interface is the integration point:

```typescript
export interface Executor {
  execute(order: ExecutionOrder): Promise<ExecutionResult>
}
```

`SmartAccountExecutor` implements this interface. The `ExecutionEngine` is unchanged:

```typescript
class SmartAccountExecutor implements Executor {
  constructor(private account: ExecutionAccount, private sessionKey: SessionKey) {}

  async execute(order: ExecutionOrder): Promise<ExecutionResult> {
    // Build UserOperation for PancakeSwap swap
    // Sign with session key
    // Submit to bundler
    // Return { success, txHash, errorMessage }
  }
}
```

The only change required in the orchestration layer is selecting the right executor based on `execution_accounts.account_type`:

```typescript
const account = await ExecutionAccountRepository.getActive(agentId)

const executor = account.account_type === 'SMART_ACCOUNT'
  ? new SmartAccountExecutor(account, sessionKey)
  : account.account_type === 'TWAK_AGENT'
  ? new TwakExecutor(account)
  : new MockExecutor()

const engine = new ExecutionEngine(config, executor)
```

No changes to `ExecutionEngine`, `DecisionEngine`, `RiskEngine`, or the analytics pipeline.
