import { ethers } from 'hardhat';

// ─────────────────────────────────────────────────────────────────────────────
//  V2-router (FusionX-compatible) integration test on Mantle Sepolia.
//
//  VaultManager now talks to the DEX through the standard UniswapV2 / FusionX
//  router interface (getAmountsOut + swapExactTokensForTokens). FusionX V2 is NOT
//  functionally deployed on Mantle Sepolia (5003) — its documented addresses are
//  the old Mantle testnet (5001) — so on testnet we run our own V2-compatible
//  SimpleAMM as the `dex`. On MAINNET, point `dex` at the real FusionX V2 router
//  (0x45e6…0033) — zero contract changes, same interface.
//
//  Run:  npx hardhat run scripts/testFusionX.ts --network mantleSepolia
//  Needs in .env:  PRIVATE_KEY, AUSD_ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

const AUSD_ADDRESS = process.env.AUSD_ADDRESS ?? '';

const aUSD = (n: bigint) => ethers.formatUnits(n, 6) + ' aUSD';
const ok   = (s: string) => console.log('  ✅', s);
const fail = (s: string): never => { throw new Error('ASSERT FAILED: ' + s); };

async function main() {
  if (!AUSD_ADDRESS) { console.error('ERROR: set AUSD_ADDRESS in .env'); process.exit(1); }
  const [me] = await ethers.getSigners();
  const leader = ethers.Wallet.createRandom().address;
  console.log('V2-router (FusionX-compatible) test on Mantle Sepolia');
  console.log('  signer:', me.address, '\n');

  const ausd = await ethers.getContractAt('aUSD', AUSD_ADDRESS);

  // ── 1. Deploy VaultManager (FusionX/V2 router interface) ───────────────────
  console.log('1) Deploying VaultManager + V2 DEX...');
  const vm = await (await ethers.getContractFactory('VaultManager')).deploy(AUSD_ADDRESS);
  await vm.waitForDeployment();
  const vmAddr = await vm.getAddress();

  const mwmnt = await (await ethers.getContractFactory('MockWMNT')).deploy();
  await mwmnt.waitForDeployment();
  const mwmntAddr = await mwmnt.getAddress();

  const amm = await (await ethers.getContractFactory('SimpleAMM')).deploy(AUSD_ADDRESS, mwmntAddr);
  await amm.waitForDeployment();
  const ammAddr = await amm.getAddress();
  ok(`VaultManager ${vmAddr.slice(0,10)}…  DEX ${ammAddr.slice(0,10)}…  mWMNT ${mwmntAddr.slice(0,10)}…`);

  // ── 2. Seed pool (~$1/mWMNT) ───────────────────────────────────────────────
  console.log('\n2) Seeding pool...');
  const seedA = ethers.parseUnits('50000', 6);
  const seedB = ethers.parseUnits('50000', 18);
  await (await ausd.mint(me.address, ethers.parseUnits('150000', 6))).wait();
  await (await mwmnt.mint(me.address, seedB)).wait();
  await (await ausd.approve(ammAddr, seedA)).wait();
  await (await mwmnt.approve(ammAddr, seedB)).wait();
  await (await amm.addLiquidity(seedA, seedB)).wait();
  ok('seeded 50k aUSD / 50k mWMNT');

  // ── 3. Wire + vault + copy trade (V2 swap) ─────────────────────────────────
  console.log('\n3) Wiring + executeCopyTrade (V2 swap)...');
  await (await vm.setDex(ammAddr)).wait();
  await (await vm.setOracle(me.address)).wait();
  const deposit = ethers.parseUnits('1000', 6);
  await (await ausd.approve(vmAddr, deposit)).wait();
  const limits = { slippageBps: 2000, minLeaderTradeUsd: 0n, maxLeaderTradeUsd: 0n, minAllocUsd: 0n, maxAllocUsd: 0n };
  await (await vm.createVault(leader, deposit, 10, 50, [mwmntAddr], limits)).wait();
  await (await vm.setPrice(mwmntAddr, ethers.parseUnits('1', 10))).wait();
  const ts = BigInt((await ethers.provider.getBlock('latest'))!.timestamp) - 10n;
  await (await vm.executeCopyTrade(me.address, leader, mwmntAddr, ethers.parseUnits('100', 6), ethers.parseUnits('1', 10), ts, 80)).wait();

  const openIds: string[] = await vm.getOpenPositions(me.address, leader);
  if (openIds.length !== 1) fail(`expected 1 position, got ${openIds.length}`);
  const pos = await vm.positions(openIds[0]);
  if (pos.tokenAmount === 0n) fail('tokenAmount 0 — V2 swap did not happen');
  ok(`position opened via V2 router — ${aUSD(pos.ausdAllocated)} → ${ethers.formatUnits(pos.tokenAmount, 18)} mWMNT`);

  // ── 4. Move price + close → real P&L ───────────────────────────────────────
  console.log('\n4) Moving price + closing...');
  await (await ausd.approve(ammAddr, ethers.parseUnits('25000', 6))).wait();
  await (await amm.swap(AUSD_ADDRESS, ethers.parseUnits('25000', 6), 0, me.address)).wait();
  await (await vm.closePosition(openIds[0])).wait();
  const closed = await vm.positions(openIds[0]);
  if (Number(closed.status) !== 1) fail(`status ${closed.status} != CLOSED`);
  if (closed.pnl <= 0n) fail(`expected positive P&L, got ${closed.pnl}`);
  ok(`closed via V2 router — REAL realised P&L = +${aUSD(closed.pnl)}`);

  console.log('\n🎉 PASSED — VaultManager executes via the FusionX/UniswapV2 router interface.');
  console.log('   Testnet dex (V2-compatible SimpleAMM):', ammAddr);
  console.log('   On mainnet, set dex = real FusionX V2 router 0x45e6f621c5ED8616cCFB9bBaeBAcF9638aBB0033 (no code change).');
  console.log('   VaultManager:', vmAddr, '  mWMNT:', mwmntAddr);
  console.log('\n   Update .env / frontend:  VAULT_MANAGER_ADDRESS=' + vmAddr);
}

main().catch((e) => { console.error('\n❌ FAILED:\n', e); process.exit(1); });
