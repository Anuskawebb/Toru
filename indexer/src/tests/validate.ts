/**
 * Parser Validation Suite
 *
 * Scans a configurable block range, collects all normalized trades, then runs
 * automated assertions and exports a JSON report for manual BscScan comparison.
 *
 * Usage:
 *   BLOCKS=100 pnpm run validate                  # last 100 blocks
 *   BLOCK_START=104730000 BLOCK_END=104730100 pnpm run validate
 *
 * Output:
 *   validation-report.json  — all trades with BscScan URLs
 *   validation-issues.json  — trades that failed automated assertions
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import { getLatestBlock } from '../chains/bsc.js';
import { BlockProcessor } from '../processor.js';
import { ParserRegistry } from '../parsers/registry.js';
import { pancakeswapV2Parser } from '../parsers/pancakeswap-v2.js';
import { pancakeswapV3Parser } from '../parsers/pancakeswap-v3.js';
import { pancakeswapV4Parser } from '../parsers/pancakeswap-v4.js';
import { resolveTokenMeta } from '../cache/token-cache.js';
import { formatAmount } from '../tokens/registry.js';
import type { IndexedBlock, NormalizedTrade } from '../types/index.js';

// ── Known router / pool addresses (wallet should NEVER equal these) ───────────

const KNOWN_NON_WALLETS = new Set([
  '0x10ed43c718714eb63d5aa57b78b54704e256024e', // PancakeSwap V2 Router
  '0x13f4ea83d0bd40e75c8222255bc855a974568dd4', // PancakeSwap Universal Router
  '0x05ff2b0db69458a0750badebc4f9e13add608c7f', // PancakeSwap V2 Router (old)
  '0x40a1fe393a7f566f27df6ace18e6773be844dafc', // PancakeSwap V4 Router
  '0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b', // PancakeSwap V4 PoolManager
]);

// ── Types ─────────────────────────────────────────────────────────────────────

interface TradeRecord {
  txHash:        string;
  block:         string;
  timestamp:     string;
  wallet:        string;
  dex:           string;
  tokenIn:       string;
  tokenInSym:    string;
  amountIn:      string;
  amountInFormatted: string;
  tokenOut:      string;
  tokenOutSym:   string;
  amountOut:      string;
  amountOutFormatted: string;
  bscscan:       string;
  flags:         string[];
}

interface MultiHop {
  txHash: string;
  hops:   number;
  route:  string;
  dexes:  string[];
}

interface ValidationReport {
  generatedAt:    string;
  blockRange:     { from: number; to: number };
  scannedBlocks:  number;
  totalTrades:    number;
  byProtocol:     Record<string, number>;
  bnbSwaps:       number;
  stablecoinSwaps: number;
  multiHopTxs:    number;
  issueCount:     number;
  trades:         TradeRecord[];
  multiHops:      MultiHop[];
  issues:         { txHash: string; trade: TradeRecord; assertion: string }[];
}

// ── State ─────────────────────────────────────────────────────────────────────

// WBNB / stablecoin addresses for classification
const WBNB    = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const STABLES = new Set([
  '0x55d398326f99059ff775485246999027b3197955', // USDT
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
  '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
  '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409', // FDUSD
  '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', // DAI
]);

const collectedTrades: (NormalizedTrade & { blockTimestampMs: number })[] = [];
const txToTrades      = new Map<string, NormalizedTrade[]>();

async function handler(block: IndexedBlock, trades: NormalizedTrade[]): Promise<void> {
  for (const t of trades) {
    collectedTrades.push({ ...t, blockTimestampMs: block.timestampMs });
    const list = txToTrades.get(t.txHash) ?? [];
    list.push(t);
    txToTrades.set(t.txHash, list);
  }
}

// ── Assertions ────────────────────────────────────────────────────────────────

function assertTrade(t: NormalizedTrade): string[] {
  const flags: string[] = [];

  if (t.amountIn  === 0n) flags.push('ZERO_AMOUNT_IN');
  if (t.amountOut === 0n) flags.push('ZERO_AMOUNT_OUT');
  if (t.amountIn   < 0n) flags.push('NEGATIVE_AMOUNT_IN');
  if (t.amountOut  < 0n) flags.push('NEGATIVE_AMOUNT_OUT');

  const inLow  = t.tokenIn.toLowerCase();
  const outLow = t.tokenOut.toLowerCase();
  if (inLow === outLow) flags.push('SAME_TOKEN_IN_OUT');

  const walletLow = t.wallet.toLowerCase();
  if (KNOWN_NON_WALLETS.has(walletLow)) flags.push('ROUTER_AS_WALLET');

  return flags;
}

// Decimal-normalized price-ratio check — must run AFTER resolving token metadata.
// Raw-amount ratio is meaningless across different decimal counts (9-dec vs 18-dec
// gives raw ratio of 10^9 even at 1:1 price). Instead we cross-multiply:
//   scaledIn  = amountIn  × 10^outDecimals
//   scaledOut = amountOut × 10^inDecimals
// and flag if ratio > 10^12 (a trillion-to-one price — almost certainly a bug).
function checkPriceRatio(t: NormalizedTrade, inDecimals: number, outDecimals: number): boolean {
  if (t.amountIn === 0n || t.amountOut === 0n) return false;
  const scaledIn  = t.amountIn  * 10n ** BigInt(outDecimals);
  const scaledOut = t.amountOut * 10n ** BigInt(inDecimals);
  const ratio = scaledIn > scaledOut ? scaledIn / scaledOut : scaledOut / scaledIn;
  return ratio > 1_000_000_000_000n;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const head = await getLatestBlock();
  const headNum = Number(head.number);

  const envStart = process.env['BLOCK_START'];
  const envEnd   = process.env['BLOCK_END'];
  const blocks   = Number(process.env['BLOCKS'] ?? '100');

  const fromBlock = envStart !== undefined ? Number(envStart) : headNum - blocks + 1;
  const toBlock   = envEnd   !== undefined ? Number(envEnd)   : headNum;

  console.log(`\nValidator — scanning blocks ${fromBlock}–${toBlock} (${toBlock - fromBlock + 1} blocks)\n`);

  const registry = new ParserRegistry()
    .register(pancakeswapV2Parser)
    .register(pancakeswapV3Parser)
    .register(pancakeswapV4Parser);

  const processor = new BlockProcessor(handler, registry, {
    batchSize:          50,
    delayMs:            100,
    fetchConcurrency:   5,
    receiptConcurrency: 10,
  });

  await processor.processRange(BigInt(fromBlock), BigInt(toBlock));

  console.log(`\nProcessed ${collectedTrades.length} trades. Resolving token metadata...\n`);

  // Resolve all token symbols in parallel
  const uniqueTokens = [...new Set(collectedTrades.flatMap((t) => [t.tokenIn, t.tokenOut]))];
  await Promise.all(uniqueTokens.map(resolveTokenMeta));

  // ── Build report ────────────────────────────────────────────────────────────

  const byProtocol: Record<string, number> = {};
  let bnbSwaps = 0;
  let stablecoinSwaps = 0;

  const tradeRecords: TradeRecord[] = [];
  const issues: ValidationReport['issues'] = [];
  const multiHops: MultiHop[] = [];

  for (const t of collectedTrades) {
    const metaIn  = await resolveTokenMeta(t.tokenIn);
    const metaOut = await resolveTokenMeta(t.tokenOut);

    byProtocol[t.dex] = (byProtocol[t.dex] ?? 0) + 1;

    const inLow  = t.tokenIn.toLowerCase();
    const outLow = t.tokenOut.toLowerCase();
    if (inLow === WBNB || outLow === WBNB) bnbSwaps++;
    if (STABLES.has(inLow) && STABLES.has(outLow)) stablecoinSwaps++;

    const flags = assertTrade(t);
    if (checkPriceRatio(t, metaIn.decimals, metaOut.decimals)) {
      flags.push('EXTREME_PRICE_RATIO');
    }

    const record: TradeRecord = {
      txHash:         t.txHash,
      block:          t.blockNumber.toString(),
      timestamp:      new Date(t.blockTimestampMs).toISOString(),
      wallet:         t.wallet,
      dex:            t.dex,
      tokenIn:        t.tokenIn,
      tokenInSym:     metaIn.symbol,
      amountIn:       t.amountIn.toString(),
      amountInFormatted:  formatAmount(t.amountIn, metaIn.decimals),
      tokenOut:       t.tokenOut,
      tokenOutSym:    metaOut.symbol,
      amountOut:      t.amountOut.toString(),
      amountOutFormatted: formatAmount(t.amountOut, metaOut.decimals),
      bscscan:        `https://bscscan.com/tx/${t.txHash}`,
      flags,
    };

    tradeRecords.push(record);

    if (flags.length > 0) {
      issues.push({ txHash: t.txHash, trade: record, assertion: flags.join(', ') });
    }
  }

  // Multi-hop analysis: same txHash → multiple trades
  for (const [txHash, trades] of txToTrades) {
    if (trades.length < 2) continue;
    const symbols = await Promise.all(
      trades.flatMap((t) => [resolveTokenMeta(t.tokenIn), resolveTokenMeta(t.tokenOut)]),
    );
    const route = trades
      .flatMap((t, i) => [
        symbols[i * 2]?.symbol ?? t.tokenIn.slice(0, 8),
        symbols[i * 2 + 1]?.symbol ?? t.tokenOut.slice(0, 8),
      ])
      .filter((s, i, arr) => i === 0 || s !== arr[i - 1])
      .join(' → ');

    multiHops.push({
      txHash,
      hops:  trades.length,
      route,
      dexes: [...new Set(trades.map((t) => t.dex))],
    });
  }

  const report: ValidationReport = {
    generatedAt:     new Date().toISOString(),
    blockRange:      { from: fromBlock, to: toBlock },
    scannedBlocks:   toBlock - fromBlock + 1,
    totalTrades:     collectedTrades.length,
    byProtocol,
    bnbSwaps,
    stablecoinSwaps,
    multiHopTxs:     multiHops.length,
    issueCount:      issues.length,
    trades:          tradeRecords,
    multiHops,
    issues,
  };

  // ── Write files ─────────────────────────────────────────────────────────────

  writeFileSync('validation-report.json',  JSON.stringify(report, null, 2));
  writeFileSync('validation-issues.json',  JSON.stringify(issues,  null, 2));
  writeFileSync('validation-multihop.json', JSON.stringify(multiHops, null, 2));

  // ── Print summary ────────────────────────────────────────────────────────────

  const sep = '─'.repeat(60);
  console.log(sep);
  console.log('VALIDATION SUMMARY');
  console.log(sep);
  console.log(`Blocks scanned :  ${report.scannedBlocks}`);
  console.log(`Total trades   :  ${report.totalTrades}`);
  console.log('');
  console.log('By protocol:');
  for (const [dex, count] of Object.entries(byProtocol).sort()) {
    const pct = ((count / report.totalTrades) * 100).toFixed(1);
    console.log(`  ${dex.padEnd(22)} ${count.toString().padStart(6)}  (${pct}%)`);
  }
  console.log('');
  console.log(`BNB ↔ Token    :  ${bnbSwaps}`);
  console.log(`Stable ↔ Stable:  ${stablecoinSwaps}`);
  console.log(`Multi-hop txs  :  ${multiHops.length}`);
  console.log('');
  if (issues.length === 0) {
    console.log('✅  All automated assertions passed');
  } else {
    console.log(`❌  ${issues.length} assertion failure(s) — see validation-issues.json`);
    for (const { txHash, assertion } of issues.slice(0, 10)) {
      console.log(`    ${txHash.slice(0, 20)}…  →  ${assertion}`);
    }
  }
  console.log('');
  console.log('Multi-hop sample (first 5):');
  for (const mh of multiHops.slice(0, 5)) {
    console.log(`  ${mh.hops}-hop  ${mh.route}`);
    console.log(`         ${mh.txHash}`);
  }
  console.log(sep);
  console.log('');
  console.log('Output files:');
  console.log('  validation-report.json   — all trades with BscScan URLs');
  console.log('  validation-issues.json   — assertion failures');
  console.log('  validation-multihop.json — multi-hop route analysis');
  console.log('');
  console.log('Next: open BscScan for 10 random trades from each protocol');
  console.log('      and verify wallet / tokenIn / tokenOut / amounts match.');
  console.log(sep);
}

main().catch((err: unknown) => {
  console.error('Validator failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
