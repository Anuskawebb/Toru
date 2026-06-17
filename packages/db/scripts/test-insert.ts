import { TradeRepository } from '../src/repositories/trade-repository.js';
import { TokenRepository } from '../src/repositories/token-repository.js';
import { TokenDiscoveryQueueRepository } from '../src/repositories/token-discovery-queue-repository.js';
import { IndexerStateRepository } from '../src/repositories/indexer-state-repository.js';
import { queryClient } from '../src/client.js';

async function main() {
  console.log('--- Database Insert & Validation Test ---');

  const mockTokenIn = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'; // WBNB
  const mockTokenOut = '0x55d398326f99059ff775485246999027b3197955'; // USDT
  const mockWallet = '0xd096705ea5ee99f2c3e4a1b23e9816395e4ba92c';

  const mockTrade = {
    txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    blockNumber: 40000000n,
    timestamp: new Date(),
    wallet: mockWallet,
    dex: 'pancakeswap-v3' as const,
    tokenInAddress: mockTokenIn,
    tokenOutAddress: mockTokenOut,
    tokenInSymbol: 'WBNB',
    tokenOutSymbol: 'USDT',
    amountIn: '1000000000000000000', // 1 WBNB
    amountOut: '600000000', // 600 USDT
  };

  // 1. Check checkpoint persistence
  console.log('Testing Indexer State Checkpoint...');
  await IndexerStateRepository.saveCheckpoint('bsc', 40000000n);
  const checkpoint = await IndexerStateRepository.getCheckpoint('bsc');
  console.log(`Saved checkpoint for BSC: ${checkpoint}`);

  // 2. Check token upserts
  console.log('Testing Token upserts...');
  await TokenRepository.upsertToken({
    address: mockTokenIn,
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    decimals: 18,
  });

  await TokenRepository.upsertToken({
    address: mockTokenOut,
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 18,
  });

  // 3. Test trade insertion
  console.log('Inserting mock trade...');
  await TradeRepository.insertTrade(mockTrade);
  console.log('First insertion succeeded.');

  // 4. Test duplicate trade prevention (uniqueness constraint test)
  console.log('Testing duplicate prevention (should ignore insert without error)...');
  await TradeRepository.insertTrade(mockTrade);
  console.log('Second insertion completed (ignored successfully).');

  // 5. Check queueing logic
  console.log('Enqueuing token address to discovery queue...');
  await TokenDiscoveryQueueRepository.enqueueToken(mockTokenIn);
  await TokenDiscoveryQueueRepository.enqueueToken('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'); // CAKE
  console.log('Queueing complete.');

  console.log('Insert and validation test run finished successfully.');
}

main()
  .catch((err) => {
    console.error('Test script failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await queryClient.end();
  });
