'use client'

import { useRouter } from 'next/navigation'
import { useOnboarding, type RiskTolerance, type TradingPreference } from '@/context/onboarding-context'
import StepNavigation from '@/components/onboarding/step-navigation'
import { Check } from 'lucide-react'

const riskOptions: { id: RiskTolerance; label: string; desc: string; dotClass: string }[] = [
  { id: 'LOW',    label: 'Low',    desc: 'Preserve capital, minimal drawdown',    dotClass: 'bg-green-positive' },
  { id: 'MEDIUM', label: 'Medium', desc: 'Accept moderate swings for better returns', dotClass: 'bg-orange-accent' },
  { id: 'HIGH',   label: 'High',   desc: 'Embrace volatility for max upside',     dotClass: 'bg-red-negative' },
]

const modeOptions: { id: TradingPreference; label: string; desc: string }[] = [
  { id: 'MANUAL',     label: 'Manual',     desc: 'You execute every trade yourself' },
  { id: 'ASSISTED',   label: 'Assisted',   desc: 'Agent surfaces signals, you approve' },
  { id: 'AUTONOMOUS', label: 'Autonomous', desc: 'Agent executes automatically 24/7' },
]

function RadioRow<T extends string>({
  options, selected, onSelect,
}: { options: { id: T; label: string; desc: string; dotClass?: string }[]; selected: T | null; onSelect: (v: T) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((o) => {
        const isSelected = selected === o.id
        return (
          <button
            key={o.id}
            onClick={() => onSelect(o.id)}
            className={`text-left p-3 bg-card border rounded-xl transition-all ${
              isSelected ? 'border-green-positive ring-1 ring-green-positive/40' : 'border-border hover:border-muted-foreground/30'
            }`}
          >
            <div className="flex items-start justify-between gap-1 mb-1.5">
              {o.dotClass
                ? <div className={`w-2.5 h-2.5 rounded-full mt-0.5 transition-all duration-300 ${o.dotClass} ${isSelected ? 'grayscale-0 opacity-100' : 'grayscale opacity-60'}`} />
                : <div className="w-2.5 h-2.5 mt-0.5" />}
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                isSelected ? 'border-green-positive bg-green-positive' : 'border-border'
              }`}>
                {isSelected && <Check size={8} className="text-white" strokeWidth={3} />}
              </div>
            </div>
            <div className="text-xs font-semibold text-foreground mb-0.5">{o.label}</div>
            <div className="text-[10px] text-muted-foreground leading-relaxed">{o.desc}</div>
          </button>
        )
      })}
    </div>
  )
}

export default function Step4Page() {
  const router = useRouter()
  const { state, updateRiskTolerance, updateTradingPreference, updateStep } = useOnboarding()

  const canContinue = !!state.riskTolerance && !!state.tradingPreference

  const handleContinue = () => {
    if (!canContinue) return
    updateStep(5)
    router.push('/onboarding/step-5')
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Risk &amp; trading style</h2>
        <p className="text-sm text-muted-foreground">
          These defaults will pre-fill when you create agents. You can always override them per agent.
        </p>
      </div>

      <div className="space-y-6 mb-8">
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Risk Tolerance
          </div>
          <RadioRow options={riskOptions} selected={state.riskTolerance} onSelect={updateRiskTolerance} />
        </div>

        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Trading Preference
          </div>
          <RadioRow options={modeOptions} selected={state.tradingPreference} onSelect={updateTradingPreference} />
        </div>
      </div>

      <StepNavigation
        currentStep={4}
        canGoBack
        canGoForward={canContinue}
        onBack={() => { updateStep(3); router.push('/onboarding/step-3') }}
        onForward={handleContinue}
        forwardButtonDisabled={!canContinue}
      />
    </div>
  )
}
