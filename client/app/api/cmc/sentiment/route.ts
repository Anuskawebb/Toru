import { NextResponse } from 'next/server';

const CMC_BASE = 'https://pro-api.coinmarketcap.com';

let cache: { data: unknown; expiresAt: number } | null = null;

export async function GET() {
  const key = process.env.CMC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'CMC_API_KEY not configured' }, { status: 503 });
  }

  if (cache && Date.now() < cache.expiresAt) {
    return NextResponse.json(cache.data);
  }

  try {
    const res = await fetch(`${CMC_BASE}/v3/fear-and-greed/latest`, {
      headers: { 'X-CMC_PRO_API_KEY': key, 'Accept': 'application/json' },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `CMC returned ${res.status}` }, { status: 502 });
    }

    const json = await res.json() as {
      data: { value: number; value_classification: string; timestamp: string };
    };

    const data = {
      value:          json.data.value,
      classification: json.data.value_classification,
      updatedAt:      json.data.timestamp,
    };

    cache = { data, expiresAt: Date.now() + 60 * 60 * 1000 };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'fetch_failed' },
      { status: 502 },
    );
  }
}
