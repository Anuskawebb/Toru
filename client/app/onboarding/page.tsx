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

export default function OnboardingWelcomePage() {
  const router = useRouter()
  const { user } = usePrivy()

  const firstName = user?.google?.name?.split(' ')[0] ?? user?.email?.address?.split('@')[0] ?? null

  return (
    <div className="space-y-10">
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-accent/10 border border-orange-accent/20 mb-6">
          <div className="w-1.5 h-1.5 rounded-full bg-orange-accent animate-pulse" />
          <span className="text-xs text-orange-accent font-medium">Let&apos;s get you set up</span>
        </div>
        <h1 className="text-4xl font-bold text-foreground tracking-tight mb-3">
          {firstName ? `Welcome, ${firstName}.` : 'Welcome to Toru.'}
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          Answer 5 quick questions so Toru can build a profile that matches your goals and risk tolerance.
        </p>
      </div>

      <div className="space-y-3">
        {steps.map(({ icon: Icon, label, desc }, i) => (
          <div key={label} className="flex items-start gap-4 p-4 bg-card border border-border rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-orange-accent/10 flex items-center justify-center shrink-0 mt-0.5">
              <Icon size={15} className="text-orange-accent" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs text-muted-foreground/60 font-mono">0{i + 1}</span>
                <span className="text-sm font-semibold text-foreground">{label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => router.push('/onboarding/step-1')}
        className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-orange-accent text-white rounded-xl font-semibold text-sm hover:bg-orange-accent/90 transition-all shadow-sm group"
      >
        Get Started
        <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
      </button>

      <p className="text-center text-xs text-muted-foreground">Takes about 90 seconds</p>
    </div>
  )
}
