import { TwakClient } from '../src/execution/twak/twak-client';

try {
  process.loadEnvFile('.env');
} catch (e) {
  // ignore if .env is missing
}

async function validate() {
  console.log('Validating TWAK Sidecar connection...');
  console.log('Target URL:', process.env.TWAK_API_URL || 'http://127.0.0.1:3000');
  
  const client = new TwakClient({
    apiUrl: process.env.TWAK_API_URL || 'http://127.0.0.1:3000',
    password: process.env.TWAK_WALLET_PASSWORD,
  });

  try {
    // 1. Health Check
    const health = await client.healthCheck();
    console.log('Health:', health);
    if (health.status !== 'healthy') {
      throw new Error(`Health check failed. Status: ${health.status}`);
    }
    console.log('✅ TWAK reachable');

    // 2. Wallet Discovery
    const status = await client.getWalletStatus();
    console.log('✅ Wallet detected. Agent Wallet configured:', status.agentWallet);

    const addresses = await client.getAddresses();
    console.log(`✅ Retrieved ${addresses.addresses?.length || 0} wallet addresses.`);

    // 3. Wallet Balance
    const balance = await client.getBalance('smartchain');
    console.log(`✅ Balance fetched: ${balance.balance} ${balance.symbol}`);

    // 4. Wallet Portfolio
    const portfolio = await client.getPortfolio();
    console.log(`✅ Portfolio fetched: $${portfolio.totalUsdValue || '0.00'} across ${portfolio.assets?.length || 0} assets.`);

    console.log('\n🎉 TWAK Validation Successful! Ready for Phase 8B.2.');
  } catch (error) {
    console.error('\n❌ TWAK Validation Failed');
    console.error('Make sure the sidecar is running via: twak serve --rest --port 3000');
    console.error(error);
    process.exit(1);
  }
}

validate().catch(console.error);
