import { ethers } from 'hardhat';

const AUSD_ADDRESS    = process.env.AUSD_ADDRESS    ?? '';
// Deploy with empty strings to save gas — call setApiBase after deployment
const API_BASE        = process.env.API_BASE        ?? '';
const PRICE_API_BASE  = process.env.PRICE_API_BASE  ?? '';

async function main() {
  if (!AUSD_ADDRESS) {
    console.error('ERROR: Set AUSD_ADDRESS in .env before deploying VaultManager');
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();

  console.log('Deploying VaultManager...');
  console.log('Deployer:      ', deployer.address);
  console.log('Balance:       ', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'MNT');
  console.log('aUSD address:  ', AUSD_ADDRESS);
  console.log('API base:      ', API_BASE);
  console.log('Price API base:', PRICE_API_BASE, '\n');

  const VaultManager = await ethers.getContractFactory('VaultManager');
  const vm           = await VaultManager.deploy(AUSD_ADDRESS, API_BASE, PRICE_API_BASE);
  await vm.waitForDeployment();

  const vmAddress = await vm.getAddress();

  console.log('VaultManager deployed to:', vmAddress);
  console.log('\nVerify:');
  console.log('  AUSD:           ', await vm.AUSD());
  console.log('  Agent Platform: ', await vm.AGENT_PLATFORM());
  console.log('  API_BASE:       ', await vm.API_BASE());
  console.log('  PRICE_API_BASE: ', await vm.PRICE_API_BASE());

  // ── Whitelist VaultManager as aUSD minter ─────────────────────────────────
  console.log('\nWhitelisting VaultManager as aUSD minter...');
  const ausd = await ethers.getContractAt('aUSD', AUSD_ADDRESS);
  const tx   = await ausd.addMinter(vmAddress);
  await tx.wait();
  console.log('  Done. VaultManager can now mint aUSD for P&L settlement.');
  console.log('  Minter confirmed:', await ausd.minters(vmAddress));

  // ── Set API URLs via setApiBase ───────────────────────────────────────────
  // The Agent Platform calls back over the public internet, so this must be
  // the ngrok tunnel URL (or other public origin), not localhost.
  const origin        = process.env.NGROK_URL ?? 'http://localhost:3001';
  const apiBase       = `${origin}/api/agent/leader/`;
  const priceApiBase  = `${origin}/api/price/`;
  console.log('\nSetting API URLs...');
  const tx2 = await vm.setApiBase(apiBase);
  await tx2.wait();
  const tx3 = await vm.setPriceApiBase(priceApiBase);
  await tx3.wait();
  console.log('  API_BASE:      ', await vm.API_BASE());
  console.log('  PRICE_API_BASE:', await vm.PRICE_API_BASE());

  console.log('\nNext steps:');
  console.log('  1. Copy to .env.local:  NEXT_PUBLIC_VAULT_MANAGER_ADDRESS=' + vmAddress);
  console.log('  2. Copy to watcher/.env: VAULT_MANAGER_ADDRESS=' + vmAddress);
  console.log('  3. NOTE: checkLeaderActivity/updatePrice depend on IAgentPlatform,');
  console.log('     which has no Mantle equivalent yet — these calls will revert until');
  console.log('     the on-chain agent pipeline is rebuilt for Mantle (see docs).');
}

main().catch((e) => { console.error(e); process.exit(1); });
