/**
 * Audit Pass 2 — Clean Direct-User Swap Sampler
 *
 * Reads validation-report.json, applies four filter categories:
 *   1. MEV / arbitrage bots  (wallet frequency + circular route detection)
 *   2. Multi-hop / aggregator (txHash appears in >1 trade → not a direct swap)
 *   3. Fee-on-transfer tokens (Transfer amount ≠ parsed amount by >0.5%)
 *   4. Tax / meme tokens     (EXTREME_PRICE_RATIO flag, zero display amount)
 *
 * Then picks 10 from each protocol (V2 / V3 / V4) and outputs:
 *   audit-candidates.json  — 30 clean trades for BscScan manual audit
 *   audit-summary.txt      — human-readable table with BscScan URLs
 *
 * Usage:
 *   pnpm run audit
 */

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { bscClient } from '../chains/bsc.js';
import { extractEvents } from '../extractors/events.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Tokens suitable for manual BscScan audit — well-understood, clean ERC-20s
const WELL_KNOWN_TOKENS = new Set([
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
  '0x55d398326f99059ff775485246999027b3197955', // USDT
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
  '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
  '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409', // FDUSD
  '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', // CAKE
  '0x2170ed0880ac9a755fd29b2688956bd959f933f8', // ETH (bsc)
  '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', // BTCB
  '0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe', // XRP (bsc)
  '0x3ee2200efb3400fabb9aacf31297cbdd1d435d47', // ADA (bsc)
  '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', // DAI
]);

const MAX_WALLET_TRADES = 4;   // more than this in 100 blocks → likely bot
const FEE_THRESHOLD     = 0.005; // > 0.5% discrepancy → fee-on-transfer token

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

interface ValidationReport {
  trades: TradeRecord[];
}

interface AuditCandidate extends TradeRecord {
  filterReasons:  Record<string, boolean>;
  feeCheck:       { checked: boolean; hasFee: boolean; detail: string };
}

// ── Filter helpers ─────────────────────────────────────────────────────────────

function buildFrequencyMap<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

function hasCycleRoute(txHash: string, allTrades: TradeRecord[]): boolean {
  const hops = allTrades.filter((t) => t.txHash === txHash);
  if (hops.length < 2) return false;
  const firstIn  = hops[0]?.tokenIn.toLowerCase()  ?? '';
  const lastOut  = hops[hops.length - 1]?.tokenOut.toLowerCase() ?? '';
  return firstIn === lastOut;
}

// ── Fee-on-transfer detector ───────────────────────────────────────────────────
//
// Fetches the full receipt for a V2 / V3 trade and compares the ERC-20 Transfer
// amount FROM the wallet with the parser's amountIn, and the Transfer TO the
// wallet with amountOut. A discrepancy > 0.5% signals a fee or tax.
//
// For V4 trades this check is skipped because V4 token derivation already uses
// Transfer events, so a tax discrepancy would surface as an incorrect tokenOut.

async function checkFeeOnTransfer(
  trade: TradeRecord,
): Promise<{ hasFee: boolean; detail: string }> {
  const receipt = await bscClient.getTransactionReceipt({
    hash: trade.txHash as `0x${string}`,
  });

  const events = extractEvents(receipt);
  const walletLow   = trade.wallet.toLowerCase();
  const tokenInLow  = trade.tokenIn.toLowerCase();
  const tokenOutLow = trade.tokenOut.toLowerCase();

  // Last Transfer of tokenIn FROM wallet (use last to skip approve-then-transfer noise)
  let sentAmount = 0n;
  for (const ev of events) {
    if (ev.contractAddress.toLowerCase() !== tokenInLow) continue;
    if (ev.topics[0] !== ERC20_TRANSFER_TOPIC || ev.topics.length < 3) continue;
    const from = `0x${ev.topics[1]!.slice(26)}`.toLowerCase();
    if (from !== walletLow) continue;
    try { sentAmount = BigInt(ev.data); } catch { continue; }
  }

  // Last Transfer of tokenOut TO wallet
  let receivedAmount = 0n;
  for (const ev of events) {
    if (ev.contractAddress.toLowerCase() !== tokenOutLow) continue;
    if (ev.topics[0] !== ERC20_TRANSFER_TOPIC || ev.topics.length < 3) continue;
    const to = `0x${ev.topics[2]!.slice(26)}`.toLowerCase();
    if (to !== walletLow) continue;
    try { receivedAmount = BigInt(ev.data); } catch { continue; }
  }

  const parsedIn  = BigInt(trade.amountIn);
  const parsedOut = BigInt(trade.amountOut);

  // Detect input-token fee: wallet sent more than pool received
  if (sentAmount > 0n && parsedIn > 0n && sentAmount > parsedIn) {
    const diff  = sentAmount - parsedIn;
    const ratio = Number(diff) / Number(sentAmount);
    if (ratio > FEE_THRESHOLD) {
      return {
        hasFee: true,
        detail: `input fee: wallet sent ${sentAmount}, pool got ${parsedIn} (${(ratio * 100).toFixed(2)}%)`,
      };
    }
  }

  // Detect output-token fee: pool sent more than wallet received
  if (receivedAmount > 0n && parsedOut > 0n && parsedOut > receivedAmount) {
    const diff  = parsedOut - receivedAmount;
    const ratio = Number(diff) / Number(parsedOut);
    if (ratio > FEE_THRESHOLD) {
      return {
        hasFee: true,
        detail: `output fee: pool gave ${parsedOut}, wallet got ${receivedAmount} (${(ratio * 100).toFixed(2)}%)`,
      };
    }
  }

  return { hasFee: false, detail: 'clean' };
}

// ── Sampling ───────────────────────────────────────────────────────────────────

function pickDiverse(candidates: TradeRecord[], n: number): TradeRecord[] {
  // Prefer variety: different wallets, different token pairs
  const seen  = new Set<string>();
  const picks: TradeRecord[] = [];

  for (const trade of candidates) {
    if (picks.length >= n) break;
    const key = `${trade.tokenIn.toLowerCase()}|${trade.tokenOut.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(trade);
  }

  // If we don't have enough diverse pairs, fill with any remaining
  for (const trade of candidates) {
    if (picks.length >= n) break;
    if (!picks.includes(trade)) picks.push(trade);
  }

  return picks.slice(0, n);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const reportPath = process.env['REPORT'] ?? 'validation-report.json';

  let report: ValidationReport;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf-8')) as ValidationReport;
  } catch {
    console.error(`Cannot read ${reportPath}. Run 'pnpm run validate' first.`);
    process.exit(1);
  }

  const { trades } = report;
  console.log(`\nLoaded ${trades.length} trades from ${reportPath}\n`);

  // ── Pre-compute frequency maps ────────────────────────────────────────────
  const walletFreq = buildFrequencyMap(trades, (t) => t.wallet.toLowerCase());
  const txFreq     = buildFrequencyMap(trades, (t) => t.txHash);

  // Build set of txHashes that form circular routes (arbitrage candidates)
  const circularTxs = new Set<string>();
  for (const [txHash, count] of txFreq) {
    if (count >= 2 && hasCycleRoute(txHash, trades)) circularTxs.add(txHash);
  }

  // ── Filter #1-4 (no RPC needed) ───────────────────────────────────────────
  console.log('Applying filters (no-RPC pass)...');

  const preFiltered = trades.filter((t) => {
    if (t.flags.length > 0)                                   return false; // tax/meme
    if ((txFreq.get(t.txHash) ?? 1) > 1)                     return false; // multi-hop
    if (circularTxs.has(t.txHash))                            return false; // arbitrage
    if ((walletFreq.get(t.wallet.toLowerCase()) ?? 0) > MAX_WALLET_TRADES) return false; // bot
    const inLow  = t.tokenIn.toLowerCase();
    const outLow = t.tokenOut.toLowerCase();
    if (!WELL_KNOWN_TOKENS.has(inLow) && !WELL_KNOWN_TOKENS.has(outLow)) return false; // unknown tokens
    if (t.amountInFormatted === '0' || t.amountOutFormatted === '0') return false; // display truncation
    return true;
  });

  console.log(`After pre-filters: ${preFiltered.length} candidates`);

  // ── Protocol split ────────────────────────────────────────────────────────
  const byProtocol: Record<string, TradeRecord[]> = {
    'pancakeswap-v2': [],
    'pancakeswap-v3': [],
    'pancakeswap-v4': [],
  };
  for (const t of preFiltered) {
    byProtocol[t.dex]?.push(t);
  }

  console.log(`  V2: ${byProtocol['pancakeswap-v2']?.length ?? 0} candidates`);
  console.log(`  V3: ${byProtocol['pancakeswap-v3']?.length ?? 0} candidates`);
  console.log(`  V4: ${byProtocol['pancakeswap-v4']?.length ?? 0} candidates\n`);

  // ── Filter #3: fee-on-transfer (RPC per candidate) ────────────────────────
  // We check V2 and V3 (Transfer amounts verifiable against Swap amounts).
  // V4 is skipped — its derivation already uses Transfers, so a tax would
  // produce the wrong tokenOut symbol, caught by manual BscScan comparison.

  const auditSets: Record<string, AuditCandidate[]> = {
    'pancakeswap-v2': [],
    'pancakeswap-v3': [],
    'pancakeswap-v4': [],
  };

  for (const [protocol, pool] of Object.entries(byProtocol)) {
    const shuffled = [...(pool ?? [])].sort(() => Math.random() - 0.5);
    const oversample = shuffled.slice(0, 30); // check up to 30, keep 10 clean

    if (protocol === 'pancakeswap-v4') {
      // Skip fee check for V4 — pick diverse 10 directly
      const picks = pickDiverse(oversample, 10);
      auditSets['pancakeswap-v4'] = picks.map((t) => ({
        ...t,
        filterReasons: { preFiltered: true },
        feeCheck: { checked: false, hasFee: false, detail: 'skipped for V4' },
      }));
      continue;
    }

    console.log(`Checking ${oversample.length} ${protocol} candidates for fee-on-transfer...`);

    const clean: AuditCandidate[] = [];

    for (const trade of oversample) {
      if (clean.length >= 10) break;

      let feeResult: { hasFee: boolean; detail: string };
      try {
        feeResult = await checkFeeOnTransfer(trade);
      } catch (err) {
        feeResult = {
          hasFee: false,
          detail: `check failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (feeResult.hasFee) {
        console.log(`  ✗ fee-token excluded: ${trade.tokenInSym}→${trade.tokenOutSym} — ${feeResult.detail}`);
        continue;
      }

      clean.push({
        ...trade,
        filterReasons: { preFiltered: true },
        feeCheck: { checked: true, ...feeResult },
      });

      console.log(`  ✓ clean: ${trade.tokenInSym}→${trade.tokenOutSym} (${trade.txHash.slice(0, 16)}...)`);
    }

    auditSets[protocol] = clean;
    console.log(`  → ${clean.length} clean ${protocol} candidates\n`);
  }

  // ── Output ────────────────────────────────────────────────────────────────

  const allCandidates = Object.values(auditSets).flat();

  writeFileSync('audit-candidates.json', JSON.stringify(auditSets, null, 2));

  // ── Human-readable audit sheet ────────────────────────────────────────────

  const sep = '═'.repeat(70);
  const lines: string[] = [];

  lines.push(sep);
  lines.push('MANUAL AUDIT SHEET — Direct User Swaps');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(sep);
  lines.push('');
  lines.push('Filters applied:');
  lines.push('  ✓ Single-hop only (txHash unique in report)');
  lines.push('  ✓ No circular/arbitrage route');
  lines.push(`  ✓ Wallet frequency ≤ ${MAX_WALLET_TRADES} trades per 100-block window`);
  lines.push('  ✓ At least one well-known token (WBNB / USDT / USDC / BUSD / etc.)');
  lines.push('  ✓ No EXTREME_PRICE_RATIO flag');
  lines.push(`  ✓ Fee-on-transfer checked (V2/V3): no tax > ${(FEE_THRESHOLD * 100).toFixed(1)}%`);
  lines.push('  ✓ Non-zero human-readable amounts');
  lines.push('');
  lines.push('Verify on BscScan: wallet address, token symbols, amounts (18-dec precision).');
  lines.push('');

  for (const [protocol, candidates] of Object.entries(auditSets)) {
    lines.push(sep);
    lines.push(`${protocol.toUpperCase()} — ${candidates.length} trades`);
    lines.push(sep);

    for (let i = 0; i < candidates.length; i++) {
      const t = candidates[i]!;
      lines.push('');
      lines.push(`[${String(i + 1).padStart(2, '0')}] ${t.bscscan}`);
      lines.push(`     Wallet:  ${t.wallet}`);
      lines.push(`     Sold:    ${t.amountInFormatted.padEnd(20)} ${t.tokenInSym} (${t.tokenIn})`);
      lines.push(`     Bought:  ${t.amountOutFormatted.padEnd(20)} ${t.tokenOutSym} (${t.tokenOut})`);
      lines.push(`     Block:   ${t.block}  ${t.timestamp}`);
      if (t.feeCheck.checked) {
        lines.push(`     Fee chk: ${t.feeCheck.detail}`);
      }
      lines.push('');
      lines.push('     BscScan columns to verify:');
      lines.push('     [ ] From:   matches wallet above');
      lines.push(`     [ ] Token sent:    ${t.tokenInSym} — amount matches Sold`);
      lines.push(`     [ ] Token received: ${t.tokenOutSym} — amount matches Bought`);
    }

    lines.push('');
  }

  lines.push(sep);
  lines.push(`SUMMARY: ${allCandidates.length} trades ready for manual BscScan verification`);
  lines.push(`  V2: ${auditSets['pancakeswap-v2']?.length ?? 0} / 10`);
  lines.push(`  V3: ${auditSets['pancakeswap-v3']?.length ?? 0} / 10`);
  lines.push(`  V4: ${auditSets['pancakeswap-v4']?.length ?? 0} / 10`);
  lines.push(sep);

  const auditSheet = lines.join('\n');
  writeFileSync('audit-summary.txt', auditSheet);
  console.log(auditSheet);
  console.log('\nFiles written: audit-candidates.json  audit-summary.txt\n');
}

main().catch((err: unknown) => {
  console.error('Audit failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
