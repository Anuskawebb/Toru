import type { GetTransactionReceiptReturnType } from 'viem';
import type { RawEvent } from '../types/index.js';

type Receipt = GetTransactionReceiptReturnType;

/**
 * Converts all logs in a transaction receipt into protocol-neutral RawEvents.
 *
 * The `wallet` field is populated from `receipt.from` so callers do not need
 * a separate eth_getTransaction call.
 */
export function extractEvents(receipt: Receipt): RawEvent[] {
  if (receipt.status === 'reverted') return [];
  if (receipt.logs.length === 0) return [];

  return receipt.logs.map((log, i): RawEvent => ({
    txHash:          receipt.transactionHash,
    blockNumber:     receipt.blockNumber,
    logIndex:        log.logIndex ?? i,
    contractAddress: log.address,
    topics:          log.topics,
    data:            log.data,
    wallet:          receipt.from,
  }));
}
