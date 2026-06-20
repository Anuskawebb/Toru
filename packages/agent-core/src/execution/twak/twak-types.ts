export interface TwakHealth {
  status: 'healthy' | 'unhealthy';
  version?: string;
}

export interface TwakWalletStatus {
  agentWallet: 'configured' | 'not configured';
  keychainPassword?: 'stored' | 'not stored';
  chains: number;
  supportedChains: number;
  createdAt?: string;
  addressCount?: number;
}

export interface TwakAddress {
  chainId: string;
  address: string;
}

export interface TwakBalance {
  chain: string;
  symbol: string;
  balance: string;
  usdValue?: string;
}

export interface TwakPortfolio {
  totalUsdValue?: string;
  assets: TwakBalance[];
}

export interface TwakSwapResult {
  success: boolean;
  hash?: string;
  summary?: string;
  provider?: string;
  explorer?: string;
  code?: string;
  message?: string;
}

export interface TwakSwapQuote {
  success: boolean;
  input?: string;
  output?: string;
  provider?: string;
  priceImpact?: number;
  steps?: number;
  code?: string;
  message?: string;
}

export interface TwakTokenPrice {
  success: boolean;
  token?: string;
  chain?: string;
  priceUsd?: number;
  code?: string;
  message?: string;
}

export interface TwakTransferResult {
  success: boolean;
  hash?: string;
  summary?: string;
  explorer?: string;
  code?: string;
  message?: string;
}
