'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useOnboarding } from '@/context/onboarding-context'
import { useAuth } from '@/context/auth-context'
import { usePrivy } from '@privy-io/react-auth'
import StepNavigation from '@/components/onboarding/step-navigation'
import { AtSign, Camera, Check, Loader2, X, User } from 'lucide-react'

function formatUsername(raw: string) {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30)
}

export default function Step1Page() {
  const router       = useRouter()
  const { user }     = usePrivy()
  const { getToken } = useAuth()
  const { state, updateUsername, updateDisplayName, updateProfileImage, updateStep } = useOnboarding()

  const [checking,       setChecking]       = useState(false)
  const [available,      setAvailable]      = useState<boolean | null>(null)
  const [usernameError,  setUsernameError]  = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileRef     = useRef<HTMLInputElement>(null)

  // Pre-fill displayName from Privy if not already set
  useEffect(() => {
    if (!state.displayName && user) {
      const name = user.google?.name ?? user.email?.address?.split('@')[0] ?? ''
      if (name) updateDisplayName(name)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const handleUsernameChange = (raw: string) => {
    const cleaned = formatUsername(raw)
    updateUsername(cleaned)
    setAvailable(null)
    setUsernameError(null)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (cleaned.length < 3) return

    debounceRef.current = setTimeout(async () => {
      setChecking(true)
      try {
        const token = await getToken()
        const res   = await fetch(`/api/users/check-username?username=${encodeURIComponent(cleaned)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        const data  = await res.json() as { available: boolean; error?: string }
        setAvailable(data.available)
        if (!data.available) setUsernameError('Username already taken')
      } catch {
        setAvailable(null)
      } finally {
        setChecking(false)
      }
    }, 500)
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    try {
      const token = await getToken()
      const res   = await fetch('/api/me/avatar', {
        method:  'POST',
        headers: {
          'Content-Type': file.type,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file,
      })
      if (res.ok) {
        const { url } = await res.json() as { url: string }
        updateProfileImage(url)
      }
    } catch { /* fail silently — user keeps their existing avatar */ }
    finally { setAvatarUploading(false) }
  }

  const canContinue =
    state.username.length >= 3 &&
    state.displayName.trim().length >= 1 &&
    available === true &&
    !checking

  const handleContinue = () => {
    if (!canContinue) return
    updateStep(2)
    router.push('/onboarding/step-2')
  }

  const avatarUrl = state.profileImageUrl || user?.twitter?.profilePictureUrl

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Create your profile</h2>
        <p className="text-sm text-muted-foreground">
          This is how you&apos;ll show up across Toru — choose a username, display name, and avatar.
        </p>
      </div>

      <div className="space-y-5 mb-8">
        {/* Avatar + identity preview */}
        <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl">
          {/* Clickable avatar */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={avatarUploading}
            className="relative shrink-0 group"
            title="Upload avatar"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="w-14 h-14 rounded-full object-cover" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[#15a374]/10 flex items-center justify-center">
                <User size={22} className="text-[#15a374]" />
              </div>
            )}
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {avatarUploading
                ? <Loader2 size={14} className="text-white animate-spin" />
                : <Camera size={14} className="text-white" />
              }
            </div>
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleAvatarChange}
          />

          <div>
            <div className="text-sm font-semibold text-foreground">
              {state.displayName || 'Your Name'}
            </div>
            <div className="text-xs text-muted-foreground">
              {state.username ? `@${state.username}` : '@username'}
            </div>
            <div className="text-[10px] text-muted-foreground/60 mt-1">
              Select an image — this&apos;ll be your identity on the platform
            </div>
          </div>
        </div>

        {/* Display name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            Display Name
          </label>
          <input
            type="text"
            value={state.displayName}
            onChange={(e) => updateDisplayName(e.target.value)}
            placeholder="e.g. Alex Carter"
            maxLength={100}
            className="w-full px-4 py-3 bg-card border border-border rounded-xl text-foreground placeholder:text-[rgba(13,13,13,0.42)] focus:outline-none focus:border-[#15a374] focus:ring-1 focus:ring-[#15a374]/30 transition-all text-sm"
          />
        </div>

        {/* Username */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            Username
          </label>
          <p className="text-xs text-muted-foreground/70">How do you want to be identified in Toru?</p>
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              <AtSign size={14} />
            </div>
            <input
              type="text"
              value={state.username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canContinue && handleContinue()}
              placeholder="alexc"
              maxLength={30}
              className={`w-full pl-9 pr-10 py-3 bg-card border rounded-xl text-foreground placeholder:text-[rgba(13,13,13,0.42)] focus:outline-none focus:ring-1 transition-all text-sm ${
                available === true
                  ? 'border-green-positive focus:border-green-positive focus:ring-green-positive/20'
                  : available === false
                    ? 'border-red-negative focus:border-red-negative focus:ring-red-negative/20'
                    : 'border-border focus:border-[#15a374] focus:ring-[#15a374]/30'
              }`}
              autoFocus
            />
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
              {checking
                ? <Loader2 size={14} className="text-muted-foreground animate-spin" />
                : available === true
                  ? <Check size={14} className="text-green-positive" />
                  : available === false
                    ? <X size={14} className="text-red-negative" />
                    : null
              }
            </div>
          </div>
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              {usernameError
                ? <span className="text-red-negative">{usernameError}</span>
                : available === true
                  ? <span className="text-green-positive">@{state.username} is available</span>
                  : 'Letters, numbers, underscores · 3–30 chars'}
            </p>
            <span className="text-xs text-muted-foreground">{state.username.length}/30</span>
          </div>
        </div>
      </div>

      <StepNavigation
        currentStep={1}
        canGoBack={false}
        canGoForward={canContinue}
        onBack={() => {}}
        onForward={handleContinue}
        forwardButtonDisabled={!canContinue}
      />
    </div>
  )
}
