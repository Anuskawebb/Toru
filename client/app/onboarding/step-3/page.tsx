'use client'

import { useRouter } from 'next/navigation'
import { useOnboarding } from '@/context/onboarding-context'
import ProgressBar from '@/components/onboarding/progress-bar'
import StepNavigation from '@/components/onboarding/step-navigation'
import { Zap, User, Check } from 'lucide-react'

const modes = [
  {
    id: 'autonomous' as const,
    icon: Zap,
    label: 'Autonomous',
    tagline: 'Toro executes trades automatically.',
    bullets: ['24/7 automated execution', 'No approval needed', 'Full risk management applied'],
    recommended: true,
  },
  {
    id: 'assisted' as const,
    icon: User,
    label: 'Assisted',
    tagline: 'Toro recommends trades and waits for approval.',
    bullets: ['Agent surfaces signals', 'You approve each trade', 'Real-time notifications'],
    recommended: false,
  },
]

export default function Step3Page() {
  const router = useRouter()
  const { state, updateTradingMode, updateStep } = useOnboarding()

  const selected = state.tradingMode

  const handleContinue = () => {
    if (selected) {
      updateStep(4)
      router.push('/onboarding/step-4')
    }
  }

  return (
    <div>
      <ProgressBar currentStep={3} />

      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Trading mode</h2>
        <p className="text-sm text-muted-foreground">
          Choose how much control you want over individual trades.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {modes.map((m) => {
          const Icon = m.icon
          const isSelected = selected === m.id
          return (
            <button
              key={m.id}
              onClick={() => updateTradingMode(m.id)}
              className={`w-full text-left p-5 bg-card border rounded-xl transition-all ${
                isSelected
                  ? 'border-orange-accent ring-1 ring-orange-accent/30'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              <div className="flex gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                  isSelected ? 'bg-orange-accent/10 text-orange-accent' : 'bg-secondary text-muted-foreground'
                }`}>
                  <Icon size={18} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground">{m.label}</span>
                    {m.recommended && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-orange-accent/10 text-orange-accent rounded font-medium">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{m.tagline}</p>
                  <div className="space-y-1">
                    {m.bullets.map((b) => (
                      <div key={b} className="flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                        <span className="text-xs text-muted-foreground">{b}</span>
                      </div>
                    ))}
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
        currentStep={3}
        canGoBack
        canGoForward={!!selected}
        onBack={() => { updateStep(2); router.push('/onboarding/step-2') }}
        onForward={handleContinue}
        forwardButtonDisabled={!selected}
      />
    </div>
  )
}
