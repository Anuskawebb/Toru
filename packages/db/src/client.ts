import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables relative to this module with override enabled
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
dotenv.config({ override: true }); // fallback

import * as tradesSchema from './schema/trades.js';
import * as tokensSchema from './schema/tokens.js';
import * as indexerStateSchema from './schema/indexer-state.js';
import * as tokenDiscoveryQueueSchema from './schema/token-discovery-queue.js';
import * as walletPositionsSchema from './schema/wallet-positions.js';
import * as walletMetricsSchema from './schema/wallet-metrics.js';
import * as walletScoresSchema from './schema/wallet-scores.js';

const schema = {
  ...tradesSchema,
  ...tokensSchema,
  ...indexerStateSchema,
  ...tokenDiscoveryQueueSchema,
  ...walletPositionsSchema,
  ...walletMetricsSchema,
  ...walletScoresSchema,
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  // We don't throw immediately on import in case it's imported during CLI generation
  // but we will throw if DB is accessed or if we try to initialize postgres with empty string.
  console.warn('Warning: DATABASE_URL is not set. Database operations will fail.');
}

const options: Record<string, any> = {
  max: 10,
};

if (databaseUrl && (databaseUrl.includes('supabase') || databaseUrl.includes('neon.tech'))) {
  options.ssl = { rejectUnauthorized: false };
}

const queryClient = postgres(databaseUrl || '', options);

export const db = drizzle(queryClient, { schema });

// Re-export schemas for convenience
export * from './schema/trades.js';
export * from './schema/tokens.js';
export * from './schema/indexer-state.js';
export * from './schema/token-discovery-queue.js';
export * from './schema/wallet-positions.js';
export * from './repositories/trade-repository.js';
export * from './repositories/token-repository.js';
export * from './repositories/indexer-state-repository.js';
export * from './repositories/token-discovery-queue-repository.js';
export * from './repositories/position-repository.js';
export * from './repositories/wallet-metrics-repository.js';
export * from './repositories/wallet-scores-repository.js';
export * from './schema/wallet-metrics.js';
export * from './schema/wallet-scores.js';
export * from './services/token-metadata.js';
export * from './services/position-builder.js';
export * from './services/wallet-metrics-service.js';
export * from './services/wallet-scores-service.js';
export { queryClient };
