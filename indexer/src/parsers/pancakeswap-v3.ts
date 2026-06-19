import { createV3StyleParser } from './v3-style.js';

export const pancakeswapV3Parser = createV3StyleParser({
  dex: 'pancakeswap-v3',
  factories: [
    '0x41ea85c0a122173cd908522397307f98f6d5e65c', // PancakeSwap V3 Factory
  ],
});
