import { ethers } from 'hardhat';

const AUSD  = process.env.AUSD_ADDRESS ?? '';
const MWMNT = '0x8982A4a8f76bbF4a14083fB641367d25926Cd214';
const ROUTER  = '0x45e6f621c5ED8616cCFB9bBaeBAcF9638aBB0033';
const FACTORY = '0x272465431A6b86E3B9E5b9bD33f5D103a3F59eDb';

const FACTORY_ABI = [
  'function getPair(address,address) view returns (address)',
  'function allPairsLength() view returns (uint)',
  'function createPair(address,address) returns (address)',
  'function feeToSetter() view returns (address)',
];
const ROUTER_ABI = [
  'function factory() view returns (address)',
  'function WMNT() view returns (address)',
  'function WETH() view returns (address)',
  'function addLiquidity(address,address,uint,uint,uint,uint,address,uint) returns (uint,uint,uint)',
];

async function tryGet(label: string, fn: () => Promise<unknown>) {
  try { console.log(`  ${label}:`, await fn()); }
  catch (e: unknown) { console.log(`  ${label}: ERR ${(e as Error).message?.slice(0, 90)}`); }
}

async function main() {
  const [me] = await ethers.getSigners();
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, me);
  const router  = new ethers.Contract(ROUTER, ROUTER_ABI, me);

  console.log('=== FusionX router introspection ===');
  await tryGet('router.factory()', () => router.factory());
  await tryGet('router.WMNT()',    () => router.WMNT());
  await tryGet('router.WETH()',    () => router.WETH());

  console.log('=== factory ===');
  await tryGet('allPairsLength', () => factory.allPairsLength());
  await tryGet('feeToSetter',    () => factory.feeToSetter());
  await tryGet('getPair(aUSD,mWMNT)', () => factory.getPair(AUSD, MWMNT));

  console.log('=== createPair static (permissioned?) ===');
  await tryGet('createPair.staticCall', () => factory.createPair.staticCall(AUSD, MWMNT));

  console.log('=== addLiquidity static (revert reason) ===');
  const dl = BigInt((await ethers.provider.getBlock('latest'))!.timestamp) + 3600n;
  await tryGet('addLiquidity.staticCall', () =>
    router.addLiquidity.staticCall(AUSD, MWMNT,
      ethers.parseUnits('1000', 6), ethers.parseUnits('1000', 18), 0, 0, me.address, dl));
}
main().catch((e) => { console.error(e); process.exit(1); });
