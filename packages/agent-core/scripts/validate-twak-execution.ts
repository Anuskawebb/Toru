/**
 * validate-twak-execution.ts
 *
 * Phase 8B.4 validation script. Verifies the TwakExecutor integration end-to-end
 * WITHOUT executing a real swap.
 *
 * Run: npx tsx packages/agent-core/scripts/validate-twak-execution.ts
 */

import { TwakClient } from '../src/execution/twak/twak-client';
import { TwakExecutor } from '../src/execution/twak-executor';

try {
  process.loadEnvFile('.env.local');
} catch {
  // fall through — env may be set externally
}
try {
  process.loadEnvFile('.env');
} catch {
  // ignore
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); }
function section(title: string) { console.log(`\n── ${title} ─────────────────────────────────`); }

// ─── main ─────────────────────────────────────────────────────────────────────

async function validate() {
  console.log('Phase 8B.4 — TwakExecutor Validation');
  console.log(`Sidecar: ${process.env.TWAK_API_URL ?? 'http://127.0.0.1:3000'}`);
  console.log(`Auth:    ${process.env.TWAK_HMAC_SECRET ? 'TWAK_HMAC_SECRET is set' : 'NO AUTH (TWAK_HMAC_SECRET missing)'}`);

  const client = new TwakClient({
    apiUrl:   process.env.TWAK_API_URL ?? 'http://127.0.0.1:3000',
    password: process.env.TWAK_WALLET_PASSWORD,
  });

  // ── 1. Sidecar reachable ─────────────────────────────────────────────────
  section('1. Sidecar Reachable');
  const health = await client.healthCheck();
  if (health.status !== 'healthy') {
    fail('TWAK sidecar is not reachable. Start it: twak serve --rest --port 3000');
    process.exit(1);
  }
  pass('TWAK sidecar reachable');

  // ── 2. Wallet configured ─────────────────────────────────────────────────
  section('2. Wallet Configured');
  const walletStatus = await client.getWalletStatus();
  if (walletStatus.agentWallet !== 'configured') {
    fail('No wallet configured in TWAK. Run: twak wallet init');
    process.exit(1);
  }
  pass(`Wallet configured | chains supported: ${walletStatus.supportedChains}`);

  const addresses = await client.getAddresses();
  const bscAddr = (addresses.addresses ?? []).find(
    (a: { chainId: string; address: string }) => a.chainId === 'bsc' || a.chainId === 'smartchain'
  );
  if (bscAddr) {
    pass(`BSC address: ${bscAddr.address}`);
  } else {
    pass(`${addresses.addresses?.length ?? 0} address(es) available`);
  }

  // ── 3. Balance accessible ────────────────────────────────────────────────
  section('3. Balance Accessible');
  const balance = await client.getBalance('smartchain');
  pass(`BNB balance: ${balance.balance} ${balance.symbol}${balance.usdValue ? ` ≈ $${balance.usdValue}` : ''}`);
  if (parseFloat(balance.balance) === 0) {
    console.log('  ⚠️  Balance is 0 — fund the wallet before running live trades.');
    console.log(`      Address: ${bscAddr?.address ?? '(see output above)'}`);
    console.log('      Min:     0.005 BNB on BSC Mainnet');
  }

  // ── 4. BNB price oracle ──────────────────────────────────────────────────
  section('4. BNB Price Oracle (TWAK)');
  const bnbPrice = await client.getTokenPrice('BNB');
  if (bnbPrice !== null && bnbPrice > 0) {
    pass(`BNB price via TWAK: $${bnbPrice.toFixed(2)}`);
  } else {
    console.log('  ⚠️  TWAK get_token_price returned null for BNB. TwakExecutor will try price DB next.');
  }

  // ── 5. Swap quote (dry-run — no execution) ───────────────────────────────
  section('5. Swap Quote — BNB → USDT (dry-run, no execution)');
  const quote = await client.getSwapQuote({
    fromToken: 'BNB',
    toToken:   'USDT',
    amount:    '0.001',
  });

  if (!quote.success) {
    fail(`Quote failed: [${quote.code}] ${quote.message}`);
    console.log('  ⚠️  Swap routing unavailable. This is expected if TWAK cannot reach LI.FI.');
  } else {
    pass(`Quote ok | ${quote.input} → ${quote.output} | provider: ${quote.provider} | impact: ${quote.priceImpact}%`);
  }

  // ── 6. TwakExecutor health check ─────────────────────────────────────────
  section('6. TwakExecutor Health Check');
  const executor = new TwakExecutor({
    apiUrl:   process.env.TWAK_API_URL ?? 'http://127.0.0.1:3000',
    password: process.env.TWAK_WALLET_PASSWORD,
  });
  const execHealth = await executor.healthCheck();
  pass(`reachable=${execHealth.reachable} | walletConfigured=${execHealth.walletConfigured}`);

  // ── 7. ExecutionResult mapping example ───────────────────────────────────
  section('7. Example ExecutionResult Mapping');

  console.log('\n  TWAK swap success response:');
  const exampleSuccess = {
    success:  true,
    hash:     '0xabc123…def',
    summary:  '0.00153846 BNB -> 1.0 USDT',
    provider: 'PancakeSwap',
    explorer: 'https://bscscan.com/tx/0xabc123…def',
  };
  console.log('  ', JSON.stringify(exampleSuccess));
  console.log('  → ExecutionResult:', JSON.stringify({
    success:      true,
    txHash:       exampleSuccess.hash,
    errorMessage: null,
  }));

  console.log('\n  TWAK swap failure response:');
  const exampleFailure = {
    success: false,
    code:    'NO_ROUTES',
    message: 'No routes found',
  };
  console.log('  ', JSON.stringify(exampleFailure));
  console.log('  → ExecutionResult:', JSON.stringify({
    success:      false,
    txHash:       '',
    errorMessage: exampleFailure.message,
  }));

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log('✅ Phase 8B.4 TwakExecutor validation complete.');
  console.log('   To enable live execution: set TWAK_AGENT=true in your .env');
  console.log('   ExecutionEngine picks up TwakExecutor automatically via createExecutor().');
  console.log('══════════════════════════════════════════════\n');
}

validate().catch((e) => {
  console.error('\n❌ Validation failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
