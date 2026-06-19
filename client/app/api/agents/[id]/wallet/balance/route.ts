import { NextRequest, NextResponse } from 'next/server'
import { twakGetBalance } from '@/lib/twak'

export const dynamic = 'force-dynamic'

interface RouteParams { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params: paramsPromise }: RouteParams) {
  const params = await paramsPromise
  try {
    const balance = await twakGetBalance()

    if (!balance) {
      return NextResponse.json({
        nativeBalance: '0',
        nativeSymbol:  'BNB',
        usdValue:      null,
        tokens:        [],
        funded:        false,
      })
    }

    const funded = parseFloat(balance.balance) > 0

    return NextResponse.json({
      nativeBalance: balance.balance,
      nativeSymbol:  balance.symbol,
      usdValue:      balance.usdValue ?? null,
      tokens:        [],
      funded,
    })

  } catch (err) {
    console.error(`[api/agents/${params?.id}/wallet/balance] error:`, err)
    return NextResponse.json({ error: 'Failed to fetch balance', code: 'TWAK_ERROR' }, { status: 503 })
  }
}
