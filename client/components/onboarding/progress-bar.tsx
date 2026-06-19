'use client'

const STEP_LABELS = ['Name', 'Strategy', 'Mode', 'Create']

interface ProgressBarProps {
  currentStep: number
  totalSteps?: number
}

export default function ProgressBar({ currentStep, totalSteps = 4 }: ProgressBarProps) {
  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-4">
        {STEP_LABELS.slice(0, totalSteps).map((label, i) => {
          const step = i + 1
          const done    = step < currentStep
          const active  = step === currentStep
          return (
            <div key={step} className="flex items-center gap-2 flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done   ? 'bg-orange-accent text-white' :
                  active ? 'bg-orange-accent/20 border border-orange-accent text-orange-accent' :
                           'bg-secondary border border-border text-muted-foreground'
                }`}>
                  {done ? '✓' : step}
                </div>
                <span className={`text-[10px] font-medium ${active ? 'text-orange-accent' : 'text-muted-foreground'}`}>
                  {label}
                </span>
              </div>
              {i < totalSteps - 1 && (
                <div className={`flex-1 h-px mx-1 mb-4 transition-colors ${
                  done ? 'bg-orange-accent' : 'bg-border'
                }`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
