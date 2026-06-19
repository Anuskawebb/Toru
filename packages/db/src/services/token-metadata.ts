import { getAddress } from 'viem';
import { TokenRepository } from '../repositories/token-repository.js';

export interface TokenMetadata {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  imageUrl: string | null;
  coingeckoId: string | null;
}

export interface LogoProvider {
  name: string;
  resolveLogo(address: string, symbol: string): Promise<{ imageUrl: string; coingeckoId?: string } | null>;
}

export class TrustWalletProvider implements LogoProvider {
  name = 'TrustWallet';

  async resolveLogo(address: string): Promise<{ imageUrl: string } | null> {
    try {
      // Trust Wallet uses checksummed addresses for directories
      const checksumAddress = getAddress(address);
      const url = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/${checksumAddress}/logo.png`;
      
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) {
        return { imageUrl: url };
      }
    } catch {
      // Fail silently, fall through
    }
    return null;
  }
}

export class CoinGeckoProvider implements LogoProvider {
  name = 'CoinGecko';

  async resolveLogo(address: string): Promise<{ imageUrl: string; coingeckoId: string } | null> {
    try {
      const formattedAddress = address.toLowerCase();
      // CoinGecko API contract address endpoint for BSC
      const url = `https://api.coingecko.com/api/v3/coins/binance-smart-chain/contract/${formattedAddress}`;
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as any;
        const imageUrl = data?.image?.large || data?.image?.small || data?.image?.thumb || null;
        const coingeckoId = data?.id || null;
        
        if (imageUrl && coingeckoId) {
          return { imageUrl, coingeckoId };
        }
      }
    } catch {
      // Fail silently, fall through (handles rate limits / offline gracefully)
    }
    return null;
  }
}

export class TokenMetadataService {
  private static logoProviders: LogoProvider[] = [
    new TrustWalletProvider(),
    new CoinGeckoProvider()
  ];

  private static PLACEHOLDER_LOGO = 'https://assets.coingecko.com/coins/images/placeholder.png';

  /**
   * Registers an additional logo provider to make the service extensible.
   */
  static registerProvider(provider: LogoProvider): void {
    this.logoProviders.push(provider);
  }

  /**
   * Resolves token metadata using the logo resolution strategy.
   * Priority:
   * 1. Check DB Cache
   * 2. Query Trust Wallet
   * 3. Query CoinGecko
   * 4. Fallback to placeholder logo
   *
   * Note: This method is designed to be called by the background metadata worker
   * or client-side queries, NOT in the critical path of trade ingestion.
   */
  static async resolveMetadata(address: string, fallbackSymbol: string = 'UNKNOWN', fallbackName: string = 'Unknown Token', fallbackDecimals: number = 18): Promise<TokenMetadata> {
    const formattedAddress = address.toLowerCase();
    
    // 1. Check database cache first
    const cachedToken = await TokenRepository.findByAddress(formattedAddress);
    
    if (cachedToken && cachedToken.imageUrl && cachedToken.coingeckoId) {
      return {
        address: cachedToken.address,
        symbol: cachedToken.symbol,
        name: cachedToken.name,
        decimals: cachedToken.decimals,
        imageUrl: cachedToken.imageUrl,
        coingeckoId: cachedToken.coingeckoId,
      };
    }

    // Prepare current values to merge/fall back
    let symbol = cachedToken?.symbol ?? fallbackSymbol;
    let name = cachedToken?.name ?? fallbackName;
    let decimals = cachedToken?.decimals ?? fallbackDecimals;
    let imageUrl = cachedToken?.imageUrl ?? null;
    let coingeckoId = cachedToken?.coingeckoId ?? null;

    // 2 & 3. Run external providers for logo/metadata resolution
    for (const provider of this.logoProviders) {
      if (imageUrl && coingeckoId) break; // Fully resolved

      try {
        const result = await provider.resolveLogo(formattedAddress, symbol);
        if (result) {
          if (!imageUrl && result.imageUrl) {
            imageUrl = result.imageUrl;
          }
          if (!coingeckoId && result.coingeckoId) {
            coingeckoId = result.coingeckoId;
          }
        }
      } catch {
        // Continue to next provider on failure
      }
    }

    // 4. Default to placeholder logo if still unresolved
    if (!imageUrl) {
      imageUrl = this.PLACEHOLDER_LOGO;
    }

    const resolvedMetadata: TokenMetadata = {
      address: formattedAddress,
      symbol,
      name,
      decimals,
      imageUrl,
      coingeckoId,
    };

    // Save/upsert resolved values in db cache
    await TokenRepository.upsertToken({
      address: formattedAddress,
      symbol,
      name,
      decimals,
      imageUrl,
      coingeckoId,
      verified: cachedToken?.verified ?? false,
    });

    return resolvedMetadata;
  }
}
