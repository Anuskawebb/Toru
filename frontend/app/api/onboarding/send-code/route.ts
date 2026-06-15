import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { prisma } from '@/lib/prisma';
import { sendVerificationCode } from '@/lib/email';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const OTP_TTL_SECONDS = 600; // 10 minutes

function otpKey(follower: string, email: string) {
  return `aether:onboarding:otp:${follower}:${email}`;
}

export async function POST(req: Request) {
  try {
    const { email, follower } = await req.json();

    if (!email || !follower) {
      return NextResponse.json(
        { error: 'Email and follower address are required' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address format' },
        { status: 400 }
      );
    }

    const followerLower = follower.toLowerCase();
    const emailLower = email.trim().toLowerCase();

    // Uniqueness: this email must not already be registered to a different wallet
    const existing = await prisma.followerProfile.findFirst({
      where: { email: { equals: emailLower, mode: 'insensitive' } },
    });
    if (existing && existing.follower !== followerLower) {
      return NextResponse.json(
        { error: 'This email is already registered to another wallet' },
        { status: 409 }
      );
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await redis.set(otpKey(followerLower, emailLower), code, { ex: OTP_TTL_SECONDS });

    const sent = await sendVerificationCode(email.trim(), code);

    return NextResponse.json({ success: true, codeSent: sent });
  } catch (err: any) {
    console.error('[send-code API] error:', err);
    return NextResponse.json(
      { error: err?.message ?? 'Internal Server Error' },
      { status: 500 }
    );
  }
}
