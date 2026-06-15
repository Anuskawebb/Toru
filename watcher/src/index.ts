import 'dotenv/config';
import { createServer }                     from 'node:http';
import { createPrismaDb, disconnectPrisma } from './db.js';
import { startWatcher }                     from './watcher.js';
import { startPnlUpdater }                  from './pnl-updater.js';
import { startVaultListener }               from './vault-listener.js';
import { closeRedis }                       from './dedup.js';
import { getKeeperInfo }                    from './keeper.js';
import { log, warn }                        from './logger.js';

// ── Startup diagnostics ───────────────────────────────────────────────────────

log('startup', '=== Aether Watcher starting on Mantle ===');

const REQUIRED_VARS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'VAULT_MANAGER_ADDRESS',
  'KEEPER_PRIVATE_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
];
const OPTIONAL_VARS = ['PORT', 'DEFAULT_COPY_PCT', 'STOP_LOSS_PCT'];

for (const key of REQUIRED_VARS) {
  const val = process.env[key];
  if (!val) {
    warn('startup', `${key}: ✗ MISSING — likely to cause a crash`);
  } else {
    const masked = key.includes('KEY') || key.includes('TOKEN') || key === 'DATABASE_URL' || key === 'DIRECT_URL'
      ? `${val.slice(0, 10)}…***`
      : val;
    log('startup', `${key}: ✓ ${masked}`);
  }
}
for (const key of OPTIONAL_VARS) {
  log('startup', `${key}: ${process.env[key] ?? '(default)'}`);
}

// Print keeper wallet address and live MNT balance before starting the event loop
try {
  const { address, balanceEth } = await getKeeperInfo();
  const bal = parseFloat(balanceEth);
  log('startup', `Keeper wallet: ${address}  balance: ${balanceEth} MNT`);
  if (bal < 1) warn('startup', `Keeper balance is LOW (${balanceEth} MNT). Each checkLeaderActivity costs ~0.4 MNT. Top up soon.`);
  if (bal < 0.4) warn('startup', `Keeper balance CRITICAL — below one call's cost. checkLeaderActivity WILL revert.`);
} catch (e: any) {
  warn('startup', `Could not fetch keeper balance: ${e.message}`);
}

const db = createPrismaDb();

log('startup', 'DB client ready. Starting watcher and P&L updater…');

const stopWatcher       = await startWatcher(db);
const stopPnlUpdater    = startPnlUpdater(db);
const stopVaultListener = startVaultListener(db);

// Render web services require an HTTP port to be bound — this also doubles
// as the endpoint the keep-alive cron pings to stop the free instance idling.
const PORT = process.env.PORT ?? 8787;
const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(PORT, () => console.log(`[health] listening on :${PORT}`));

async function shutdown() {
  console.log('\nShutting down…');
  server.close();
  stopWatcher();
  stopPnlUpdater();
  stopVaultListener();
  await closeRedis();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
