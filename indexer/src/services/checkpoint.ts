import { readFile, writeFile } from 'fs/promises';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import type { Checkpoint } from '../types/index.js';

// ── Type guard ────────────────────────────────────────────────────────────────

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function isValidCheckpoint(raw: unknown): raw is Checkpoint {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as Record<string, unknown>)['lastProcessedBlock'] === 'number' &&
    typeof (raw as Record<string, unknown>)['updatedAt'] === 'string'
  );
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CheckpointService {
  private readonly filePath: string;

  constructor(filePath = env.CHECKPOINT_FILE) {
    this.filePath = filePath;
  }

  /**
   * Returns the last successfully processed block number, or null if no
   * checkpoint exists yet (fresh start).
   */
  async getLastProcessedBlock(): Promise<number | null> {
    let raw: string;

    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if (isEnoent(err)) {
        logger.info('No checkpoint found — starting from scratch', {
          path: this.filePath,
        });
        return null;
      }
      throw new Error(`Failed to read checkpoint at ${this.filePath}: ${String(err)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Checkpoint file at ${this.filePath} contains invalid JSON`);
    }

    if (!isValidCheckpoint(parsed)) {
      throw new Error(
        `Checkpoint file at ${this.filePath} has unexpected shape: ${raw.slice(0, 120)}`,
      );
    }

    logger.debug('Checkpoint loaded', {
      lastProcessedBlock: parsed.lastProcessedBlock,
      updatedAt: parsed.updatedAt,
    });

    return parsed.lastProcessedBlock;
  }

  /** Persists the last processed block number atomically. */
  async saveLastProcessedBlock(blockNumber: number): Promise<void> {
    const checkpoint: Checkpoint = {
      lastProcessedBlock: blockNumber,
      updatedAt: new Date().toISOString(),
    };

    try {
      await writeFile(this.filePath, JSON.stringify(checkpoint, null, 2) + '\n', 'utf-8');
    } catch (err) {
      throw new Error(`Failed to write checkpoint to ${this.filePath}: ${String(err)}`);
    }

    logger.debug('Checkpoint saved', { lastProcessedBlock: blockNumber });
  }
}
