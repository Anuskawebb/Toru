import { AgentCreationProvider } from '@/context/agent-creation-context'
import AgentCreationPrefill from '@/components/agent/agent-creation-prefill'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Create Agent — Toru',
  description: 'Create an autonomous trading agent',
}

export default function AgentCreationLayout({ children }: { children: React.ReactNode }) {
  return (
    <AgentCreationProvider>
      <AgentCreationPrefill />
      <div className="dark min-h-screen bg-background flex flex-col">
        <header className="border-b border-border px-6 h-14 flex items-center gap-3">
          <div className="w-6 h-6 bg-orange-accent rounded flex items-center justify-center">
            <span className="text-white text-[10px] font-black">T</span>
          </div>
          <span className="text-sm font-semibold text-foreground">Toru</span>
          <span className="text-muted-foreground mx-1">·</span>
          <span className="text-sm text-muted-foreground">Create Agent</span>
        </header>
        <div className="flex-1 flex items-start justify-center px-4 py-10 sm:py-16">
          <div className="w-full max-w-lg">
            {children}
          </div>
        </div>
      </div>
    </AgentCreationProvider>
  )
}
