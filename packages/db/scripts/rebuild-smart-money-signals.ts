import { SmartMoneySignalsRepository } from '../src/repositories/smart-money-signals-repository.js';
import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Rebuilding smart money signals from database...');
  const t0 = Date.now();
  await SmartMoneySignalsRepository.rebuildAll();
  const elapsed = Date.now() - t0;
  console.log(`Rebuild complete in ${elapsed}ms\n`);

  // Tier distribution
  console.log('--- Tier Distribution ---');
  const dist = await SmartMoneySignalsRepository.getTierDistribution();
  console.table(dist);

  // Top 5 STRONG signals
  console.log('\n--- Top 5 STRONG Smart Money Signals ---');
  const topSignals = await SmartMoneySignalsRepository.getTopSignals({ limit: 5, tiers: ['STRONG'] });
  if (topSignals.length === 0) {
    console.log('No STRONG signals found.');
  } else {
    for (const sig of topSignals) {
      console.log(`[${sig.tokenSymbol}] (${sig.tokenAddress})`);
      console.log(`  Score:         ${sig.accumulationScore}`);
      console.log(`  Quality/Total: ${sig.qualityHolderCount} / ${sig.holderCount} holders`);
      console.log(`  Concentration: ${sig.qualityConcentrationPct}%`);
      console.log(`  Net Flow:      ${sig.netAccumulationFlow >= 0 ? '+' : ''}${sig.netAccumulationFlow}`);
      console.log(`  Narrative:     "${sig.narrative}"`);
      console.log('  Classifications:', JSON.stringify(sig.topClassifications));
      console.log('-'.repeat(40));
    }
  }

  await queryClient.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
