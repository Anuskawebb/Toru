'use client'

import { useRouter } from 'next/navigation'
import { useOnboarding, type Goals } from '@/context/onboarding-context'
import ProgressBar from '@/components/onboarding/progress-bar'
import StepNavigation from '@/components/onboarding/step-navigation'
import { Check, Shield, TrendingUp, Rocket, Zap } from 'lucide-react'

const options: { id: Goals; icon: React.ElementType; label: string; desc: string; badge: string; badgeClass: string }[] = [
  {
    id:         'CAPITAL_PRESERVATION',
    icon:       Shield,
    label:      'Capital Preservation',
    desc:       'Protect what I have and grow slowly. Safety over upside.',
    badge:      'Conservative',
    badgeClass: 'bg-green-positive/10 text-green-positive',
  },
  {
    id:         'BALANCED_GROWTH',
    icon:       TrendingUp,
    label:      'Balanced Growth',
    desc:       'Steady returns with managed downside. The most common choice.',
    badge:      'Balanced',
    badgeClass: 'bg-orange-accent/10 text-orange-accent',
  },
  {
    id:         'AGGRESSIVE_GROWTH',
    icon:       Rocket,
    label:      'Aggressive Growth',
    desc:       'Maximize upside. I accept higher volatility and drawdowns.',
    badge:      'Aggressive',
    badgeClass: 'bg-red-negative/10 text-red-negative',
  },
  {
    id:         'SPECULATIVE',
    icon:       Zap,
    label:      'Speculative',
    desc:       'High-risk, high-reward plays. Early narratives, low caps, meme momentum.',
    badge:      'High Risk',
    badgeClass: 'bg-red-negative/10 text-red-negative',
  },
]

export default function Step3Page() {
  const router = useRouter()
  const { state, updateGoals, updateStep } = useOnboarding()

  const handleContinue = () => {
    if (!state.goals) return
    updateStep(4)
    router.push('/onboarding/step-4')
  }

  return (
    <div>
      <ProgressBar currentStep={3} />

      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">What&apos;s your goal?</h2>
        <p className="text-sm text-muted-foreground">
          This shapes the strategies Toru recommends for your agents.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {options.map((o) => {
          const Icon       = o.icon
          const isSelected = state.goals === o.id
          return (
            <button
              key={o.id}
              onClick={() => updateGoals(o.id)}
              className={`w-full text-left p-4 bg-card border rounded-xl transition-all ${
                isSelected
                  ? 'border-orange-accent ring-1 ring-orange-accent/30'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                  isSelected ? 'bg-orange-accent/10 text-orange-accent' : 'bg-secondary text-muted-foreground'
                }`}>
                  <Icon size={15} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground">{o.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${o.badgeClass}`}>{o.badge}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{o.desc}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                  isSelected ? 'border-orange-accent bg-orange-accent' : 'border-border'
                }`}>
                  {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <StepNavigation
        currentStep={3}
        canGoBack
        canGoForward={!!state.goals}
        onBack={() => { updateStep(2); router.push('/onboarding/step-2') }}
        onForward={handleContinue}
        forwardButtonDisabled={!state.goals}
      />
    </div>
  )
}
