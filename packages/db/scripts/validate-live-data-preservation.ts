import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TABLES = [
  'trades',
  'tokens',
  'wallet_positions',
  'wallet_metrics',
  'wallet_scores',
  'token_metrics',
  'smart_money_signals',
  'token_prices',
  'price_observations',
  'portfolio_snapshots',
  'portfolio_state',
  'token_intel_snapshots',
];

const VALIDATION_SCRIPTS = [
  'validate-positions.ts',
  'validate-wallet-metrics.ts',
  'validate-wallet-scores.ts',
  'validate-token-metrics.ts',
  'validate-smart-money-signals.ts',
  'validate-risk-scenarios.ts',
  'validate-valuation-layer.ts',
  'validate-portfolio-state.ts',
  'validate-token-intel-snapshots.ts',
  'validate-agent-consumption.ts',
  'validate-e2e-pipeline.ts',
];

async function getTableCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const row = (r: any) => (r as any).rows?.[0] ?? (r as any)[0];
  
  for (const table of TABLES) {
    const res = await db.execute(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`));
    counts[table] = parseInt(row(res).n, 10);
  }
  return counts;
}

async function main() {
  console.log('=== Starting Live Data Preservation Verification ===');
  
  // 1. Capture counts before running validation scripts
  console.log('\nCapturing initial database counts...');
  const beforeCounts = await getTableCounts();
  for (const [table, count] of Object.entries(beforeCounts)) {
    console.log(`  - ${table}: ${count}`);
  }
  
  // 2. Run all validation scripts in sequence
  console.log('\nExecuting validation scripts...');
  const dbDir = path.resolve(__dirname, '..');
  
  let failedScripts = 0;
  for (const script of VALIDATION_SCRIPTS) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`Running: ${script}`);
    console.log(`----------------------------------------------------------------`);
    
    try {
      execSync(`npx tsx scripts/${script}`, {
        cwd: dbDir,
        stdio: 'inherit',
        env: { ...process.env, FORCE_COLOR: '1' }
      });
      console.log(`\nResult: ${script} PASSED`);
    } catch (error) {
      console.error(`\nResult: ${script} FAILED`);
      failedScripts++;
    }
  }
  
  // 3. Capture counts after running validation scripts
  console.log('\n================================================================');
  console.log('Capturing post-validation database counts...');
  const afterCounts = await getTableCounts();
  
  let countMismatch = 0;
  console.log('\nVerification Audit:');
  for (const table of TABLES) {
    const before = beforeCounts[table]!;
    const after = afterCounts[table]!;
    const diff = after - before;
    
    const status = diff === 0 ? 'PRESERVED' : 'MUTATED';
    const indicator = diff === 0 ? '✅' : '❌';
    
    console.log(`  ${indicator} ${table.padEnd(25)}: before=${before.toString().padEnd(6)} after=${after.toString().padEnd(6)} diff=${(diff >= 0 ? '+' : '') + diff} [${status}]`);
    
    if (diff !== 0) {
      countMismatch++;
    }
  }
  
  await queryClient.end();
  
  console.log('\n================================================================');
  if (failedScripts > 0) {
    console.error(`❌ FAILURE: ${failedScripts} validation script(s) failed execution.`);
  }
  if (countMismatch > 0) {
    console.error(`❌ FAILURE: ${countMismatch} database table(s) had state modifications.`);
  }
  
  if (failedScripts === 0 && countMismatch === 0) {
    console.log('✅ SUCCESS: All validation scripts passed and 100% of live data was preserved!');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error('Unhandled error in data preservation verification:', e);
  try {
    await queryClient.end();
  } catch {}
  process.exit(1);
});
