import { OnboardingProvider } from '@/context/onboarding-context'
import OnboardingPrefill from '@/components/onboarding/prefill'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Setup Profile — Toru',
  description: 'Set up your Toru profile to get started',
}

// Landing-page palette
const PAPER = '#efece3'
const INK   = '#0d0d0d'

// Force the LIGHT design tokens for the whole onboarding subtree, so the steps
// stay readable on the cream panel even when the OS / app theme is dark.
const lightTheme: React.CSSProperties = {
  colorScheme: 'light',
  ['--background' as string]:           '#ffffff',
  ['--foreground' as string]:           '#000000',
  ['--card' as string]:                 '#ffffff',
  ['--card-foreground' as string]:      '#000000',
  ['--popover' as string]:              '#ffffff',
  ['--popover-foreground' as string]:   '#000000',
  ['--primary' as string]:              '#000000',
  ['--primary-foreground' as string]:   '#ffffff',
  ['--secondary' as string]:            '#f5f5f5',
  ['--secondary-foreground' as string]: '#000000',
  ['--muted' as string]:                '#f5f5f5',
  ['--muted-foreground' as string]:     '#666666',
  ['--accent' as string]:               '#f5f5f5',
  ['--accent-foreground' as string]:    '#000000',
  ['--destructive' as string]:          '#dc2626',
  ['--border' as string]:               '#e5e5e5',
  ['--input' as string]:                '#e5e5e5',
  ['--ring' as string]:                 '#b3b3b3',
  ['--orange-accent' as string]:        '#ff6b2c',
  ['--green-positive' as string]:       '#10b981',
  ['--red-negative' as string]:         '#ef4444',
}

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <OnboardingProvider>
      <OnboardingPrefill />
      {/* Split screen — left content transitions between steps, right image stays fixed */}
      <div className="fixed inset-0 flex" style={{ ...lightTheme, backgroundColor: PAPER }}>
        {/* ── Left — content panel (changes per step) ───────────────────── */}
        <div className="w-full overflow-y-auto lg:w-1/2" style={{ backgroundColor: PAPER, color: INK }}>
          <div className="flex min-h-full flex-col px-8 py-8 sm:px-14">
            {/* Content (vertically centred) with the logo pinned just above it */}
            <div className="flex flex-1 flex-col justify-center">
              <div className="mx-auto w-full max-w-2xl">
                {/* Persistent brand — sits just above the page heading on every step */}
                <img src="/toru.png" alt="Toru" className="mb-7 h-20 w-auto" />
                {children}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right — fixed image panel (persists across every step) ────── */}
        <div className="relative hidden overflow-hidden lg:block lg:w-1/2" style={{ backgroundColor: INK }}>
          <img src="/pepe-2.jpeg" alt="Toru" className="absolute inset-0 h-full w-full object-cover" />
          {/* Green-tinted overlay to match the landing imagery */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(135deg, rgba(21,163,116,0.25) 0%, rgba(13,13,13,0.35) 100%)' }}
          />
        </div>
      </div>
    </OnboardingProvider>
  )
}
