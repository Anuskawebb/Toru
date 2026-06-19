'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useOnboarding } from '@/context/onboarding-context'
import ProgressBar from '@/components/onboarding/progress-bar'
import StepNavigation from '@/components/onboarding/step-navigation'
import { Bot, Shield, Zap, CheckCircle2 } from 'lucide-react'
import { ensureAgentWallet } from '@/lib/api'

const AGENT_ID = process.env.NEXT_PUBLIC_TORO_AGENT_ID ?? 'toro-agent-001'

const riskLabels: Record<string, string> = {
  conservative: 'Conservative',
  balanced: 'Balanced',
  aggressive: 'Aggressive',
}

const modeLabels: Record<string, string> = {
  autonomous: 'Autonomous',
  assisted: 'Assisted',
}

export default function Step4Page() {
  const router = useRouter()
  const { state, updateAgentWallet, reset } = useOnboarding()
  const [creating, setCreating]   = useState(false)
  const [done, setDone]           = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      const { account } = await ensureAgentWallet(AGENT_ID)
      if (account) {
        updateAgentWallet(account.walletAddress)
      }
      setDone(true)
    } catch {
      setError('Failed to provision wallet. Check that TWAK sidecar is running.')
    } finally {
      setCreating(false)
    }
  }

  const handleGoToExecution = () => {
    reset()
    router.push('/execution-center')
  }

  if (done) {
    return (
      <div className="text-center py-4">
        <div className="w-16 h-16 rounded-full bg-green-positive/10 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 size={32} className="text-green-positive" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Agent Created</h2>
        <p className="text-muted-foreground text-sm mb-8">
          <span className="font-semibold text-foreground">{state.agentName}</span> is ready.
          Fund your wallet in the Execution Center to activate trading.
        </p>

        <div className="bg-card border border-border rounded-xl p-5 text-left mb-8 space-y-3">
          <SummaryRow label="Agent Name" value={state.agentName} />
          <SummaryRow label="Strategy" value={riskLabels[state.riskLevel ?? ''] ?? '—'} />
          <SummaryRow label="Mode" value={modeLabels[state.tradingMode ?? ''] ?? '—'} />
          {state.agentWalletAddress && (
            <SummaryRow label="Wallet" value={`${state.agentWalletAddress.slice(0,10)}…`} mono />
          )}
        </div>

        <button
          onClick={handleGoToExecution}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-orange-accent text-white rounded-xl font-semibold text-sm hover:bg-orange-accent/90 transition-all"
        >
          <Zap size={15} />
          Go to Execution Center
        </button>
      </div>
    )
  }

  return (
    <div>
      <ProgressBar currentStep={4} />

      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Create your agent</h2>
        <p className="text-sm text-muted-foreground">
          Review your configuration and launch <span className="text-foreground font-medium">{state.agentName || 'your agent'}</span>.
        </p>
      </div>

      {/* Summary card */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6 space-y-3">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-orange-accent/10 flex items-center justify-center">
            <Bot size={18} className="text-orange-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">{state.agentName || 'My Agent'}</div>
            <div className="text-xs text-muted-foreground">Autonomous Trading Agent</div>
          </div>
        </div>
        <SummaryRow label="Strategy" value={riskLabels[state.riskLevel ?? ''] ?? '—'} />
        <SummaryRow label="Trading Mode" value={modeLabels[state.tradingMode ?? ''] ?? '—'} />
        <SummaryRow label="Network" value="BNB Smart Chain" />
      </div>

      {/* What happens next */}
      <div className="bg-secondary/50 border border-border rounded-xl p-4 mb-8 space-y-2.5">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">What happens next</div>
        <InfoRow icon={Shield} text="An isolated agent wallet is provisioned on BSC via TWAK" />
        <InfoRow icon={Bot} text="Your agent config is saved and ready to activate" />
        <InfoRow icon={Zap} text="You'll fund the wallet in the Execution Center to start trading" />
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-negative/10 border border-red-negative/30 rounded-lg text-xs text-red-negative">
          {error}
        </div>
      )}

      <StepNavigation
        currentStep={4}
        canGoBack={!creating}
        canGoForward
        onBack={() => { router.push('/onboarding/step-3') }}
        onForward={handleCreate}
        forwardButtonText="Create Agent"
        loading={creating}
      />
    </div>
  )
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm border-t border-border pt-3 first:border-0 first:pt-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium text-foreground ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

function InfoRow({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon size={13} className="text-muted-foreground mt-0.5 shrink-0" />
      <span className="text-xs text-muted-foreground">{text}</span>
    </div>
  )
}
