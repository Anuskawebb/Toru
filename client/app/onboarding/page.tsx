'use client'

import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { ArrowRight, User, TrendingUp, ShieldCheck, Zap } from 'lucide-react'

const steps = [
  { icon: User,       label: 'Profile',    desc: 'Choose your username and tell us who you are' },
  { icon: TrendingUp, label: 'Goals',      desc: 'Define what you want to achieve with trading' },
  { icon: ShieldCheck,label: 'Risk',       desc: 'Set your risk tolerance and trading style' },
  { icon: Zap,        label: 'Finish',     desc: '90 seconds total — then straight to your dashboard' },
]

// Landing-page palette (the onboarding layout provides the cream background).
const PAPER_SOFT = '#e6e2d6'
const INK        = '#0d0d0d'
const INK_MUTED  = 'rgba(13, 13, 13, 0.58)'
const INK_FAINT  = 'rgba(13, 13, 13, 0.40)'
const HAIRLINE   = 'rgba(13, 13, 13, 0.10)'
const GREEN      = '#15a374'

export default function OnboardingWelcomePage() {
  const router = useRouter()
  const { user } = usePrivy()

  const firstName = user?.google?.name?.split(' ')[0] ?? user?.email?.address?.split('@')[0] ?? null

  return (
    <div>
      <h1
        className="mb-4 font-black uppercase leading-[0.92] tracking-tight"
        style={{ color: INK, fontSize: 'clamp(2.5rem, 5vw, 3.5rem)' }}
      >
        {firstName ? `Welcome, ${firstName}.` : 'Welcome to Toru.'}
      </h1>
      <p className="mb-8 text-base leading-relaxed" style={{ color: INK_MUTED }}>
        Answer 5 quick questions so Toru can build a profile that matches your goals and risk tolerance.
      </p>

      {/* Steps */}
      <div className="mb-9">
        {steps.map(({ icon: Icon, label, desc }, i) => (
          <div
            key={label}
            className="flex items-start gap-3 border-t py-2.5"
            style={{ borderColor: HAIRLINE }}
          >
            <div
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: PAPER_SOFT, color: GREEN }}
            >
              <Icon size={14} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px]" style={{ color: INK_FAINT }}>0{i + 1}</span>
                <span className="text-sm font-semibold" style={{ color: INK }}>{label}</span>
              </div>
              <p className="text-xs" style={{ color: INK_MUTED }}>{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={() => router.push('/onboarding/step-1')}
        className="group flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3.5 text-sm font-semibold shadow-sm transition-opacity hover:opacity-90"
        style={{ backgroundColor: GREEN, color: PAPER_SOFT }}
      >
        Get Started
        <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
      </button>
      <p className="mt-3 text-center text-xs" style={{ color: INK_MUTED }}>Takes about 90 seconds</p>
    </div>
  )
}
