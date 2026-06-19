import 'dotenv/config';
import { bscClient } from './chains/bsc.js';
import { getBlocksInRange, getTransactionReceipts } from './chains/bsc.js';
import { extractEvents } from './extractors/events.js';

const V2_SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const V3_SWAP_TOPIC = '0xc42079f94a63529712b3e551065952f4c6e949988a8f58c7042a59a72df574a4';

const FACTORY_ABI = [
  {
    name: 'factory',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

async function main() {
  const startBlock = 104740150n;
  const endBlock = 104740200n;
  console.log(`Scanning blocks ${startBlock} to ${endBlock} for swaps and calling factory()...`);

  const blocks = await getBlocksInRange(startBlock, endBlock);
  console.log(`Fetched ${blocks.length} blocks.`);

  for (const block of blocks) {
    if (block.transactions.length === 0) continue;
    const receipts = await getTransactionReceipts(block.transactions, 10);
    const events = receipts.flatMap(extractEvents);

    for (const event of events) {
      const isV2 = event.topics[0] === V2_SWAP_TOPIC;
      const isV3 = event.topics[0] === V3_SWAP_TOPIC;

      if (isV2 || isV3) {
        let factoryAddress = 'unknown';
        try {
          factoryAddress = await bscClient.readContract({
            address: event.contractAddress,
            abi: FACTORY_ABI,
            functionName: 'factory',
          });
        } catch (err: any) {
          // ignore or record error
          factoryAddress = `error: ${err.message || String(err)}`;
        }

        console.log(`Block: ${block.number} | Tx: ${event.txHash} | Type: ${isV2 ? 'V2' : 'V3'} | Pool: ${event.contractAddress} | Factory: ${factoryAddress}`);
      }
    }
  }
}

main().catch(console.error);
