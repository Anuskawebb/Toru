import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'

export const dynamic = 'force-dynamic'

type ActivityType = 'smart-money' | 'signal' | 'agent' | 'risk' | 'whale'

interface ActivityEvent {
  id: string
  type: ActivityType
  title: string
  description: string
  timestamp: string
  sortKey: number
}

function actionToType(action: string, status: string): ActivityType {
  if (status === 'PENDING') return 'agent'
  if (action === 'BUY') return 'smart-money'
  if (action === 'SELL') return 'risk'
  return 'signal'
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20'), 50)
    const type = searchParams.get('type') ?? 'all'

    const [recsRows, execRows, signalRows] = await Promise.all([
      sql`
        SELECT id, token_symbol, action, status, reasons, decided_at, confidence
        FROM trade_recommendations
        ORDER BY decided_at DESC
        LIMIT 15
      `,
      sql`
        SELECT et.id, eo.token_symbol, eo.action, eo.amount_usd, et.status as tx_status, et.executed_at
        FROM execution_transactions et
        JOIN execution_orders eo ON et.order_id = eo.id
        ORDER BY et.executed_at DESC NULLS LAST
        LIMIT 15
      `,
      sql`
        SELECT token_address, token_symbol, accumulation_score, signal_tier, trend_direction,
               quality_holder_count, narrative, computed_at
        FROM smart_money_signals
        WHERE meets_minimum_holders = true
        ORDER BY computed_at DESC
        LIMIT 10
      `,
    ])

    const events: ActivityEvent[] = []

    // Events from trade_recommendations
    for (const r of recsRows) {
      const reasons: string[] = Array.isArray(r.reasons) ? r.reasons as string[] : []
      const conf = r.confidence != null ? Math.round((r.confidence as number) * 100) : null
      const evt = actionToType(r.action as string, r.status as string)
      const decidedAt = r.decided_at ? (r.decided_at as Date) : new Date()

      let title = ''
      let description = ''

      if (r.status === 'PENDING') {
        title = `Agent queued ${r.action} ${r.token_symbol}`
        description = reasons[0] ?? 'Conviction threshold met'
      } else if (r.status === 'EXECUTED') {
        title = `${r.action} ${r.token_symbol} executed`
        description = conf ? `Confidence: ${conf}%` : 'Order filled'
      } else {
        title = `${r.action} ${r.token_symbol} — ${r.status}`
        description = reasons[0] ?? ''
      }

      events.push({
        id: r.id as string,
        type: evt,
        title,
        description,
        timestamp: decidedAt.toISOString(),
        sortKey: decidedAt.getTime(),
      })
    }

    // Events from execution_transactions
    for (const r of execRows) {
      const executedAt = r.executed_at ? (r.executed_at as Date) : new Date()
      const success = r.tx_status === 'SUCCESS'
      const amountUsd = r.amount_usd as number | null
      const amountStr = amountUsd != null ? ` ($${Math.round(amountUsd).toLocaleString()})` : ''

      events.push({
        id: r.id as string,
        type: success ? 'agent' : 'risk',
        title: success
          ? `Toru agent ${r.action === 'BUY' ? 'opened' : 'closed'} ${r.token_symbol} position${amountStr}`
          : `${r.action} ${r.token_symbol} failed`,
        description: success ? 'Transaction confirmed on chain' : 'Execution failed — order cancelled',
        timestamp: executedAt.toISOString(),
        sortKey: executedAt.getTime(),
      })
    }

    // Events from smart_money_signals
    for (const r of signalRows) {
      const computedAt = r.computed_at ? (r.computed_at as Date) : new Date()
      const score = Math.round(parseFloat(r.accumulation_score as string))
      const tier = r.signal_tier as string
      const trend = r.trend_direction as string
      const holderCount = r.quality_holder_count as number
      const token = r.token_symbol as string

      let title = ''
      let description = ''
      let evtType: ActivityType = 'signal'

      if (tier === 'STRONG') {
        title = `${token} upgraded to STRONG conviction. Score: ${score}`
        description = `${holderCount} quality holders. Trend: ${trend}`
        evtType = 'signal'
      } else if (tier === 'MODERATE') {
        title = `${token} entered Top Opportunities`
        description = `Accumulation score: ${score}. ${holderCount} quality holders`
        evtType = 'smart-money'
      } else {
        title = `${token} signal active — ${tier}`
        description = `Score: ${score}. Trend: ${trend}`
        evtType = 'signal'
      }

      events.push({
        id: `sig-${r.token_address as string}`,
        type: evtType,
        title,
        description,
        timestamp: computedAt.toISOString(),
        sortKey: computedAt.getTime(),
      })
    }

    events.sort((a, b) => b.sortKey - a.sortKey)

    const filtered = type === 'all' ? events : events.filter((e) => e.type === type)
    const output = filtered.slice(0, limit).map(({ sortKey: _, ...e }) => e)

    return NextResponse.json({
      events: output,
      meta: { timestamp: new Date().toISOString() },
    })
  } catch (err) {
    console.error('[api/activity]', err)
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 })
  }
}
