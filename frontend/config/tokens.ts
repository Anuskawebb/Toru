// Token addresses on Mantle Mainnet (where leaders trade, via Agni Finance pools).
// VaultManager on Mantle Sepolia uses these same addresses as keys in its
// latestPrice mapping and allowlist — keep them in sync with the watcher config.

export const MAINNET_TOKENS: Record<string, `0x${string}`> = {
  'WMNT': '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8',
  'USDe': '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34',
  'USDC': '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9',
  'USDT': '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE',
  'WETH': '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111',
  'mETH': '0xcDA86A272531e8640cD7F1a92c01839911B90bb0',
};

// Reverse lookup — canonical lowercase address → display symbol
export const TOKEN_SYMBOL: Record<string, string> = {
  '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8': 'WMNT',
  '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34': 'USDe',
  '0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9': 'USDC',
  '0x201eba5cc46d216ce6dc03f6a759e8e766e956ae': 'USDT',
  '0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111': 'WETH',
  '0xcda86a272531e8640cd7f1a92c01839911b90bb0': 'mETH',
};

export function symbolToAddress(symbol: string): `0x${string}` | undefined {
  return MAINNET_TOKENS[symbol];
}

export function addressToSymbol(address: string): string {
  return TOKEN_SYMBOL[address.toLowerCase()] ?? address.slice(0, 6) + '…';
}
