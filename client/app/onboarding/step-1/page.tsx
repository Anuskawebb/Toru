'use client'

import { useRouter } from 'next/navigation'
import { useOnboarding } from '@/context/onboarding-context'
import ProgressBar from '@/components/onboarding/progress-bar'
import StepNavigation from '@/components/onboarding/step-navigation'
import { Bot } from 'lucide-react'

export default function Step1Page() {
  const router = useRouter()
  const { state, updateAgentName, updateStep } = useOnboarding()

  const name = state.agentName.trim()

  const handleContinue = () => {
    if (name) {
      updateStep(2)
      router.push('/onboarding/step-2')
    }
  }

  return (
    <div>
      <ProgressBar currentStep={1} />

      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Name your agent</h2>
        <p className="text-sm text-muted-foreground">
          Give your trading agent a name. You can have multiple agents later.
        </p>
      </div>

      {/* Agent name input */}
      <div className="space-y-2 mb-8">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          Agent Name
        </label>
        <div className="relative">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Bot size={15} />
          </div>
          <input
            type="text"
            value={state.agentName}
            onChange={(e) => updateAgentName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name && handleContinue()}
            placeholder="e.g. Toro Alpha"
            maxLength={32}
            className="w-full pl-10 pr-4 py-3 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-accent focus:ring-1 focus:ring-orange-accent/30 transition-all text-sm"
            autoFocus
          />
        </div>
        <div className="flex justify-end">
          <span className="text-xs text-muted-foreground">{state.agentName.length}/32</span>
        </div>
      </div>

      {/* Preview */}
      {name && (
        <div className="flex items-center gap-3 p-4 bg-card border border-border rounded-xl mb-8">
          <div className="w-10 h-10 rounded-lg bg-orange-accent/10 flex items-center justify-center">
            <Bot size={18} className="text-orange-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">{name}</div>
            <div className="text-xs text-muted-foreground">Your autonomous trading agent</div>
          </div>
          <div className="ml-auto px-2 py-0.5 rounded bg-secondary text-xs text-muted-foreground">
            Pending Setup
          </div>
        </div>
      )}

      <StepNavigation
        currentStep={1}
        canGoBack={false}
        canGoForward={!!name}
        onBack={() => {}}
        onForward={handleContinue}
        forwardButtonDisabled={!name}
      />
    </div>
  )
}
