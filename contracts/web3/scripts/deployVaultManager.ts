import { ethers } from 'hardhat';

const AUSD_ADDRESS   = process.env.AUSD_ADDRESS   ?? '';
// The off-chain keeper wallet that pushes prices + drives copy trades.
// Set this to the address derived from watcher/.env KEEPER_PRIVATE_KEY.
const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS ?? '';

async function main() {
  if (!AUSD_ADDRESS) {
    console.error('ERROR: Set AUSD_ADDRESS in .env before deploying VaultManager');
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();

  console.log('Deploying VaultManager...');
  console.log('Deployer:    ', deployer.address);
  console.log('Balance:     ', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'MNT');
  console.log('aUSD address:', AUSD_ADDRESS, '\n');

  const VaultManager = await ethers.getContractFactory('VaultManager');
  const vm           = await VaultManager.deploy(AUSD_ADDRESS);
  await vm.waitForDeployment();

  const vmAddress = await vm.getAddress();

  console.log('VaultManager deployed to:', vmAddress);
  console.log('\nVerify:');
  console.log('  AUSD:  ', await vm.AUSD());
  console.log('  owner: ', await vm.owner());

  // ── Whitelist VaultManager as aUSD minter ─────────────────────────────────
  console.log('\nWhitelisting VaultManager as aUSD minter...');
  const ausd = await ethers.getContractAt('aUSD', AUSD_ADDRESS);
  const tx   = await ausd.addMinter(vmAddress);
  await tx.wait();
  console.log('  Done. VaultManager can now mint aUSD for P&L settlement.');
  console.log('  Minter confirmed:', await ausd.minters(vmAddress));

  // ── Set the keeper/oracle (price + copy-trade pusher) ─────────────────────
  if (ORACLE_ADDRESS) {
    console.log('\nSetting oracle (keeper) to', ORACLE_ADDRESS, '...');
    const tx2 = await vm.setOracle(ORACLE_ADDRESS);
    await tx2.wait();
    console.log('  oracle:', await vm.oracle());
  } else {
    console.log('\nNOTE: ORACLE_ADDRESS not set — oracle is unset (address(0)).');
    console.log('      Run vm.setOracle(<keeper address>) before the keeper can push prices/trades.');
  }

  console.log('\nNext steps:');
  console.log('  1. Copy to frontend/.env.local:  NEXT_PUBLIC_VAULT_MANAGER_ADDRESS=' + vmAddress);
  console.log('  2. Copy to watcher/.env:         VAULT_MANAGER_ADDRESS=' + vmAddress);
  console.log('  3. Ensure the keeper wallet (KEEPER_PRIVATE_KEY) == the oracle address set above,');
  console.log('     and that each follower delegates it via setKeeper (frontend handles this).');
}

main().catch((e) => { console.error(e); process.exit(1); });
