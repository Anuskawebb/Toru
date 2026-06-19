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
import * as tokenMetricsSchema from './schema/token-metrics.js';
import * as smartMoneySignalsSchema from './schema/smart-money-signals.js';
import * as tokenIntelSnapshotsSchema from './schema/token-intel-snapshots.js';
import * as priceObservationsSchema from './schema/price-observations.js';
import * as tokenPricesSchema from './schema/token-prices.js';
import * as portfolioSnapshotsSchema from './schema/portfolio-snapshots.js';
import * as portfolioStateSchema from './schema/portfolio-state.js';
import * as tradeRecommendationsSchema from './schema/trade-recommendations.js';
import * as agentPositionsSchema from './schema/agent-positions.js';
import * as executionOrdersSchema from './schema/execution-orders.js';
import * as executionTransactionsSchema from './schema/execution-transactions.js';
import * as analyticsRunsSchema from './schema/analytics-runs.js';
import * as executionAccountsSchema from './schema/execution-accounts.js';

const schema = {
  ...tradesSchema,
  ...tokensSchema,
  ...indexerStateSchema,
  ...tokenDiscoveryQueueSchema,
  ...walletPositionsSchema,
  ...walletMetricsSchema,
  ...walletScoresSchema,
  ...tokenMetricsSchema,
  ...smartMoneySignalsSchema,
  ...tokenIntelSnapshotsSchema,
  ...priceObservationsSchema,
  ...tokenPricesSchema,
  ...portfolioSnapshotsSchema,
  ...portfolioStateSchema,
  ...tradeRecommendationsSchema,
  ...agentPositionsSchema,
  ...executionOrdersSchema,
  ...executionTransactionsSchema,
  ...analyticsRunsSchema,
  ...executionAccountsSchema,
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
export * from './repositories/token-metrics-repository.js';
export * from './schema/wallet-metrics.js';
export * from './schema/wallet-scores.js';
export * from './schema/token-metrics.js';
export * from './services/token-metadata.js';
export * from './services/position-builder.js';
export * from './services/wallet-metrics-service.js';
export * from './services/wallet-scores-service.js';
export * from './services/token-metrics-service.js';
export * from './schema/smart-money-signals.js';
export * from './repositories/smart-money-signals-repository.js';
export * from './services/smart-money-signals-service.js';
export * from './schema/token-intel-snapshots.js';
export * from './services/snapshot-service.js';
export * from './schema/price-observations.js';
export * from './schema/token-prices.js';
export * from './schema/portfolio-snapshots.js';
export * from './schema/portfolio-state.js';
export * from './schema/trade-recommendations.js';
export * from './schema/agent-positions.js';
export * from './repositories/trade-recommendations-repository.js';
export * from './schema/execution-orders.js';
export * from './schema/execution-transactions.js';
export * from './repositories/execution-orders-repository.js';
export * from './repositories/execution-transactions-repository.js';
export * from './schema/analytics-runs.js';
export * from './schema/execution-accounts.js';
export * from './repositories/execution-accounts-repository.js';
export { queryClient };
export { eq, and, or, inArray, asc, desc, gte, lte, lt, isNotNull, sql, gt, notInArray } from 'drizzle-orm';
