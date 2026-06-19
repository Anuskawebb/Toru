'use client'

import { ArrowLeft } from 'lucide-react'

interface StepNavigationProps {
  currentStep: number
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  forwardButtonText?: string
  backButtonText?: string
  forwardButtonDisabled?: boolean
  loading?: boolean
}

export default function StepNavigation({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  forwardButtonText = 'Continue',
  backButtonText = 'Back',
  forwardButtonDisabled = false,
  loading = false,
}: StepNavigationProps) {
  return (
    <div className="flex items-center justify-between gap-4 pt-6 border-t border-border mt-6">
      <button
        onClick={onBack}
        disabled={!canGoBack}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          canGoBack
            ? 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            : 'text-muted-foreground/40 cursor-not-allowed'
        }`}
      >
        <ArrowLeft size={14} />
        {backButtonText}
      </button>

      <button
        onClick={onForward}
        disabled={!canGoForward || forwardButtonDisabled || loading}
        className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
          canGoForward && !forwardButtonDisabled && !loading
            ? 'bg-orange-accent text-white hover:bg-orange-accent/90 shadow-sm'
            : 'bg-secondary text-muted-foreground/50 cursor-not-allowed'
        }`}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" className="opacity-75" />
            </svg>
            Creating…
          </span>
        ) : forwardButtonText}
      </button>
    </div>
  )
}
