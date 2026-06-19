import { TradeRepository } from '../src/repositories/trade-repository.js';
import { TokenRepository } from '../src/repositories/token-repository.js';
import { TokenDiscoveryQueueRepository } from '../src/repositories/token-discovery-queue-repository.js';
import { IndexerStateRepository } from '../src/repositories/indexer-state-repository.js';
import { db, queryClient } from '../src/client.js';

async function main() {
  console.log('--- Database Query Validation Test ---');

  // 1. Fetch checkpoint
  const checkpoint = await IndexerStateRepository.getCheckpoint('bsc');
  console.log(`BSC Block checkpoint: ${checkpoint}`);

  // 2. Fetch latest trades
  const trades = await TradeRepository.getLatestTrades(10);
  console.log(`Retrieved ${trades.length} latest trades:`);
  for (const t of trades) {
    console.log(`- Tx: ${t.txHash}, Wallet: ${t.wallet}, Dex: ${t.dex}, ${t.amountIn} ${t.tokenInSymbol} -> ${t.amountOut} ${t.tokenOutSymbol}`);
  }

  // 3. Fetch wallet trades
  const mockWallet = '0xd096705ea5ee99f2c3e4a1b23e9816395e4ba92c';
  const walletTrades = await TradeRepository.getWalletTrades(mockWallet, 10);
  console.log(`Retrieved ${walletTrades.length} trades for wallet ${mockWallet}:`);
  for (const t of walletTrades) {
    console.log(`- Tx: ${t.txHash}, Dex: ${t.dex}, ${t.amountIn} ${t.tokenInSymbol} -> ${t.amountOut} ${t.tokenOutSymbol}`);
  }

  // 4. Fetch unresolved queue tokens
  const queue = await TokenDiscoveryQueueRepository.getUnresolvedTokens(10);
  console.log(`Unresolved discovery queue items (${queue.length}):`);
  for (const item of queue) {
    console.log(`- Address: ${item.address}, Attempts: ${item.attempts}, Resolved: ${item.resolved}`);
  }

  // 5. Fetch resolved tokens metadata
  const cachedTokens = await db.query.tokens.findMany();
  console.log(`\nTokens in Cache (${cachedTokens.length}):`);
  for (const token of cachedTokens) {
    console.log(`- Address: ${token.address}`);
    console.log(`  Symbol:  ${token.symbol}`);
    console.log(`  Name:    ${token.name}`);
    console.log(`  Decimals:${token.decimals}`);
    console.log(`  Logo:    ${token.imageUrl}`);
    console.log(`  CG ID:   ${token.coingeckoId}`);
  }

  console.log('Query validation test run finished successfully.');
}

main()
  .catch((err) => {
    console.error('Query script failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await queryClient.end();
  });
