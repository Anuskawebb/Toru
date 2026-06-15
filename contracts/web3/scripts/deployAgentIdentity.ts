import { ethers } from 'hardhat';

// ─────────────────────────────────────────────────────────────────────────────
//  Phase 3 — ERC-8004 agent identity (Mantle Sepolia).
//
//  Deploys the AgentIdentityRegistry and registers the Aether copy-trading agent
//  as an on-chain ERC-8004 "Trustless Agent": mints an identity NFT (agentId)
//  with an agentURI (registration file, embedded as a data: URI) + metadata
//  linking it to the live VaultManager. Self-verifies the registration.
//
//  Run:  npx hardhat run scripts/deployAgentIdentity.ts --network mantleSepolia
//  Needs in .env:  PRIVATE_KEY, VAULT_MANAGER_ADDRESS, AUSD_ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

const VM_ADDRESS   = process.env.VAULT_MANAGER_ADDRESS ?? '';
const AUSD_ADDRESS = process.env.AUSD_ADDRESS          ?? '';

const ok   = (s: string) => console.log('  ✅', s);
const fail = (s: string): never => { throw new Error('ASSERT FAILED: ' + s); };

async function main() {
  if (!VM_ADDRESS || !AUSD_ADDRESS) {
    console.error('ERROR: set VAULT_MANAGER_ADDRESS and AUSD_ADDRESS in contracts/web3/.env');
    process.exit(1);
  }
  const [me] = await ethers.getSigners();
  console.log('Phase 3 — ERC-8004 agent identity on Mantle Sepolia');
  console.log('  signer:', me.address, '\n');

  // ── 1. Deploy the Identity Registry ────────────────────────────────────────
  console.log('1) Deploying AgentIdentityRegistry...');
  const registry = await (await ethers.getContractFactory('AgentIdentityRegistry')).deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  ok(`registry deployed → ${registryAddr}`);

  // ── 2. Build the ERC-8004 agent registration file (agent card) ─────────────
  const agentCard = {
    name: 'Aether Copy-Trading Agent',
    description:
      'Autonomous AI agent that mirrors top traders on Mantle via non-custodial ' +
      'on-chain vaults, with AI trade scoring, real DEX execution and stop-loss risk control.',
    version: '1.0.0',
    capabilities: ['copy-trading', 'ai-scoring', 'dex-execution', 'risk-management', 'stop-loss'],
    chain: 'mantle-sepolia',
    chainId: 5003,
    contracts: { vaultManager: VM_ADDRESS, aUSD: AUSD_ADDRESS },
    trustModels: ['reputation', 'validation'],
  };
  const agentURI =
    'data:application/json;base64,' + Buffer.from(JSON.stringify(agentCard)).toString('base64');

  // ── 3. Register the agent (mint identity NFT) with metadata ────────────────
  console.log('\n2) Registering the Aether agent...');
  const metadata = [
    { key: 'type',         value: ethers.hexlify(ethers.toUtf8Bytes('copy-trading')) },
    { key: 'chain',        value: ethers.hexlify(ethers.toUtf8Bytes('mantle-sepolia')) },
    { key: 'vaultManager', value: VM_ADDRESS }, // 20-byte address stored as bytes
  ];
  const tx = await registry['register(string,(string,bytes)[])'](agentURI, metadata);
  const receipt = await tx.wait();

  const ev = receipt!.logs
    .map((l) => { try { return registry.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === 'Registered');
  if (!ev) fail('no Registered event emitted');
  const agentId: bigint = ev!.args.agentId;
  ok(`agent registered → agentId = ${agentId}`);

  // ── 4. Verify on-chain ──────────────────────────────────────────────────────
  console.log('\n3) Verifying identity on-chain...');
  const owner = await registry.ownerOf(agentId);
  if (owner.toLowerCase() !== me.address.toLowerCase()) fail(`owner ${owner} != ${me.address}`);
  ok(`ownerOf(agentId) = ${owner} (you control the agent NFT)`);

  const uri = await registry.tokenURI(agentId);
  if (!uri.startsWith('data:application/json;base64,')) fail('tokenURI not set correctly');
  ok('agentURI (registration file) stored on-chain ✓');

  const typeBytes = await registry.getMetadata(agentId, 'type');
  const typeStr   = ethers.toUtf8String(typeBytes);
  if (typeStr !== 'copy-trading') fail(`metadata type "${typeStr}" != "copy-trading"`);
  const vmMeta = await registry.getMetadata(agentId, 'vaultManager');
  ok(`metadata: type="${typeStr}", vaultManager=${ethers.getAddress(vmMeta)}`);

  const total = await registry.totalAgents();
  ok(`registry totalAgents = ${total}`);

  console.log('\n🎉 PHASE 3 PASSED — Aether is now an on-chain ERC-8004 Trustless Agent on Mantle.');
  console.log('   AgentIdentityRegistry:', registryAddr);
  console.log('   agentId:              ', agentId.toString());
  console.log('\n   Add to contracts/web3/.env:  AGENT_REGISTRY_ADDRESS=' + registryAddr);
}

main().catch((e) => { console.error('\n❌ FAILED:\n', e); process.exit(1); });
