import { createV2StyleParser } from './v2-style.js';
import { createV3StyleParser } from './v3-style.js';

export const thenaV2Parser = createV2StyleParser({
  dex: 'thena',
  factories: [
    '0x6d8EDFf1B0a01F28516Eeee58EBF99FE977dB511', // THENA classic/stable PairFactory
  ],
});

export const thenaV3Parser = createV3StyleParser({
  dex: 'thena',
  factories: [
    '0x306F06C147f064A010530292A1EB6737c3e378e4', // THENA Fusion/Algebra Factory
  ],
});
