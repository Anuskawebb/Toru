'use client'

import { useRouter } from 'next/navigation'
import { useOnboarding, type Goals } from '@/context/onboarding-context'
import StepNavigation from '@/components/onboarding/step-navigation'
import { Check } from 'lucide-react'

const options: { id: Goals; img: string; label: string; desc: string; badge: string; badgeClass: string }[] = [
  {
    id:         'CAPITAL_PRESERVATION',
    img:        '/pepe-6.png',
    label:      'Capital Preservation',
    desc:       'Protect what I have and grow slowly. Safety over upside.',
    badge:      'Conservative',
    badgeClass: 'bg-green-positive/10 text-green-positive',
  },
  {
    id:         'BALANCED_GROWTH',
    img:        '/pepe-7.png',
    label:      'Balanced Growth',
    desc:       'Steady returns with managed downside. The most common choice.',
    badge:      'Balanced',
    badgeClass: 'bg-orange-accent/10 text-orange-accent',
  },
  {
    id:         'AGGRESSIVE_GROWTH',
    img:        '/pepe-8.png',
    label:      'Aggressive Growth',
    desc:       'Maximize upside. I accept higher volatility and drawdowns.',
    badge:      'Aggressive',
    badgeClass: 'bg-red-negative/10 text-red-negative',
  },
  {
    id:         'SPECULATIVE',
    img:        '/pepe-9.png',
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
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">What&apos;s your goal?</h2>
        <p className="text-sm text-muted-foreground">
          This shapes the strategies Toru recommends for your agents.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-8">
        {options.map((o) => {
          const isSelected = state.goals === o.id
          return (
            <button
              key={o.id}
              onClick={() => updateGoals(o.id)}
              className={`group flex flex-col text-left rounded-xl border bg-card overflow-hidden transition-all ${
                isSelected
                  ? 'border-green-positive ring-1 ring-green-positive/40'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              {/* Image — black & white by default, full colour on hover or select */}
              <div className="relative aspect-[16/10] w-full overflow-hidden">
                <img
                  src={o.img}
                  alt={o.label}
                  className={`absolute inset-0 h-full w-full object-cover transition-all duration-300 ${
                    isSelected ? 'grayscale-0' : 'grayscale group-hover:grayscale-0'
                  }`}
                />
                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-green-positive flex items-center justify-center">
                    <Check size={11} className="text-white" strokeWidth={3} />
                  </div>
                )}
              </div>

              <div className="p-3">
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{o.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${o.badgeClass}`}>{o.badge}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">{o.desc}</p>
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
