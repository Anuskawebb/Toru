import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { twakGetAddress } from '@/lib/twak'

export const dynamic = 'force-dynamic'

interface RouteParams { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id: agentId } = await params

  try {
    const rows = await sql`
      SELECT id, agent_id, account_type, wallet_address, status, metadata, created_at, updated_at
      FROM execution_accounts
      WHERE agent_id = ${agentId}
      LIMIT 1
    `

    if (rows.length === 0) {
      return NextResponse.json({ account: null }, { status: 404 })
    }

    const r = rows[0]
    return NextResponse.json({
      agentId:       r.agent_id as string,
      walletAddress: r.wallet_address as string,
      status:        r.status as string,
      accountType:   r.account_type as string,
      metadata:      r.metadata,
      createdAt:     r.created_at ? (r.created_at as Date).toISOString() : null,
    })

  } catch (err) {
    console.error('[api/agents/wallet] GET error:', err)
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 })
  }
}

/**
 * POST — create execution_accounts record for this agent.
 * Fetches wallet address from TWAK sidecar. Idempotent.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id: agentId } = await params

  try {
    // Check if already exists
    const existing = await sql`
      SELECT id, agent_id, account_type, wallet_address, status
      FROM execution_accounts
      WHERE agent_id = ${agentId}
      LIMIT 1
    `

    if (existing.length > 0) {
      const r = existing[0]
      return NextResponse.json({
        agentId:       r.agent_id as string,
        walletAddress: r.wallet_address as string,
        status:        r.status as string,
        accountType:   r.account_type as string,
        created:       false,
      })
    }

    // Fetch address from TWAK
    const walletAddress = await twakGetAddress()
    if (!walletAddress) {
      return NextResponse.json(
        { error: 'TWAK sidecar unreachable or no BSC address configured' },
        { status: 503 },
      )
    }

    const id       = crypto.randomUUID()
    const now      = new Date().toISOString()
    const metadata = JSON.stringify({ chain: 'smartchain', createdBy: 'api' })

    await sql`
      INSERT INTO execution_accounts (id, agent_id, account_type, wallet_address, status, metadata, created_at, updated_at)
      VALUES (
        ${id},
        ${agentId},
        ${'TWAK_AGENT'},
        ${walletAddress.toLowerCase()},
        ${'ACTIVE'},
        ${metadata}::jsonb,
        ${now}::timestamp,
        ${now}::timestamp
      )
      ON CONFLICT DO NOTHING
    `

    return NextResponse.json({
      agentId,
      walletAddress: walletAddress.toLowerCase(),
      status:        'ACTIVE',
      accountType:   'TWAK_AGENT',
      created:       true,
    }, { status: 201 })

  } catch (err) {
    console.error('[api/agents/wallet] POST error:', err)
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 })
  }
}
