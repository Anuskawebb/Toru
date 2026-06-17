import { bscClient } from '../chains/bsc.js';
import { V4_SWAP_TOPIC } from '../parsers/pancakeswap-v4.js';
import { V3_SWAP_TOPIC } from '../parsers/pancakeswap-v3.js';
import { isPancakeSwapV2Swap } from '../parsers/pancakeswap-v2.js';
import { isPancakeSwapV3Swap } from '../parsers/pancakeswap-v3.js';
import { isPancakeSwapV4Swap } from '../parsers/pancakeswap-v4.js';
import type { RawEvent } from '../types/index.js';
import { extractEvents } from '../extractors/events.js';

// ── Known topic labels ────────────────────────────────────────────────────────

// Discovered addresses from real BSC transactions
const KNOWN_CONTRACTS: Record<string, string> = {
  '0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b': 'PancakeSwap V4 PoolManager',
  '0x40a1fe393a7f566f27df6ace18e6773be844dafc': 'PancakeSwap V4 Router',
};

const KNOWN_TOPICS: Record<string, string> = {
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'ERC-20 Transfer',
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': 'ERC-20 Approval',
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': 'PancakeSwap V2: Swap',
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1': 'PancakeSwap V2: Sync',
  [V3_SWAP_TOPIC]: 'PancakeSwap V3: Swap  ← 🎯',
  '0xdc4a96373562fa1f6351c1c03bac6124eb245a2d45577a6c8d83ef6449e518a7': 'PancakeSwap V4 Router: Swap (tokenA, tokenB, user, amountIn, amountOut, user)',
  [V4_SWAP_TOPIC]: 'PancakeSwap V4 PoolManager: Swap  ← 🎯',
};

function labelTopic(topic: string): string {
  return KNOWN_TOPICS[topic] ?? 'UNKNOWN';
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function hr(char = '─', len = 70): string {
  return char.repeat(len);
}

function formatData(data: string): string {
  const hex = data.slice(2);
  if (hex.length === 0) return '(empty)';

  const lines: string[] = [];
  for (let i = 0; i < hex.length; i += 64) {
    const slot   = hex.slice(i, i + 64).padEnd(64, ' ');
    const index  = i / 64;
    const raw    = BigInt('0x' + slot.trim());
    // Show as both unsigned and (if large) as possible signed int256
    const signed = raw >= 2n ** 255n ? raw - 2n ** 256n : raw;
    const note   = raw >= 2n ** 255n ? `  (int256: ${signed})` : '';
    lines.push(`  slot[${index}]  ${slot}  →  ${raw}${note}`);
  }
  return lines.join('\n');
}

// ── Main inspector ────────────────────────────────────────────────────────────

/**
 * Fetches a transaction receipt and prints every log in human-readable form.
 * Designed for debugging unknown event signatures.
 */
export async function inspectTransaction(txHash: `0x${string}`): Promise<void> {
  process.stdout.write(`\n${hr('═')}\n`);
  process.stdout.write(`Inspecting tx: ${txHash}\n`);
  process.stdout.write(`${hr('═')}\n\n`);

  const receipt = await bscClient.getTransactionReceipt({ hash: txHash });

  process.stdout.write(`Status:  ${receipt.status}\n`);
  process.stdout.write(`Block:   ${receipt.blockNumber.toString()}\n`);
  process.stdout.write(`From:    ${receipt.from}\n`);
  process.stdout.write(`To:      ${receipt.to ?? '(contract creation)'}\n`);
  process.stdout.write(`Logs:    ${receipt.logs.length}\n\n`);

  const events: RawEvent[] = extractEvents(receipt);

  for (const event of events) {
    const topic0 = event.topics[0] ?? '(none)';
    const label  = labelTopic(topic0);
    const isV2   = isPancakeSwapV2Swap(event);
    const isV3   = isPancakeSwapV3Swap(event);
    const isV4   = isPancakeSwapV4Swap(event);

    const contractLabel = KNOWN_CONTRACTS[event.contractAddress.toLowerCase()] ?? '';

    process.stdout.write(`${hr()}\n`);
    const tag = isV2 ? '  ← V2 Swap' : isV3 ? '  ← 🎯 V3 Swap' : isV4 ? '  ← 🎯 V4 Swap' : '';
    process.stdout.write(`Log #${event.logIndex}${tag}\n`);
    process.stdout.write(`Contract: ${event.contractAddress}${contractLabel ? `  (${contractLabel})` : ''}\n`);
    process.stdout.write(`topic[0]: ${topic0}\n`);
    process.stdout.write(`          ${label}\n`);

    for (let i = 1; i < event.topics.length; i++) {
      const t = event.topics[i];
      if (t !== undefined) {
        process.stdout.write(`topic[${i}]: ${t}\n`);
      }
    }

    process.stdout.write(`Data (${(event.data.length - 2) / 2} bytes):\n`);
    process.stdout.write(formatData(event.data) + '\n');
    process.stdout.write('\n');
  }

  process.stdout.write(`${hr('═')}\n`);
  process.stdout.write(`V3_SWAP_TOPIC (computed from ABI sig): ${V3_SWAP_TOPIC}\n`);
  process.stdout.write(`V4_SWAP_TOPIC (computed from ABI sig): ${V4_SWAP_TOPIC}\n`);
  process.stdout.write(`${hr('═')}\n\n`);
}
