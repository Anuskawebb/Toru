'use client';

import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';
import { WagmiProvider, useSetActiveWallet } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createConfig } from '@privy-io/wagmi';
import { http, useAccount } from 'wagmi';
import { mantleSepolia } from '@/config/chains';
import { useState, useEffect } from 'react';
import { useTheme } from './ThemeProvider';

const wagmiConfig = createConfig({
  chains: [mantleSepolia],
  transports: { [mantleSepolia.id]: http() },
});

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

function PrivyWagmiSync() {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address: wagmiAddress } = useAccount();

  useEffect(() => {
    if (!user?.wallet?.address || wallets.length === 0) return;

    // Find the wallet object corresponding to the user's primary/active wallet in Privy
    const activePrivyWallet = wallets.find(
      (w) => w.address.toLowerCase() === user?.wallet?.address?.toLowerCase()
    );

    // If we found the wallet and it's different from the current Wagmi address, sync it
    if (activePrivyWallet && activePrivyWallet.address.toLowerCase() !== wagmiAddress?.toLowerCase()) {
      console.log('[PrivyWagmiSync] Syncing active wallet to Wagmi:', activePrivyWallet.address);
      setActiveWallet(activePrivyWallet).catch((err) => {
        console.error('[PrivyWagmiSync] Failed to set active wallet in Wagmi:', err);
      });
    }
  }, [user?.wallet?.address, wallets, wagmiAddress, setActiveWallet]);

  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const { theme } = useTheme();

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: { theme, accentColor: '#8B5CF6' },
        loginMethods: ['email', 'google', 'wallet'],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        supportedChains: [mantleSepolia],
        defaultChain: mantleSepolia,
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <PrivyWagmiSync />
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

