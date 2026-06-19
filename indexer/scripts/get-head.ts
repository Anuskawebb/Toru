import { getLatestBlock } from '../src/chains/bsc.js';

const head = await getLatestBlock();
console.log(head.number.toString());
