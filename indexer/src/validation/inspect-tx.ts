import { bscClient } from '../chains/bsc.js';
import { decodeEventLog } from 'viem';

const erc20TransferAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' }
    ],
    name: 'Transfer',
    type: 'event'
  }
];

async function run() {
  const hash = '0x48060b610cf922d81c8f2c568cbfa0faf456c89f749e8636af44daaf16a087b2';
  const tx = await bscClient.getTransaction({ hash });
  const receipt = await bscClient.getTransactionReceipt({ hash });

  console.log('Tx From:', tx.from);
  console.log('Tx To:', tx.to);
  console.log('Tx Value:', tx.value.toString());

  console.log('Logs:');
  for (const log of receipt.logs) {
    if (
      log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
      log.topics.length === 3
    ) {
      try {
        const decoded = decodeEventLog({
          abi: erc20TransferAbi,
          data: log.data,
          topics: log.topics,
        });
        console.log(`  Transfer: ${(decoded.args as any).from} -> ${(decoded.args as any).to} [Value: ${(decoded.args as any).value.toString()} of Token ${log.address}]`);
      } catch (e) {
        console.log('  Malformed Transfer log');
      }
    } else {
      console.log(`  Log Topic0: ${log.topics[0]} from Contract ${log.address}`);
    }
  }
}

run().catch(console.error);
