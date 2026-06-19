'use client'

import React, { createContext, useContext, useState } from 'react'

export interface OnboardingState {
  currentStep: number
  agentName: string
  riskLevel: 'conservative' | 'balanced' | 'aggressive' | null
  tradingMode: 'autonomous' | 'assisted' | null
  agentWalletAddress: string | null
}

interface OnboardingContextType {
  state: OnboardingState
  updateStep: (step: number) => void
  updateAgentName: (name: string) => void
  updateRiskLevel: (level: 'conservative' | 'balanced' | 'aggressive') => void
  updateTradingMode: (mode: 'autonomous' | 'assisted') => void
  updateAgentWallet: (address: string) => void
  reset: () => void
}

const initialState: OnboardingState = {
  currentStep: 1,
  agentName: '',
  riskLevel: null,
  tradingMode: null,
  agentWalletAddress: null,
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined)

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OnboardingState>(initialState)

  const updateStep        = (step: number)                                              => setState((p) => ({ ...p, currentStep: step }))
  const updateAgentName   = (name: string)                                              => setState((p) => ({ ...p, agentName: name }))
  const updateRiskLevel   = (level: 'conservative' | 'balanced' | 'aggressive')        => setState((p) => ({ ...p, riskLevel: level }))
  const updateTradingMode = (mode: 'autonomous' | 'assisted')                          => setState((p) => ({ ...p, tradingMode: mode }))
  const updateAgentWallet = (address: string)                                           => setState((p) => ({ ...p, agentWalletAddress: address }))
  const reset             = ()                                                          => setState(initialState)

  return (
    <OnboardingContext.Provider value={{
      state, updateStep, updateAgentName, updateRiskLevel,
      updateTradingMode, updateAgentWallet, reset,
    }}>
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error('useOnboarding must be inside OnboardingProvider')
  return ctx
}
