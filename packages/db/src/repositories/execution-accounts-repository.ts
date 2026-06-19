import { randomUUID } from 'crypto';
import { db, executionAccounts, eq, and } from '../client.js';
import { type ExecutionAccountRow, type InsertExecutionAccount, type AccountType, type AccountStatus } from '../schema/execution-accounts.js';

export type { ExecutionAccountRow, AccountType, AccountStatus };

export interface CreateAccountParams {
  agentId:       string;
  userId?:       string;
  accountType:   AccountType;
  walletAddress: string;
  status?:       AccountStatus;
  metadata?:     Record<string, unknown>;
}

export class ExecutionAccountsRepository {
  static async create(params: CreateAccountParams): Promise<ExecutionAccountRow> {
    const now = new Date();
    const row: InsertExecutionAccount = {
      id:            randomUUID(),
      agentId:       params.agentId,
      userId:        params.userId ?? null,
      accountType:   params.accountType,
      walletAddress: params.walletAddress.toLowerCase(),
      status:        params.status ?? 'ACTIVE',
      metadata:      params.metadata ?? null,
      createdAt:     now,
      updatedAt:     now,
    };

    const [inserted] = await db
      .insert(executionAccounts)
      .values(row)
      .onConflictDoNothing()
      .returning();

    // If onConflictDoNothing skipped the insert, fetch the existing row
    if (!inserted) {
      const existing = await ExecutionAccountsRepository.getByAgentId(params.agentId);
      if (!existing) throw new Error(`Failed to create or find execution account for agentId=${params.agentId}`);
      return existing;
    }

    return inserted;
  }

  static async getByAgentId(agentId: string): Promise<ExecutionAccountRow | null> {
    const rows = await db
      .select()
      .from(executionAccounts)
      .where(eq(executionAccounts.agentId, agentId))
      .limit(1);
    return rows[0] ?? null;
  }

  static async getByWalletAddress(walletAddress: string): Promise<ExecutionAccountRow | null> {
    const rows = await db
      .select()
      .from(executionAccounts)
      .where(eq(executionAccounts.walletAddress, walletAddress.toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  static async getActive(agentId: string): Promise<ExecutionAccountRow | null> {
    const rows = await db
      .select()
      .from(executionAccounts)
      .where(and(
        eq(executionAccounts.agentId, agentId),
        eq(executionAccounts.status, 'ACTIVE'),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  static async updateStatus(id: string, status: AccountStatus): Promise<void> {
    await db
      .update(executionAccounts)
      .set({ status, updatedAt: new Date() })
      .where(eq(executionAccounts.id, id));
  }

  static async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await db
      .update(executionAccounts)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(executionAccounts.id, id));
  }
}
