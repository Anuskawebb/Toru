import { ethers } from 'hardhat';

// ─────────────────────────────────────────────────────────────────────────────
//  Phase 1 end-to-end test (Mantle Sepolia) — validates the de-Somnia,
//  keeper-driven copy-trade pipeline WITHOUT needing the watcher/frontend/DB.
//
//  Flow (all as the deployer, who is owner + oracle + follower for the test):
//    1. mint aUSD to the follower + approve VaultManager
//    2. createVault for a fresh random leader
//    3. setPrice(entry) → executeCopyTrade  → assert a position opened
//    4. setPrice(+20%)  → closePosition      → assert profit was settled
//
//  Run:  npx hardhat run scripts/testPhase1.ts --network mantleSepolia
//  Needs in contracts/web3/.env:  PRIVATE_KEY, AUSD_ADDRESS, VAULT_MANAGER_ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

const AUSD_ADDRESS = process.env.AUSD_ADDRESS         ?? '';
const VM_ADDRESS   = process.env.VAULT_MANAGER_ADDRESS ?? '';

// A real Mantle token address (WMNT) for realism — the position is virtual so any
// non-zero address works.
const TOKEN = ethers.getAddress('0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8');

const usd  = (n: bigint) => ethers.formatUnits(n, 6) + ' aUSD';
const ok   = (label: string) => console.log('  ✅', label);
const fail = (label: string): never => { throw new Error('ASSERT FAILED: ' + label); };

async function main() {
  if (!AUSD_ADDRESS || !VM_ADDRESS) {
    console.error('ERROR: set AUSD_ADDRESS and VAULT_MANAGER_ADDRESS in contracts/web3/.env');
    process.exit(1);
  }

  const [me] = await ethers.getSigners();           // owner + oracle + follower
  const leader = ethers.Wallet.createRandom().address; // fresh leader → fresh vault each run

  console.log('Phase 1 test on Mantle Sepolia');
  console.log('  signer (follower/oracle):', me.address);
  console.log('  leader (random):         ', leader);
  console.log('  VaultManager:            ', VM_ADDRESS);
  console.log('  aUSD:                    ', AUSD_ADDRESS, '\n');

  const ausd = await ethers.getContractAt('aUSD', AUSD_ADDRESS);
  const vm   = await ethers.getContractAt('VaultManager', VM_ADDRESS);

  // ── 1. Fund the follower with aUSD + approve VaultManager ──────────────────
  const deposit = 1_000_000_000n; // $1,000
  console.log('1) Minting + approving aUSD...');
  await (await ausd.mint(me.address, deposit)).wait();
  await (await ausd.approve(VM_ADDRESS, deposit)).wait();
  ok(`minted & approved ${usd(deposit)}`);

  // ── 2. Make sure the signer is the oracle, then create the vault ───────────
  console.log('\n2) Ensuring oracle + creating vault...');
  await (await vm.setOracle(me.address)).wait();
  const limits = {
    slippageBps:       2000,  // 20% — generous for the test
    minLeaderTradeUsd: 0n,
    maxLeaderTradeUsd: 0n,
    minAllocUsd:       0n,
    maxAllocUsd:       0n,
  };
  await (await vm.createVault(leader, deposit, 10, 50, [TOKEN], limits)).wait();
  ok('vault created (risk 10, maxPerTrade 50%, allowlist=[WMNT])');

  // ── 3. setPrice(entry) + executeCopyTrade ──────────────────────────────────
  console.log('\n3) Pushing entry price + executing copy trade...');
  const entryPrice = 10_000_000_000n;   // $1.00 × 1e10
  await (await vm.setPrice(TOKEN, entryPrice)).wait();

  const block = await ethers.provider.getBlock('latest');
  const tradeTs = BigInt(block!.timestamp) - 10n;   // 10s ago — fresh, no underflow
  const usdValue = 100_000_000n;        // $100 leader trade
  const score    = 80;
  await (await vm.executeCopyTrade(me.address, leader, TOKEN, usdValue, entryPrice, tradeTs, score)).wait();

  const openIds: string[] = await vm.getOpenPositions(me.address, leader);
  if (openIds.length !== 1) fail(`expected 1 open position, got ${openIds.length}`);
  const posId = openIds[0];
  const pos = await vm.positions(posId);
  // expected allocation = maxTrade(500) × score(80%) = $400
  const expectedAlloc = 400_000_000n;
  if (pos.ausdAllocated !== expectedAlloc) fail(`alloc ${usd(pos.ausdAllocated)} != ${usd(expectedAlloc)}`);
  if (pos.entryPrice !== entryPrice)       fail(`entryPrice ${pos.entryPrice} != ${entryPrice}`);
  ok(`position opened — allocated ${usd(pos.ausdAllocated)} @ entry $1.00`);

  // ── 4. setPrice(+20%) + closePosition → profit settles ─────────────────────
  console.log('\n4) Price +20% → closing position...');
  const exitPrice = 12_000_000_000n;    // $1.20 × 1e10
  await (await vm.setPrice(TOKEN, exitPrice)).wait();
  await (await vm.closePosition(posId)).wait();

  const closed = await vm.positions(posId);
  if (Number(closed.status) !== 1) fail(`position status ${closed.status} != CLOSED(1)`);
  const expectedPnl = 80_000_000n;      // +$80 (20% of $400)
  if (closed.pnl !== expectedPnl) fail(`pnl ${usd(closed.pnl)} != ${usd(expectedPnl)}`);
  ok(`position closed — realised P&L = +${usd(closed.pnl)} (20% gain)`);

  const vault = await vm.getVault(me.address, leader);
  ok(`vault total after profit = ${usd(vault.ausdLocked)} (started $1,000, +$80 minted)`);

  console.log('\n🎉 PHASE 1 PASSED — Mantle-native copy-trade pipeline works end to end.');
  console.log('   (vault → score → executeCopyTrade → position → close → P&L, no Somnia.)');
}

main().catch((e) => { console.error('\n❌ TEST FAILED:\n', e); process.exit(1); });
