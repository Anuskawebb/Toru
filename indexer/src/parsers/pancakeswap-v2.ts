import { createV2StyleParser } from './v2-style.js';

export const pancakeswapV2Parser = createV2StyleParser({
  dex: 'pancakeswap-v2',
  factories: [
    '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73', // PancakeSwap V2 Factory
    '0xBCfCcbde45cE874adCB698cC183deBcF17952812', // PancakeSwap V2 Factory (old)
  ],
});
