import 'dotenv/config';
import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { bscClient } from '../chains/bsc.js';
import { ParserRegistry } from '../parsers/registry.js';
import { DEX_PARSERS } from '../parsers/index.js';
import { extractEvents } from '../extractors/events.js';
import { reconstructTrade } from '../reconstruction/trade-reconstructor.js';
import { resolveTokenMeta } from '../cache/token-cache.js';
import { formatAmount } from '../tokens/registry.js';
import { getPoolFactory } from '../cache/factory-cache.js';
import type { NormalizedTrade } from '../types/index.js';

const V2_SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const V3_SWAP_TOPIC = '0xc42079f94a6350f444b8257297e9dca7f350240973e5fd6c41a3c9886af84079';

const THENA_FACTORIES = new Set([
  '0x6d8EDFf1B0a01F28516Eeee58EBF99FE977dB511'.toLowerCase(),
  '0x306F06C147f064A010530292A1EB6737c3e378e4'.toLowerCase(),
]);

// Dedicated client for wildcard log fetching using Nodies which allows it
const logsClient = createPublicClient({
  chain: bsc,
  transport: http('https://binance-smart-chain-public.nodies.app', {
    timeout: 60000,
  }),
});

async function main() {
  console.log('Starting high-performance split-RPC THENA swap validation scanner...');

  const registry = new ParserRegistry();
  for (const parser of DEX_PARSERS) {
    registry.register(parser);
  }

  // Scan range
  const startBlock = 104740100n;
  const endBlock = 104740800n;
  
  const detectedTrades: NormalizedTrade[] = [];
  const blockCache = new Map<bigint, { timestampMs: number }>();
  const receiptCache = new Map<string, any>();

  async function getBlockTimestamp(blockNum: bigint): Promise<number> {
    const cached = blockCache.get(blockNum);
    if (cached) return cached.timestampMs;
    let attempts = 3;
    while (attempts > 0) {
      try {
        const block = await bscClient.getBlock({ blockNumber: blockNum });
        const timestampMs = Number(block.timestamp) * 1000;
        blockCache.set(blockNum, { timestampMs });
        return timestampMs;
      } catch (err: any) {
        attempts--;
        if (attempts === 0) throw err;
        console.warn(`  Retrying getBlock for ${blockNum} (${attempts} attempts left)...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    throw new Error('Unreachable');
  }

  async function getCachedReceipt(txHash: `0x${string}`) {
    const cached = receiptCache.get(txHash);
    if (cached) return cached;
    let attempts = 3;
    while (attempts > 0) {
      try {
        const receipt = await bscClient.getTransactionReceipt({ hash: txHash });
        receiptCache.set(txHash, receipt);
        return receipt;
      } catch (err: any) {
        attempts--;
        if (attempts === 0) throw err;
        console.warn(`  Retrying getTransactionReceipt for ${txHash} (${attempts} attempts left)...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  async function fetchLogsInChunks(from: bigint, to: bigint) {
    const allLogs = [];
    const chunkSize = 50n;
    for (let current = from; current <= to; current += chunkSize) {
      const chunkEnd = current + chunkSize - 1n < to ? current + chunkSize - 1n : to;
      console.log(`  Fetching chunk from logsClient: blocks ${current} to ${chunkEnd}...`);
      try {
        const logs = await logsClient.getLogs({
          topics: [[V2_SWAP_TOPIC, V3_SWAP_TOPIC]],
          fromBlock: current,
          toBlock: chunkEnd,
        } as any);
        allLogs.push(...logs);
      } catch (err: any) {
        console.error(`  Failed to fetch chunk ${current} to ${chunkEnd}:`, err.message || err);
      }
    }
    return allLogs;
  }

  console.log(`Querying logs from block ${startBlock} to ${endBlock} using logsClient...`);
  const logs = await fetchLogsInChunks(startBlock, endBlock);
  console.log(`Found ${logs.length} raw swap logs. Resolving pool factories using bscClient (publicnode)...`);

  const uniquePools = Array.from(new Set(logs.map(log => log.address.toLowerCase()))) as `0x${string}`[];
  const poolFactories = new Map<string, string>();

  // Fetch factories for unique pools. Since we use bscClient (publicnode), rate limits are high.
  // We can query with batch size 50.
  const concurrency = 50;
  for (let i = 0; i < uniquePools.length; i += concurrency) {
    const batch = uniquePools.slice(i, i + concurrency);
    console.log(`  Resolving pool factories: ${i} to ${Math.min(i + concurrency, uniquePools.length)} of ${uniquePools.length}...`);
    await Promise.all(
      batch.map(async (pool) => {
        try {
          const factory = await getPoolFactory(pool);
          poolFactories.set(pool, factory.toLowerCase());
        } catch (e) {
          // Ignore
        }
      })
    );
  }

  const thenaLogs = logs.filter(log => {
    const factory = poolFactories.get(log.address.toLowerCase());
    return factory && THENA_FACTORIES.has(factory);
  });

  console.log(`Filtered down to ${thenaLogs.length} THENA swap logs in range ${startBlock}–${endBlock}.`);

  for (const log of thenaLogs) {
    try {
      const txHash = log.transactionHash;
      if (!txHash) continue;

      const receipt = await getCachedReceipt(txHash);
      const timestampMs = await getBlockTimestamp(log.blockNumber!);

      const allEvents = extractEvents(receipt);
      const eventsByTx = allEvents.filter(ev => ev.txHash === txHash);

      const targetEvent = allEvents.find(
        ev => ev.txHash === txHash && ev.logIndex === log.logIndex
      );

      if (!targetEvent) continue;

      const context = { blockTimestampMs: timestampMs, siblingEvents: eventsByTx };
      const rawSwap = await registry.parse(targetEvent, context);
      if (rawSwap && rawSwap.dex === 'thena') {
        const trade = reconstructTrade(rawSwap);
        if (trade) {
          const isDuplicate = detectedTrades.some(
            t => t.txHash === trade.txHash && t.logIndex === trade.logIndex
          );
          if (!isDuplicate) {
            detectedTrades.push(trade);
            console.log(`Found THENA Swap! Tx: ${trade.txHash}`);
          }
        }
      }
    } catch (err) {
      console.error(`Error processing log at block ${log.blockNumber}:`, err);
    }
  }

  console.log(`\nScan complete. Found ${detectedTrades.length} THENA swaps.`);
  console.log('='.repeat(60));

  for (let i = 0; i < detectedTrades.length; i++) {
    const trade = detectedTrades[i]!;
    const metaIn = await resolveTokenMeta(trade.tokenIn);
    const metaOut = await resolveTokenMeta(trade.tokenOut);

    const amtIn = formatAmount(trade.amountIn, metaIn.decimals);
    const amtOut = formatAmount(trade.amountOut, metaOut.decimals);

    console.log(`Swap #${i + 1}:`);
    console.log(`Wallet: ${trade.wallet}`);
    console.log(`Sold:   ${amtIn} ${metaIn.symbol} (${trade.tokenIn})`);
    console.log(`Bought: ${amtOut} ${metaOut.symbol} (${trade.tokenOut})`);
    console.log(`TxHash: ${trade.txHash}`);
    console.log(`DEX:    ${trade.dex}`);
    console.log(`Pair:   ${trade.pairAddress}`);
    console.log('-'.repeat(40));
  }
}

main().catch(console.error);
