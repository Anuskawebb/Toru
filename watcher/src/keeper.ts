import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount }                                                    from 'viem/accounts';
import { mantleSepolia, VAULT_MANAGER_ADDRESS, KEEPER_PRIVATE_KEY }              from './config.js';
import { log, warn, error as logError }                                           from './logger.js';
import { incrStat, STAT_EXECUTIONS }                                              from './stats.js';

const VAULT_MANAGER_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'follower',       type: 'address' },
      { internalType: 'address', name: 'leader',         type: 'address' },
      { internalType: 'address', name: 'tokenOut',       type: 'address' },
      { internalType: 'uint256', name: 'usdValue',       type: 'uint256' },
      { internalType: 'uint256', name: 'tradePrice',     type: 'uint256' },
      { internalType: 'uint256', name: 'tradeTimestamp', type: 'uint256' },
      { internalType: 'uint8',   name: 'score',          type: 'uint8'   },
    ],
    name:            'executeCopyTrade',
    outputs:         [],
    stateMutability: 'nonpayable',
    type:            'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'price', type: 'uint256' },
    ],
    name:            'setPrice',
    outputs:         [],
    stateMutability: 'nonpayable',
    type:            'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'follower', type: 'address' },
      { internalType: 'address', name: 'leader',   type: 'address' },
    ],
    name:    'getVault',
    outputs: [
      {
        internalType: 'tuple',
        name:         '',
        type:         'tuple',
        components: [
          { internalType: 'address',  name: 'follower',       type: 'address'   },
          { internalType: 'address',  name: 'leader',         type: 'address'   },
          { internalType: 'uint256',  name: 'ausdLocked',     type: 'uint256'   },
          { internalType: 'uint256',  name: 'ausdAllocated',  type: 'uint256'   },
          { internalType: 'uint8',    name: 'riskLevel',      type: 'uint8'     },
          { internalType: 'uint8',    name: 'maxPerTradePct', type: 'uint8'     },
          { internalType: 'address[]',name: 'allowlist',      type: 'address[]' },
          { internalType: 'uint8',    name: 'status',         type: 'uint8'     },
          {
            internalType: 'tuple',
            name:         'limits',
            type:         'tuple',
            components: [
              { internalType: 'uint16',  name: 'slippageBps',       type: 'uint16'  },
              { internalType: 'uint256', name: 'minLeaderTradeUsd', type: 'uint256' },
              { internalType: 'uint256', name: 'maxLeaderTradeUsd', type: 'uint256' },
              { internalType: 'uint256', name: 'minAllocUsd',       type: 'uint256' },
              { internalType: 'uint256', name: 'maxAllocUsd',       type: 'uint256' },
            ],
          },
        ],
      },
    ],
    stateMutability: 'view',
    type:            'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'follower', type: 'address' },
      { internalType: 'address', name: 'leader',   type: 'address' },
    ],
    name:            'getOpenPositions',
    outputs:         [{ internalType: 'bytes32[]', name: 'openIds', type: 'bytes32[]' }],
    stateMutability: 'view',
    type:            'function',
  },
  {
    inputs:  [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    name:    'positions',
    outputs: [
      { internalType: 'address',        name: 'follower',      type: 'address' },
      { internalType: 'address',        name: 'leader',        type: 'address' },
      { internalType: 'bytes32',        name: 'vaultId',       type: 'bytes32' },
      { internalType: 'address',        name: 'token',         type: 'address' },
      { internalType: 'uint256',        name: 'ausdAllocated', type: 'uint256' },
      { internalType: 'uint256',        name: 'tokenAmount',   type: 'uint256' },
      { internalType: 'uint256',        name: 'entryPrice',    type: 'uint256' },
      { internalType: 'uint256',        name: 'exitPrice',     type: 'uint256' },
      { internalType: 'int256',         name: 'pnl',           type: 'int256'  },
      { internalType: 'uint8',          name: 'status',        type: 'uint8'   },
      { internalType: 'uint256',        name: 'openedAt',      type: 'uint256' },
      { internalType: 'uint256',        name: 'closedAt',      type: 'uint256' },
    ],
    stateMutability: 'view',
    type:            'function',
  },
  {
    inputs:          [{ internalType: 'bytes32', name: 'positionId', type: 'bytes32' }],
    name:            'closePosition',
    outputs:         [],
    stateMutability: 'nonpayable',
    type:            'function',
  },
  {
    inputs:  [{ internalType: 'address', name: '', type: 'address' }],
    name:    'latestPrice',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type:    'function',
  },
] as const;

// Mantle-native: no STT/agent fees anymore — the keeper only pays L2 gas, which
// is tiny. Warn if the wallet is running low so trades don't start failing.
const LOW_BALANCE_WARN = parseEther('0.05');

type Account = ReturnType<typeof privateKeyToAccount>;

let _account:      Account | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _walletClient: any | null = null;
let _publicClient: ReturnType<typeof createPublicClient> | null = null;

function getClients() {
  if (!KEEPER_PRIVATE_KEY || KEEPER_PRIVATE_KEY === '0x') {
    throw new Error('[keeper] KEEPER_PRIVATE_KEY not configured');
  }
  if (!VAULT_MANAGER_ADDRESS || VAULT_MANAGER_ADDRESS === '0x') {
    throw new Error('[keeper] VAULT_MANAGER_ADDRESS not configured');
  }
  if (!_walletClient) {
    _account = privateKeyToAccount(KEEPER_PRIVATE_KEY);
    _walletClient = createWalletClient({
      account:   _account,
      chain:     mantleSepolia,
      transport: http('https://rpc.sepolia.mantle.xyz'),
    });
    _publicClient = createPublicClient({
      chain:     mantleSepolia,
      transport: http('https://rpc.sepolia.mantle.xyz'),
    });
    log('keeper', `Wallet initialised: ${_account.address}`);
  }
  return { wallet: _walletClient!, account: _account!, public: _publicClient! };
}

/** Returns the keeper wallet address and live MNT balance — used by startup diagnostics. */
export async function getKeeperInfo(): Promise<{ address: string; balanceEth: string }> {
  const { account, public: pub } = getClients();
  const balance = await pub.getBalance({ address: account.address });
  return { address: account.address, balanceEth: formatEther(balance) };
}

async function checkGas(): Promise<void> {
  const { account, public: pub } = getClients();
  const balance = await pub.getBalance({ address: account.address });
  if (balance < LOW_BALANCE_WARN) {
    warn('keeper', `Low keeper balance (${formatEther(balance)} MNT) — top up to avoid gas failures`);
  }
}

/** Vault fields needed for off-chain scoring (USD figures in dollars). */
export interface VaultForScore {
  exists:      boolean;
  active:      boolean;
  riskLevel:   number;
  ausdLocked:  number; // dollars
  freeBalance: number; // dollars
}

/** Reads a vault's config from the contract for off-chain scoring. */
export async function getVaultForScore(follower: string, leader: string): Promise<VaultForScore> {
  const { public: pub } = getClients();
  const v = await pub.readContract({
    address:      VAULT_MANAGER_ADDRESS,
    abi:          VAULT_MANAGER_ABI,
    functionName: 'getVault',
    args:         [follower as `0x${string}`, leader as `0x${string}`],
  });

  const exists      = v.follower.toLowerCase() !== '0x0000000000000000000000000000000000000000';
  const ausdLocked  = Number(v.ausdLocked)    / 1e6;
  const allocated   = Number(v.ausdAllocated) / 1e6;
  return {
    exists,
    active:      Number(v.status) === 0, // 0 = ACTIVE
    riskLevel:   Number(v.riskLevel),
    ausdLocked,
    freeBalance: Math.max(0, ausdLocked - allocated),
  };
}

/** Push the latest token price (× 1e10) on-chain. Synchronous — no validator wait. */
export async function callSetPrice(token: string, price1e10: bigint): Promise<void> {
  const { wallet, account, public: pub } = getClients();
  await checkGas();

  log('keeper', `setPrice token=${token.slice(0, 10)}… price=${price1e10}`);
  let hash: `0x${string}`;
  try {
    hash = await wallet.writeContract({
      account,
      address:      VAULT_MANAGER_ADDRESS,
      abi:          VAULT_MANAGER_ABI,
      functionName: 'setPrice',
      args:         [token as `0x${string}`, price1e10],
      chain:        mantleSepolia,
    });
  } catch (e) {
    logError('keeper', `setPrice tx submission failed — token=${token.slice(0, 10)}…`, e);
    throw e;
  }

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status === 'reverted') {
    logError('keeper', `setPrice REVERTED — token=${token.slice(0, 10)}…  tx=${hash}`);
    throw new Error(`setPrice reverted (tx: ${hash})`);
  }
  log('keeper', `setPrice confirmed ✓  token=${token.slice(0, 10)}…  block=${receipt.blockNumber}  tx=${hash}`);
}

/** Evaluate + (maybe) copy a leader trade into a follower's vault, in one tx. */
export async function callExecuteCopyTrade(
  follower:       string,
  leader:         string,
  tokenOut:       string,
  usdValue1e6:    bigint,
  tradePrice1e10: bigint,
  tradeTsSec:     bigint,
  score:          number,
): Promise<void> {
  const { wallet, account, public: pub } = getClients();
  await checkGas();

  log('keeper', `executeCopyTrade follower=${follower.slice(0, 10)}… leader=${leader.slice(0, 10)}… token=${tokenOut.slice(0, 10)}… score=${score}`);
  let hash: `0x${string}`;
  try {
    hash = await wallet.writeContract({
      account,
      address:      VAULT_MANAGER_ADDRESS,
      abi:          VAULT_MANAGER_ABI,
      functionName: 'executeCopyTrade',
      args:         [
        follower as `0x${string}`,
        leader   as `0x${string}`,
        tokenOut as `0x${string}`,
        usdValue1e6,
        tradePrice1e10,
        tradeTsSec,
        score,
      ],
      chain:        mantleSepolia,
    });
  } catch (e) {
    logError('keeper', `executeCopyTrade tx submission failed — follower=${follower.slice(0, 10)}… leader=${leader.slice(0, 10)}…`, e);
    throw e;
  }

  log('keeper', `executeCopyTrade tx submitted → ${hash}  (awaiting receipt…)`);

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status === 'reverted') {
    logError('keeper', `executeCopyTrade REVERTED — tx=${hash}  block=${receipt.blockNumber}  gas_used=${receipt.gasUsed}`);
    throw new Error(`executeCopyTrade reverted (tx: ${hash})`);
  }
  log('keeper', `executeCopyTrade confirmed ✓  block=${receipt.blockNumber}  gas_used=${receipt.gasUsed}  tx=${hash}`);
  incrStat(STAT_EXECUTIONS);
}

/**
 * Returns the IDs of the follower's currently-OPEN on-chain positions in
 * `token` (the asset the leader is now exiting). Reads straight from the
 * contract — there's no off-chain mirror of on-chain `Position` rows.
 */
export async function getOpenPositionIdsForToken(
  follower: string,
  leader:   string,
  token:    string,
): Promise<`0x${string}`[]> {
  const { public: pub } = getClients();

  const openIds = await pub.readContract({
    address:      VAULT_MANAGER_ADDRESS,
    abi:          VAULT_MANAGER_ABI,
    functionName: 'getOpenPositions',
    args:         [follower as `0x${string}`, leader as `0x${string}`],
  });

  const matches: `0x${string}`[] = [];
  for (const id of openIds) {
    const pos = await pub.readContract({
      address:      VAULT_MANAGER_ADDRESS,
      abi:          VAULT_MANAGER_ABI,
      functionName: 'positions',
      args:         [id],
    });
    if (pos[3].toLowerCase() === token.toLowerCase()) matches.push(id);
  }
  return matches;
}

export async function callClosePosition(positionId: `0x${string}`): Promise<void> {
  const { wallet, account, public: pub } = getClients();

  log('keeper', `closePosition positionId=${positionId.slice(0, 18)}…`);

  let hash: `0x${string}`;
  try {
    hash = await wallet.writeContract({
      account,
      address:      VAULT_MANAGER_ADDRESS,
      abi:          VAULT_MANAGER_ABI,
      functionName: 'closePosition',
      args:         [positionId],
      chain:        mantleSepolia,
    });
  } catch (e) {
    logError('keeper', `closePosition tx submission failed — positionId=${positionId.slice(0, 18)}…`, e);
    throw e;
  }

  log('keeper', `closePosition tx submitted → ${hash}  (awaiting receipt…)`);

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status === 'reverted') {
    logError('keeper', `closePosition REVERTED — positionId=${positionId.slice(0, 18)}…  tx=${hash}  block=${receipt.blockNumber}`);
    throw new Error(`closePosition reverted (tx: ${hash})`);
  }
  log('keeper', `closePosition confirmed ✓  positionId=${positionId.slice(0, 18)}…  block=${receipt.blockNumber}  gas_used=${receipt.gasUsed}  tx=${hash}`);
  incrStat(STAT_EXECUTIONS);
}
