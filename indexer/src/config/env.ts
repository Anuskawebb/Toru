import { config } from 'dotenv';

config();

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireString(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function optionalString(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Env var ${key} must be a positive integer, got: "${raw}"`);
  }
  return n;
}

function optionalLogLevel(key: string): 'debug' | 'info' | 'warn' | 'error' {
  const v = process.env[key];
  if (!v) return 'info';
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
  throw new Error(`Env var ${key} must be debug|info|warn|error, got: "${v}"`);
}

// ── Validated config ─────────────────────────────────────────────────────────

export const env = {
  BSC_RPC_URL:          requireString('BSC_RPC_URL'),
  CHECKPOINT_FILE:      optionalString('CHECKPOINT_FILE', './checkpoint.json'),
  BATCH_SIZE:           optionalInt('BATCH_SIZE', 100),
  BATCH_DELAY_MS:       optionalInt('BATCH_DELAY_MS', 200),
  FETCH_CONCURRENCY:    optionalInt('FETCH_CONCURRENCY', 5),
  /** Concurrent receipt fetches per window — can be higher than block fetches. */
  RECEIPT_CONCURRENCY:  optionalInt('RECEIPT_CONCURRENCY', 10),
  /** How often the poller checks for new blocks. BSC produces one every ~3s. */
  POLL_INTERVAL_MS:     optionalInt('POLL_INTERVAL_MS', 3_000),
  LOG_LEVEL:            optionalLogLevel('LOG_LEVEL'),
} as const;

export type Env = typeof env;
