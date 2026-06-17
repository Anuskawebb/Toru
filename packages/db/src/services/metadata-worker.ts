import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { TokenDiscoveryQueueRepository } from '../repositories/token-discovery-queue-repository.js';
import { TokenMetadataService } from './token-metadata.js';
import { TokenRepository } from '../repositories/token-repository.js';

// Setup Viem client for BSC on-chain fallback (name, symbol, decimals)
const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const publicClient = createPublicClient({
  chain: bsc,
  transport: http(rpcUrl),
});

const ERC20_ABI = [
  {
    name: 'symbol',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'name',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'decimals',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

/**
 * Resolves standard ERC20 properties directly from the blockchain.
 */
async function fetchOnChainMetadata(address: `0x${string}`) {
  try {
    const [symbol, name, decimals] = await Promise.all([
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'name' }),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }),
    ]);
    return { symbol, name, decimals };
  } catch (error) {
    console.warn(`Failed to fetch ERC-20 details on-chain for ${address}:`, error instanceof Error ? error.message : String(error));
    // Safe fallbacks
    return {
      symbol: address.slice(0, 8) + '...',
      name: `Unknown Token (${address.slice(0, 6)})`,
      decimals: 18,
    };
  }
}

/**
 * Process a single batch of unresolved tokens from the queue.
 */
export async function processQueueBatch(batchSize: number = 10): Promise<number> {
  const unresolved = await TokenDiscoveryQueueRepository.getUnresolvedTokens(batchSize);
  if (unresolved.length === 0) {
    return 0;
  }

  console.log(`Processing metadata queue batch: ${unresolved.length} tokens...`);

  for (const entry of unresolved) {
    const address = entry.address;
    console.log(`Resolving token: ${address} (attempt #${entry.attempts + 1})...`);

    try {
      // 1. Check if we have basic properties in the tokens cache
      let cached = await TokenRepository.findByAddress(address);
      let symbol = cached?.symbol;
      let name = cached?.name;
      let decimals = cached?.decimals;

      // 2. Fetch basic info on-chain if missing in cache
      if (!symbol || !name || decimals === undefined) {
        console.log(`Basic details missing for ${address}. Resolving on-chain...`);
        const onChain = await fetchOnChainMetadata(address as `0x${string}`);
        symbol = onChain.symbol;
        name = onChain.name;
        decimals = onChain.decimals;

        // Save basic details so we don't fetch from chain again
        await TokenRepository.upsertToken({
          address,
          symbol,
          name,
          decimals,
          imageUrl: cached?.imageUrl ?? null,
          coingeckoId: cached?.coingeckoId ?? null,
        });
      }

      // 3. Resolve logo and metadata using external APIs
      const resolved = await TokenMetadataService.resolveMetadata(address, symbol, name, decimals);
      
      // We consider resolved if we have an image URL (even placeholder) and coingecko ID attempt finished
      if (resolved.imageUrl) {
        console.log(`Successfully resolved metadata for ${address}: Symbol=${resolved.symbol}, Logo=${resolved.imageUrl}`);
        await TokenDiscoveryQueueRepository.markResolved(address);
      } else {
        console.warn(`Could not resolve fully for ${address}, incrementing attempts.`);
        await TokenDiscoveryQueueRepository.incrementAttempts(address);
      }
    } catch (err) {
      console.error(`Error processing queue token ${address}:`, err);
      await TokenDiscoveryQueueRepository.incrementAttempts(address);
    }
  }

  return unresolved.length;
}

/**
 * Main loop for daemon worker execution.
 */
async function startWorker() {
  const isWatch = process.argv.includes('--watch') || process.argv.includes('-w');
  const delayMs = 10000; // 10 seconds between runs

  console.log(`Metadata queue worker started. Mode: ${isWatch ? 'Watch (Daemon)' : 'One-shot'}`);
  console.log(`Using BSC RPC URL: ${rpcUrl}`);

  do {
    try {
      const processedCount = await processQueueBatch(10);
      if (processedCount === 0 && isWatch) {
        // Wait before next check
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (err) {
      console.error('Metadata worker cycle error:', err);
      if (isWatch) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } while (isWatch);

  console.log('Metadata queue worker finished.');
}

// Execute if run directly from node/tsx
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('metadata-worker.ts')) {
  startWorker().catch((err) => {
    console.error('Fatal worker error:', err);
    process.exit(1);
  });
}
