'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useOnboarding, type CapitalRange } from '@/context/onboarding-context'
import { useAuth } from '@/context/auth-context'
import StepNavigation from '@/components/onboarding/step-navigation'
import { Check, Coins, Wallet, Gem } from 'lucide-react'

const options: { id: CapitalRange; label: string; desc: string; icon: React.ElementType; bars: number; color: string }[] = [
  { id: 'UNDER_100',   label: 'Under $100',    desc: 'Starting small, testing the waters',  icon: Coins,  bars: 1, color: '#15a374' },
  { id: '100_TO_1000', label: '$100 – $1,000', desc: 'Building a meaningful position',       icon: Wallet, bars: 2, color: '#0ea5a4' },
  { id: 'OVER_1000',   label: '$1,000+',       desc: 'Serious capital deployment',           icon: Gem,    bars: 3, color: '#7c5cff' },
]

export default function Step5Page() {
  const router   = useRouter()
  const { state, updateCapitalRange } = useOnboarding()
  const { getToken, markOnboardingComplete, updateIdentity } = useAuth()
  const [saving, setSaving]   = useState(false)
  const [error,  setError]    = useState<string | null>(null)

  const canContinue = !!state.capitalRange

  const handleComplete = async () => {
    if (!canContinue || saving) return
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const res   = await fetch('/api/me/profile', {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username:           state.username,
          displayName:        state.displayName,
          profileImageUrl:    state.profileImageUrl || undefined,
          experience:         state.experience,
          goals:              state.goals,
          riskTolerance:      state.riskTolerance,
          tradingPreference:  state.tradingPreference,
          capitalRange:       state.capitalRange,
          onboardingCompleted: true,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? 'Failed to save profile. Please try again.')
        return
      }

      // Update local auth state so AuthGate stops redirecting
      markOnboardingComplete()
      updateIdentity({ username: state.username, displayName: state.displayName })

      router.replace('/execution-center')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Capital range</h2>
        <p className="text-sm text-muted-foreground">
          How much are you looking to deploy? This helps size agent recommendations.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8">
        {options.map((o) => {
          const Icon       = o.icon
          const isSelected = state.capitalRange === o.id
          return (
            <button
              key={o.id}
              onClick={() => updateCapitalRange(o.id)}
              className={`group flex flex-col text-left rounded-xl border bg-card overflow-hidden transition-all ${
                isSelected
                  ? 'border-green-positive ring-1 ring-green-positive/40'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              {/* Colourful "capital meter" — coloured icon + bars that fill by amount */}
              <div className="relative aspect-[4/3] w-full overflow-hidden">
                <div
                  className="absolute inset-0"
                  style={{ background: `linear-gradient(135deg, ${o.color}26 0%, ${o.color}0d 45%, transparent 100%)` }}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <Icon size={28} style={{ color: o.color }} />
                  <div className="flex items-end gap-1 h-5">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-1.5 rounded-sm transition-all duration-300"
                        style={{
                          height: `${(i + 1) * 5 + 5}px`,
                          backgroundColor: i < o.bars ? o.color : 'rgba(13,13,13,0.12)',
                        }}
                      />
                    ))}
                  </div>
                </div>
                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-green-positive flex items-center justify-center">
                    <Check size={11} className="text-white" strokeWidth={3} />
                  </div>
                )}
              </div>

              <div className="p-3">
                <div className="text-sm font-semibold text-foreground mb-0.5">{o.label}</div>
                <div className="text-[11px] text-muted-foreground leading-snug">{o.desc}</div>
              </div>
            </button>
          )
        })}
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-negative/10 border border-red-negative/30 rounded-lg text-xs text-red-negative">
          {error}
        </div>
      )}

      <StepNavigation
        currentStep={5}
        canGoBack={!saving}
        canGoForward={canContinue}
        onBack={() => router.push('/onboarding/step-4')}
        onForward={handleComplete}
        forwardButtonText="Complete Setup"
        forwardButtonDisabled={!canContinue || saving}
        loading={saving}
      />
    </div>
  )
}
