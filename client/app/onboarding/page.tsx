'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight, Zap, ShieldCheck, Clock } from 'lucide-react'

const features = [
  { icon: Zap,         title: '24/7 Autonomous Trading', desc: 'Your agent executes while you sleep' },
  { icon: ShieldCheck, title: 'Built-in Risk Management', desc: 'Stop-loss and position sizing enforced automatically' },
  { icon: Clock,       title: 'Takes 2 minutes to set up', desc: 'Name, strategy, mode — done' },
]

export default function OnboardingPage() {
  const router = useRouter()

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-accent/10 border border-orange-accent/20 mb-6">
          <div className="w-1.5 h-1.5 rounded-full bg-orange-accent animate-pulse" />
          <span className="text-xs text-orange-accent font-medium">Powered by Smart Money Intelligence</span>
        </div>
        <h1 className="text-4xl font-bold text-foreground tracking-tight mb-3">
          Welcome to Toro
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          Create your first autonomous trading agent.<br />
          Set your risk level. Let it trade.
        </p>
      </div>

      {/* What you get */}
      <div className="space-y-3">
        {features.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex items-start gap-4 p-4 bg-card border border-border rounded-xl">
            <div className="w-9 h-9 rounded-lg bg-orange-accent/10 flex items-center justify-center shrink-0">
              <Icon size={16} className="text-orange-accent" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">{title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={() => router.push('/onboarding/step-1')}
        className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-orange-accent text-white rounded-xl font-semibold text-sm hover:bg-orange-accent/90 transition-all shadow-sm group"
      >
        Create Your First Agent
        <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
      </button>

      <p className="text-center text-xs text-muted-foreground">
        4 quick steps · No code required
      </p>
    </div>
  )
}
