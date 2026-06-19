import { NextResponse } from 'next/server'
import sql from '@/lib/db'
import { twakIsReachable, twakGetAddress } from '@/lib/twak'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [dbOk, twakReachable, twakAddress] = await Promise.all([
    sql`SELECT 1`.then(() => true).catch(() => false),
    twakIsReachable(),
    twakGetAddress().catch(() => null),
  ])

  const status = dbOk && twakReachable ? 'ok' : 'degraded'

  return NextResponse.json({
    status,
    timestamp: new Date().toISOString(),
    db: {
      connected: dbOk,
    },
    twak: {
      reachable:        twakReachable,
      walletConfigured: twakAddress !== null,
      walletAddress:    twakAddress,
    },
  }, { status: status === 'ok' ? 200 : 207 })
}
