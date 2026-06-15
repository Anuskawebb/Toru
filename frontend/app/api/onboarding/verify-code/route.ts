import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

function otpKey(follower: string, email: string) {
  return `aether:onboarding:otp:${follower}:${email}`;
}

export async function POST(req: Request) {
  try {
    const { email, follower, code } = await req.json();

    if (!email || !follower || !code) {
      return NextResponse.json(
        { error: 'Email, follower address, and code are required' },
        { status: 400 }
      );
    }

    const key = otpKey(follower.toLowerCase(), email.trim().toLowerCase());
    // Upstash REST auto-parses numeric-looking strings back into numbers,
    // so a stored "681833" can come back as the number 681833 — coerce both sides.
    const stored = await redis.get<string | number>(key);

    if (stored === null || stored === undefined) {
      return NextResponse.json(
        { verified: false, error: 'Code expired — request a new one' },
        { status: 400 }
      );
    }

    if (String(stored) !== String(code).trim()) {
      return NextResponse.json(
        { verified: false, error: 'Incorrect code' },
        { status: 400 }
      );
    }

    await redis.del(key);

    return NextResponse.json({ verified: true });
  } catch (err: any) {
    console.error('[verify-code API] error:', err);
    return NextResponse.json(
      { error: err?.message ?? 'Internal Server Error' },
      { status: 500 }
    );
  }
}
