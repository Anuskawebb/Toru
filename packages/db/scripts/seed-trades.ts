import { db, queryClient, trades, tokens } from '../src/client.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('Clearing old trades...');
  await db.delete(trades);

  console.log('Loading tokens from database for symbol/decimal lookup...');
  const tokenRows = await db.select({
    address: tokens.address,
    symbol: tokens.symbol,
    decimals: tokens.decimals
  }).from(tokens);
  
  const tokenMap = new Map(tokenRows.map(t => [t.address.toLowerCase(), t]));

  console.log('Loading trades_export.json...');
  const exportPath = path.resolve(__dirname, '../../../indexer/trades_export.json');
  const rawData = readFileSync(exportPath, 'utf8');
  const rawTrades = JSON.parse(rawData);

  console.log(`Loaded ${rawTrades.length} trades. Formatting for insertion...`);

  const insertPayloads = rawTrades.map((t: any, index: number) => {
    const tokenInAddr = t.tokenIn.toLowerCase();
    const tokenOutAddr = t.tokenOut.toLowerCase();
    const metaIn = tokenMap.get(tokenInAddr);
    const metaOut = tokenMap.get(tokenOutAddr);

    return {
      txHash: t.txHash.toLowerCase(),
      blockNumber: BigInt(t.blockNumber),
      logIndex: index,
      timestamp: new Date(t.blockTimestampMs),
      wallet: t.wallet.toLowerCase(),
      dex: t.dex,
      pairAddress: t.pairAddress ? t.pairAddress.toLowerCase() : null,
      tokenInAddress: tokenInAddr,
      tokenOutAddress: tokenOutAddr,
      tokenInSymbol: metaIn?.symbol ?? t.tokenIn.slice(0, 8),
      tokenOutSymbol: metaOut?.symbol ?? t.tokenOut.slice(0, 8),
      tokenInDecimals: metaIn?.decimals ?? 18,
      tokenOutDecimals: metaOut?.decimals ?? 18,
      amountIn: t.amountIn,
      amountOut: t.amountOut
    };
  });

  console.log(`Inserting ${insertPayloads.length} trades in chunks of 500...`);
  for (let i = 0; i < insertPayloads.length; i += 500) {
    const chunk = insertPayloads.slice(i, i + 500);
    await db.insert(trades).values(chunk);
  }

  console.log('Trades successfully seeded.');
  await queryClient.end();
}

main().catch(console.error);
