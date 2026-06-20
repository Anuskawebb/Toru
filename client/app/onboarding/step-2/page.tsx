'use client'

import { useRouter } from 'next/navigation'
import { useOnboarding, type Experience } from '@/context/onboarding-context'
import StepNavigation from '@/components/onboarding/step-navigation'
import { Check } from 'lucide-react'

const options: { id: Experience; label: string; tagline: string; detail: string; img: string }[] = [
  {
    id:      'BEGINNER',
    label:   'Beginner',
    tagline: "I'm new to crypto trading",
    detail:  'I may have bought crypto before but have not actively traded',
    img:     '/pepe-3.png',
  },
  {
    id:      'INTERMEDIATE',
    label:   'Intermediate',
    tagline: 'I have experience with trading',
    detail:  'I understand charts, order types, and DeFi basics',
    img:     '/pepe-4.png',
  },
  {
    id:      'ADVANCED',
    label:   'Advanced',
    tagline: 'I trade actively',
    detail:  'I use on-chain analytics, understand MEV, and follow smart money',
    img:     '/pepe-5.png',
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
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Your experience</h2>
        <p className="text-sm text-muted-foreground">
          This helps Toru tailor agent defaults and recommendations for you.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8">
        {options.map((o) => {
          const isSelected = state.experience === o.id
          return (
            <button
              key={o.id}
              onClick={() => updateExperience(o.id)}
              className={`group flex flex-col text-left rounded-xl border bg-card overflow-hidden transition-all ${
                isSelected
                  ? 'border-green-positive ring-1 ring-green-positive/40'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              {/* Image — black & white by default, full colour on hover or select */}
              <div className="relative aspect-square w-full overflow-hidden">
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
                <div className="text-sm font-semibold text-foreground mb-0.5">{o.label}</div>
                <div className="text-[11px] font-medium text-muted-foreground leading-snug mb-1">{o.tagline}</div>
                <div className="text-[10px] text-muted-foreground/60 leading-snug">{o.detail}</div>
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
