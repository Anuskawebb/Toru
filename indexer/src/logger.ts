type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Read directly from process.env to avoid a circular dep with config/env.ts
const configuredLevel = (process.env['LOG_LEVEL'] as Level | undefined) ?? 'info';
const minRank = LEVEL_RANK[configuredLevel] ?? 1;

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < minRank) return;

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };

  if (context !== undefined) {
    Object.assign(entry, context);
  }

  const line = JSON.stringify(entry) + '\n';

  if (level === 'error' || level === 'warn') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info:  (msg: string, ctx?: Record<string, unknown>) => emit('info',  msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => emit('warn',  msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
} as const;
