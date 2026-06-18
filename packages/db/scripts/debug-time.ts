import { db, queryClient } from '../src/client.js';
import { sql } from 'drizzle-orm';
import { tokenIntelSnapshots } from '../src/schema/token-intel-snapshots.js';
import { SmartMoneySignalsRepository } from '../src/repositories/smart-money-signals-repository.js';

const parseUtcDate = (val: string | Date | null | undefined): Date | undefined => {
  if (!val) return undefined;
  let str = '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return undefined;
    const pad = (n: number) => String(n).padStart(2, '0');
    str = `${val.getUTCFullYear()}-${pad(val.getUTCMonth() + 1)}-${pad(val.getUTCDate())} ${pad(val.getUTCHours())}:${pad(val.getUTCMinutes())}:${pad(val.getUTCSeconds())}`;
  } else {
    str = String(val).trim();
  }
  if (!str) return undefined;
  
  let isoStr = str.replace(' ', 'T');
  const hasTimezone = isoStr.endsWith('Z') || /[+-]\d{2}(:?\d{2})?$/.test(isoStr);
  if (!hasTimezone) {
    isoStr += 'Z';
  }
  
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? undefined : d;
};

async function main() {
  console.log("=== DEBUGGING SECTION 3 ===");

  const datasetWindow = await db.execute<{ max_ts: Date | string }>(sql`SELECT MAX(timestamp) AS max_ts FROM trades`);
  const maxTsRaw = datasetWindow[0]!.max_ts;
  const maxTs = parseUtcDate(maxTsRaw)!;
  console.log("maxTs:", maxTs.toISOString(), "getTime:", maxTs.getTime());

  // 1. Resolve target snapshot timestamps
  const targets = await db.execute<{ ts_1h: any; ts_24h: any; ts_7d: any }>(sql`
    WITH dataset_window AS (
      SELECT COALESCE(MAX(timestamp), NOW()) AS max_ts FROM trades
    )
    SELECT
      (SELECT snapshot_at FROM token_intel_snapshots ORDER BY ABS(EXTRACT(EPOCH FROM (snapshot_at - (dw.max_ts - INTERVAL '1 hour')))) LIMIT 1) AS ts_1h,
      (SELECT snapshot_at FROM token_intel_snapshots ORDER BY ABS(EXTRACT(EPOCH FROM (snapshot_at - (dw.max_ts - INTERVAL '24 hours')))) LIMIT 1) AS ts_24h,
      (SELECT snapshot_at FROM token_intel_snapshots ORDER BY ABS(EXTRACT(EPOCH FROM (snapshot_at - (dw.max_ts - INTERVAL '7 days')))) LIMIT 1) AS ts_7d
    FROM dataset_window dw
  `);

  const { ts_1h, ts_24h, ts_7d } = targets[0] ?? {};
  console.log("ts_24h from query:", ts_24h);
  const ts24hParsed = parseUtcDate(ts_24h)!;
  console.log("ts24hParsed:", ts24hParsed.toISOString(), "getTime:", ts24hParsed.getTime());

  // Get top signals
  const topSignals = await SmartMoneySignalsRepository.getTopSignals({ limit: 1 });
  if (topSignals.length > 0) {
    const s = topSignals[0]!;
    console.log("Signal returned for token:", s.tokenSymbol);
    console.log("change1h:", s.qualityHolderChange1h);
    console.log("change24h:", s.qualityHolderChange24h);
    console.log("change7d:", s.qualityHolderChange7d);
    console.log("scoreChange24h:", s.accumulationScoreChange24h);
    console.log("trendDirection:", s.trendDirection);
  } else {
    console.log("No signals returned.");
  }

  await queryClient.end();
}

main().catch(console.error);
