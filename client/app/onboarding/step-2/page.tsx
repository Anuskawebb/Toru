'use client'

import { useRouter } from 'next/navigation'
import { useOnboarding } from '@/context/onboarding-context'
import ProgressBar from '@/components/onboarding/progress-bar'
import StepNavigation from '@/components/onboarding/step-navigation'
import { Check } from 'lucide-react'

const strategies = [
  {
    id: 'conservative' as const,
    label: 'Conservative',
    tagline: 'Preserve capital. Grow steadily.',
    risk: 'Low',
    positionSize: 'Up to 5% per trade',
    dailyDrawdown: 'Max 2%',
    dotColor: 'bg-green-positive',
    badgeClass: 'bg-green-positive/10 text-green-positive',
  },
  {
    id: 'balanced' as const,
    label: 'Balanced',
    tagline: 'Steady growth with managed risk.',
    risk: 'Medium',
    positionSize: 'Up to 10% per trade',
    dailyDrawdown: 'Max 5%',
    dotColor: 'bg-orange-accent',
    badgeClass: 'bg-orange-accent/10 text-orange-accent',
  },
  {
    id: 'aggressive' as const,
    label: 'Aggressive',
    tagline: 'Maximum upside. Higher volatility.',
    risk: 'High',
    positionSize: 'Up to 20% per trade',
    dailyDrawdown: 'Max 10%',
    dotColor: 'bg-red-negative',
    badgeClass: 'bg-red-negative/10 text-red-negative',
  },
]

export default function Step2Page() {
  const router = useRouter()
  const { state, updateRiskLevel, updateStep } = useOnboarding()

  const selected = state.riskLevel

  const handleContinue = () => {
    if (selected) {
      updateStep(3)
      router.push('/onboarding/step-3')
    }
  }

  return (
    <div>
      <ProgressBar currentStep={2} />

      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Choose a strategy</h2>
        <p className="text-sm text-muted-foreground">
          This sets your agent&apos;s risk tolerance and maximum position sizes.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {strategies.map((s) => {
          const isSelected = selected === s.id
          return (
            <button
              key={s.id}
              onClick={() => updateRiskLevel(s.id)}
              className={`w-full text-left p-5 bg-card border rounded-xl transition-all ${
                isSelected
                  ? 'border-orange-accent ring-1 ring-orange-accent/30'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2 h-2 rounded-full ${s.dotColor}`} />
                    <span className="text-sm font-semibold text-foreground">{s.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${s.badgeClass}`}>
                      {s.risk} Risk
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{s.tagline}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-secondary rounded-lg px-3 py-2">
                      <div className="text-[10px] text-muted-foreground mb-0.5">Position Size</div>
                      <div className="text-xs font-medium text-foreground">{s.positionSize}</div>
                    </div>
                    <div className="bg-secondary rounded-lg px-3 py-2">
                      <div className="text-[10px] text-muted-foreground mb-0.5">Daily Drawdown</div>
                      <div className="text-xs font-medium text-foreground">{s.dailyDrawdown}</div>
                    </div>
                  </div>
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
        currentStep={2}
        canGoBack
        canGoForward={!!selected}
        onBack={() => { updateStep(1); router.push('/onboarding/step-1') }}
        onForward={handleContinue}
        forwardButtonDisabled={!selected}
      />
    </div>
  )
}
