/**
 * Thin TWAK sidecar client for use in Next.js API routes.
 * Mirrors TwakClient from @toro/agent-core without the package dependency.
 */

const API_URL   = process.env.TWAK_API_URL   ?? 'http://127.0.0.1:3000'
const HMAC      = process.env.TWAK_HMAC_SECRET
const PASSWORD  = process.env.TWAK_WALLET_PASSWORD
const BSC_CHAIN = 'smartchain'

async function twakRequest<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (HMAC)     headers['Authorization']     = `Bearer ${HMAC}`
  if (PASSWORD) headers['x-wallet-password'] = PASSWORD

  const res = await fetch(`${API_URL}/actions/${action}`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
    // Abort quickly if sidecar is down — don't hang the health check
    signal:  AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`TWAK ${action} failed (${res.status}): ${text}`)
  }

  return res.json() as Promise<T>
}

export async function twakIsReachable(): Promise<boolean> {
  try {
    await twakRequest('get_wallet_status')
    return true
  } catch {
    return false
  }
}

export async function twakGetAddress(): Promise<string | null> {
  try {
    const res = await twakRequest<{ address: string }>('get_address', { chain: BSC_CHAIN })
    return res.address ?? null
  } catch {
    return null
  }
}

export async function twakGetBalance(): Promise<{ balance: string; symbol: string; usdValue?: string } | null> {
  try {
    const addr = await twakGetAddress()
    if (!addr) return null
    const res = await twakRequest<any>('wallet_balance', { chain: BSC_CHAIN, address: addr })
    return {
      balance:  typeof res.balance === 'object' ? (res.balance.amount ?? res.balance.value ?? '0') : (res.balance ?? '0'),
      symbol:   res.symbol ?? 'BNB',
      usdValue: res.usdValue ?? res.fiatValue,
    }
  } catch {
    return null
  }
}

export async function twakGetPortfolio(): Promise<{ totalUsdValue: string; assets: unknown[] } | null> {
  try {
    const addr = await twakGetAddress()
    if (!addr) return null
    const res = await twakRequest<any>('get_token_holdings', { chain: BSC_CHAIN, address: addr })
    return {
      totalUsdValue: res.totalUsdValue ?? res.totalFiatValue ?? '0',
      assets:        res.holdings ?? res.tokens ?? [],
    }
  } catch {
    return null
  }
}
