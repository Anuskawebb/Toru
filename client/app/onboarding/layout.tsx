import { OnboardingProvider } from '@/context/onboarding-context'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Create Agent — Toro',
  description: 'Set up your Toro autonomous trading agent',
}

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <OnboardingProvider>
      <div className="min-h-screen bg-background flex flex-col">
        <header className="border-b border-border px-6 h-14 flex items-center gap-3">
          <div className="w-6 h-6 bg-orange-accent rounded flex items-center justify-center">
            <span className="text-white text-[10px] font-black">T</span>
          </div>
          <span className="text-sm font-semibold text-foreground">Toro</span>
          <span className="text-muted-foreground mx-1">·</span>
          <span className="text-sm text-muted-foreground">Create Agent</span>
        </header>
        <div className="flex-1 flex items-start justify-center px-4 py-10 sm:py-16">
          <div className="w-full max-w-lg">
            {children}
          </div>
        </div>
      </div>
    </OnboardingProvider>
  )
}
