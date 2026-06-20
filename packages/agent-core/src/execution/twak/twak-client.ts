import { TwakConfig, TwakConfigSchema } from './twak-config.js';
import {
  TwakHealth, TwakWalletStatus, TwakAddress, TwakBalance, TwakPortfolio,
  TwakSwapResult, TwakSwapQuote, TwakTokenPrice, TwakTransferResult,
} from './twak-types.js';

export class TwakClient {
  private config: TwakConfig;

  constructor(config: Partial<TwakConfig> = {}) {
    this.config = TwakConfigSchema.parse(config);
  }

  private async request<T>(action: string, body: any = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (process.env.TWAK_HMAC_SECRET) {
      headers['Authorization'] = `Bearer ${process.env.TWAK_HMAC_SECRET}`;
    }

    if (this.config.password) {
      headers['x-wallet-password'] = this.config.password;
    }

    const url = `${this.config.apiUrl}/actions/${action}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorText = '';
      try {
        errorText = await response.text();
      } catch (e) {
        errorText = response.statusText;
      }
      throw new Error(`TWAK API Error (${response.status}): ${errorText}`);
    }

    return response.json() as unknown as T;
  }

  /**
   * Health Check
   * Verifies if the sidecar is reachable and authenticated.
   */
  async healthCheck(): Promise<TwakHealth> {
    try {
      const res = await this.request<any>('get_wallet_status');
      // If it doesn't throw, we assume it's reachable and configured
      return { status: res ? 'healthy' : 'unhealthy' };
    } catch (error) {
      console.error('HealthCheck Error:', error);
      return { status: 'unhealthy' };
    }
  }

  /**
   * Wallet Discovery
   * Fetches the current wallet status including chain support.
   */
  async getWalletStatus(): Promise<TwakWalletStatus> {
    const res = await this.request<any>('get_wallet_status');
    return {
      agentWallet: res.isConfigured ? 'configured' : 'not configured',
      chains: res.supportedChains?.length || 0,
      supportedChains: res.supportedChains?.length || 0,
    };
  }

  /**
   * Fetches derived addresses.
   */
  async getAddresses(): Promise<{ addresses: TwakAddress[] }> {
    const res = await this.request<any>('list_addresses');
    // Map response if it's not exactly the shape we expect
    return { addresses: res.addresses || res };
  }

  /**
   * Wallet Balance
   * Fetches the balance of the native token for a given chain.
   */
  async getBalance(chain: string): Promise<TwakBalance> {
    const addrRes = await this.request<any>('get_address', { chain });
    const res = await this.request<any>('wallet_balance', { chain, address: addrRes.address });
    return {
      chain,
      symbol: res.symbol || 'NATIVE',
      balance: typeof res.balance === 'object' ? res.balance.amount || res.balance.value : res.balance || res.amount || '0',
      usdValue: res.usdValue || res.fiatValue,
    };
  }

  /**
   * Wallet Portfolio
   * Fetches the full portfolio of assets across chains.
   */
  async getPortfolio(): Promise<TwakPortfolio> {
    const chain = 'smartchain';
    const addrRes = await this.request<any>('get_address', { chain });
    const res = await this.request<any>('get_token_holdings', { chain, address: addrRes.address });
    return {
      totalUsdValue: res.totalUsdValue || res.totalFiatValue || '0',
      assets: res.holdings || res.tokens || [],
    };
  }

  /**
   * Execute a token swap on BSC via TWAK.
   * Returns TwakSwapResult — callers must check `result.success` before trusting `hash`.
   */
  async swap(params: {
    fromToken: string;
    toToken:   string;
    amount:    string;
    slippage?: string;
  }): Promise<TwakSwapResult> {
    return this.request<TwakSwapResult>('swap', {
      fromChain: 'bsc',
      fromToken: params.fromToken,
      toChain:   'bsc',
      toToken:   params.toToken,
      amount:    params.amount,
      slippage:  params.slippage ?? '1',
    });
  }

  /**
   * Get a swap quote without executing.
   * Use for pre-flight checks and validation scripts.
   */
  async getSwapQuote(params: {
    fromToken: string;
    toToken:   string;
    amount:    string;
  }): Promise<TwakSwapQuote> {
    return this.request<TwakSwapQuote>('get_swap_quote', {
      fromChain: 'bsc',
      fromToken: params.fromToken,
      toChain:   'bsc',
      toToken:   params.toToken,
      amount:    params.amount,
    });
  }

  /**
   * Transfer native token or ERC-20 to an address.
   * Used by the x402 client to send micropayments for data purchases.
   */
  async transfer(params: {
    token: string;   // 'BNB' for native, or ERC-20 contract address
    to: string;
    amount: string;  // human-readable (e.g. "0.001")
    chain?: string;
  }): Promise<TwakTransferResult> {
    return this.request<TwakTransferResult>('transfer', {
      chain:  params.chain ?? 'smartchain',
      token:  params.token,
      to:     params.to,
      amount: params.amount,
    });
  }

  /**
   * Get the current USD price for a token on BSC.
   * Returns null if the token is not found or TWAK cannot price it.
   */
  async getTokenPrice(token: string): Promise<number | null> {
    try {
      const res = await this.request<TwakTokenPrice>('get_token_price', {
        chain: 'bsc',
        token,
      });
      if (res.success && typeof res.priceUsd === 'number' && res.priceUsd > 0) {
        return res.priceUsd;
      }
      return null;
    } catch {
      return null;
    }
  }
}
