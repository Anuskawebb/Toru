'use client'

import { useRouter } from 'next/navigation'
import { useOnboarding, type Experience } from '@/context/onboarding-context'
import ProgressBar from '@/components/onboarding/progress-bar'
import StepNavigation from '@/components/onboarding/step-navigation'
import { Check } from 'lucide-react'

const options: { id: Experience; label: string; tagline: string; detail: string }[] = [
  {
    id:      'BEGINNER',
    label:   'Beginner',
    tagline: "I'm new to crypto trading",
    detail:  'I may have bought crypto before but have not actively traded',
  },
  {
    id:      'INTERMEDIATE',
    label:   'Intermediate',
    tagline: 'I have experience with trading',
    detail:  'I understand charts, order types, and DeFi basics',
  },
  {
    id:      'ADVANCED',
    label:   'Advanced',
    tagline: 'I trade actively',
    detail:  'I use on-chain analytics, understand MEV, and follow smart money',
  },
]

export default function Step2Page() {
  const router = useRouter()
  const { state, updateExperience, updateStep } = useOnboarding()

  const handleContinue = () => {
    if (!state.experience) return
    updateStep(3)
    router.push('/onboarding/step-3')
  }

  return (
    <div>
      <ProgressBar currentStep={2} />

      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Your experience</h2>
        <p className="text-sm text-muted-foreground">
          This helps Toru tailor agent defaults and recommendations for you.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {options.map((o) => {
          const isSelected = state.experience === o.id
          return (
            <button
              key={o.id}
              onClick={() => updateExperience(o.id)}
              className={`w-full text-left p-5 bg-card border rounded-xl transition-all ${
                isSelected
                  ? 'border-orange-accent ring-1 ring-orange-accent/30'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="text-sm font-semibold text-foreground mb-1">{o.label}</div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">{o.tagline}</div>
                  <div className="text-xs text-muted-foreground/70">{o.detail}</div>
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
        canGoForward={!!state.experience}
        onBack={() => { updateStep(1); router.push('/onboarding/step-1') }}
        onForward={handleContinue}
        forwardButtonDisabled={!state.experience}
      />
    </div>
  )
}
