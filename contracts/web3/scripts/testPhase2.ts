import { ethers } from 'hardhat';

// ─────────────────────────────────────────────────────────────────────────────
//  Phase 2 end-to-end test (Mantle Sepolia) — REAL DEX swaps.
//
//  Deploys a SimpleAMM (aUSD <-> mWMNT) + seeds liquidity, points VaultManager at
//  it, then runs a full copy trade where the position is a REAL on-chain swap:
//    1. deploy MockWMNT + SimpleAMM, seed pool (~$1/mWMNT)
//    2. vm.setDex(amm)
//    3. createVault → executeCopyTrade  → vault really swaps aUSD → mWMNT
//    4. push mWMNT price up (a big swap on the pool)
//    5. closePosition → vault really swaps mWMNT → aUSD → REAL profit
//
//  Run:  npx hardhat run scripts/testPhase2.ts --network mantleSepolia
//  Needs in .env:  PRIVATE_KEY, AUSD_ADDRESS, VAULT_MANAGER_ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

const AUSD_ADDRESS = process.env.AUSD_ADDRESS          ?? '';
const VM_ADDRESS   = process.env.VAULT_MANAGER_ADDRESS ?? '';

const aUSD = (n: bigint) => ethers.formatUnits(n, 6) + ' aUSD';
const ok   = (s: string) => console.log('  ✅', s);
const fail = (s: string): never => { throw new Error('ASSERT FAILED: ' + s); };

async function main() {
  if (!AUSD_ADDRESS || !VM_ADDRESS) {
    console.error('ERROR: set AUSD_ADDRESS and VAULT_MANAGER_ADDRESS in contracts/web3/.env');
    process.exit(1);
  }

  const [me] = await ethers.getSigners();
  const leader = ethers.Wallet.createRandom().address;

  console.log('Phase 2 test (REAL DEX swaps) on Mantle Sepolia');
  console.log('  signer:', me.address, '\n');

  const ausd = await ethers.getContractAt('aUSD', AUSD_ADDRESS);
  const vm   = await ethers.getContractAt('VaultManager', VM_ADDRESS);

  // ── 1. Deploy mWMNT + SimpleAMM and seed ~$1/mWMNT liquidity ───────────────
  console.log('1) Deploying DEX + seeding liquidity...');
  const mwmnt = await (await ethers.getContractFactory('MockWMNT')).deploy();
  await mwmnt.waitForDeployment();
  const mwmntAddr = await mwmnt.getAddress();

  const amm = await (await ethers.getContractFactory('SimpleAMM')).deploy(AUSD_ADDRESS, mwmntAddr);
  await amm.waitForDeployment();
  const ammAddr = await amm.getAddress();

  const seedA = ethers.parseUnits('100000', 6);   // 100k aUSD
  const seedB = ethers.parseUnits('100000', 18);  // 100k mWMNT  → ~$1 each
  await (await ausd.mint(me.address, ethers.parseUnits('200000', 6))).wait();
  await (await mwmnt.mint(me.address, seedB)).wait();
  await (await ausd.approve(ammAddr, seedA)).wait();
  await (await mwmnt.approve(ammAddr, seedB)).wait();
  await (await amm.addLiquidity(seedA, seedB)).wait();
  ok(`AMM ${ammAddr.slice(0, 10)}… seeded 100k aUSD / 100k mWMNT (~$1)`);

  // ── 2. Point VaultManager at the DEX ───────────────────────────────────────
  console.log('\n2) Wiring VaultManager → DEX...');
  await (await vm.setDex(ammAddr)).wait();
  await (await vm.setOracle(me.address)).wait();
  ok('vm.setDex + setOracle done');

  // ── 3. Create vault (allowlist = mWMNT) + execute a real copy trade ────────
  console.log('\n3) Creating vault + executing copy trade (real swap)...');
  const deposit = ethers.parseUnits('1000', 6);
  await (await ausd.approve(VM_ADDRESS, deposit)).wait();
  const limits = { slippageBps: 2000, minLeaderTradeUsd: 0n, maxLeaderTradeUsd: 0n, minAllocUsd: 0n, maxAllocUsd: 0n };
  await (await vm.createVault(leader, deposit, 10, 50, [mwmntAddr], limits)).wait();
  await (await vm.setPrice(mwmntAddr, ethers.parseUnits('1', 10))).wait();

  const block = await ethers.provider.getBlock('latest');
  const tradeTs = BigInt(block!.timestamp) - 10n;
  await (await vm.executeCopyTrade(me.address, leader, mwmntAddr, ethers.parseUnits('100', 6), ethers.parseUnits('1', 10), tradeTs, 80)).wait();

  const openIds: string[] = await vm.getOpenPositions(me.address, leader);
  if (openIds.length !== 1) fail(`expected 1 position, got ${openIds.length}`);
  const posId = openIds[0];
  const pos = await vm.positions(posId);
  if (pos.tokenAmount === 0n) fail('tokenAmount is 0 — no real swap happened');
  ok(`position opened — spent ${aUSD(pos.ausdAllocated)} → received ${ethers.formatUnits(pos.tokenAmount, 18)} mWMNT (REAL swap)`);

  // ── 4. Push mWMNT price up with a large buy on the pool ────────────────────
  console.log('\n4) Moving the market (+price) before close...');
  const pump = ethers.parseUnits('50000', 6);
  await (await ausd.approve(ammAddr, pump)).wait();
  await (await amm.swap(AUSD_ADDRESS, pump, 0n, me.address)).wait();
  const quoteAfter = await amm.quote(mwmntAddr, ethers.parseUnits('1', 18));
  ok(`mWMNT now ≈ ${ethers.formatUnits(quoteAfter, 6)} aUSD each (was ~$1)`);

  // ── 5. Close → real swap back to aUSD → realised profit ────────────────────
  console.log('\n5) Closing position (real swap back to aUSD)...');
  await (await vm.closePosition(posId)).wait();
  const closed = await vm.positions(posId);
  if (Number(closed.status) !== 1) fail(`status ${closed.status} != CLOSED(1)`);
  if (closed.pnl <= 0n) fail(`expected positive realised P&L, got ${closed.pnl}`);
  ok(`position closed — REAL realised P&L = +${aUSD(closed.pnl)}`);

  const vault = await vm.getVault(me.address, leader);
  ok(`vault total now = ${aUSD(vault.ausdLocked)} (started 1000, profit from real swaps)`);

  console.log('\n🎉 PHASE 2 PASSED — copy trades now execute as REAL on-chain DEX swaps,');
  console.log('   with real token movement and real swap-derived P&L (no minting).');
  console.log('   DEX (SimpleAMM):', ammAddr);
  console.log('   mWMNT:          ', mwmntAddr);
}

main().catch((e) => { console.error('\n❌ TEST FAILED:\n', e); process.exit(1); });
