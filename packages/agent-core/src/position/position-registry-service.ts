import { db, agentPositions, eq, and } from '@aether/db';
import { randomUUID } from 'crypto';
import {
  type AgentPosition,
  type CloseReason,
  type PositionStatus,
} from '../decision/trade-recommendation-types.js';

/**
 * PositionRegistryService — manages the agent's tracked open positions.
 *
 * Distinct from wallet_positions (raw blockchain accounting).
 * Tracks entry parameters, stop-loss, take-profit, and lifecycle state
 * for each position the agent has intentionally opened.
 *
 * Invariant: at most one OPEN position per (agentWallet, tokenAddress).
 * Enforced by openPosition() checking before inserting.
 */
export class PositionRegistryService {
  private readonly agentWallet: string;

  constructor(agentWallet: string) {
    this.agentWallet = agentWallet.toLowerCase();
  }

  // ── Write ops ─────────────────────────────────────────────────────────────

  /**
   * Opens a new position. Throws if an OPEN position already exists for this token.
   */
  async openPosition(params: {
    tokenAddress:     string;
    tokenSymbol:      string;
    recommendationId: string;
    entryPriceUsd:    number;
    positionSizeUsd:  number;
    positionSizePct:  number;
    stopLossPct:      number;
    takeProfitPct:    number;
    openedAt?:        Date;
  }): Promise<AgentPosition> {
    const tokenAddress = params.tokenAddress.toLowerCase();

    const existing = await this.getOpenPosition(tokenAddress);
    if (existing) {
      throw new Error(
        `[PositionRegistry] Cannot open position: OPEN position already exists for ${tokenAddress}`
      );
    }

    const now = params.openedAt ?? new Date();
    const row = {
      id:               randomUUID(),
      agentWallet:      this.agentWallet,
      tokenAddress,
      tokenSymbol:      params.tokenSymbol,
      recommendationId: params.recommendationId,
      entryPriceUsd:    params.entryPriceUsd,
      currentPriceUsd:  params.entryPriceUsd,
      positionSizeUsd:  params.positionSizeUsd,
      positionSizePct:  params.positionSizePct,
      stopLossPct:      params.stopLossPct,
      takeProfitPct:    params.takeProfitPct,
      unrealizedPnlPct: 0,
      status:           'OPEN' as PositionStatus,
      closeReason:      null,
      closePriceUsd:    null,
      openedAt:         now,
      closedAt:         null,
      updatedAt:        now,
    };

    try {
      await db.insert(agentPositions).values(row);
    } catch (e: unknown) {
      // PostgreSQL unique_violation (23505) from the partial unique index —
      // another concurrent insert won the race for this (wallet, token, OPEN) slot.
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === '23505') {
        throw new Error(
          `[PositionRegistry] Cannot open position: OPEN position already exists for ${tokenAddress} (concurrent insert rejected by database)`
        );
      }
      throw e;
    }
    return row;
  }

  /**
   * Updates the mark-to-market price and unrealized P&L for an open position.
   * Returns null if no open position exists for this token.
   */
  async updateMarkToMarket(
    tokenAddress: string,
    currentPriceUsd: number,
    now: Date = new Date(),
  ): Promise<AgentPosition | null> {
    const position = await this.getOpenPosition(tokenAddress);
    if (!position) return null;

    const unrealizedPnlPct = ((currentPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;
    const rounded = Math.round(unrealizedPnlPct * 10000) / 10000;

    await db
      .update(agentPositions)
      .set({ currentPriceUsd, unrealizedPnlPct: rounded, updatedAt: now })
      .where(eq(agentPositions.id, position.id));

    return { ...position, currentPriceUsd, unrealizedPnlPct: rounded, updatedAt: now };
  }

  /**
   * Closes an open position. Returns null if no open position exists.
   */
  async closePosition(
    tokenAddress: string,
    closePriceUsd: number,
    reason: CloseReason,
    closedAt: Date = new Date(),
  ): Promise<AgentPosition | null> {
    const position = await this.getOpenPosition(tokenAddress);
    if (!position) return null;

    const unrealizedPnlPct = ((closePriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;
    const rounded = Math.round(unrealizedPnlPct * 10000) / 10000;

    await db
      .update(agentPositions)
      .set({
        currentPriceUsd:  closePriceUsd,
        unrealizedPnlPct: rounded,
        status:           'CLOSED',
        closeReason:      reason,
        closePriceUsd,
        closedAt,
        updatedAt:        closedAt,
      })
      .where(eq(agentPositions.id, position.id));

    return {
      ...position,
      currentPriceUsd:  closePriceUsd,
      unrealizedPnlPct: rounded,
      status:           'CLOSED',
      closeReason:      reason,
      closePriceUsd,
      closedAt,
      updatedAt:        closedAt,
    };
  }

  // ── Read ops ──────────────────────────────────────────────────────────────

  async getOpenPosition(tokenAddress: string): Promise<AgentPosition | null> {
    const rows = await db
      .select()
      .from(agentPositions)
      .where(
        and(
          eq(agentPositions.agentWallet, this.agentWallet),
          eq(agentPositions.tokenAddress, tokenAddress.toLowerCase()),
          eq(agentPositions.status, 'OPEN'),
        )
      )
      .limit(1);

    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async getAllOpenPositions(): Promise<AgentPosition[]> {
    const rows = await db
      .select()
      .from(agentPositions)
      .where(
        and(
          eq(agentPositions.agentWallet, this.agentWallet),
          eq(agentPositions.status, 'OPEN'),
        )
      );

    return rows.map(r => this.mapRow(r));
  }

  async getAllPositions(): Promise<AgentPosition[]> {
    const rows = await db
      .select()
      .from(agentPositions)
      .where(eq(agentPositions.agentWallet, this.agentWallet));

    return rows.map(r => this.mapRow(r));
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private mapRow(row: typeof agentPositions.$inferSelect): AgentPosition {
    return {
      id:               row.id,
      agentWallet:      row.agentWallet,
      tokenAddress:     row.tokenAddress,
      tokenSymbol:      row.tokenSymbol,
      recommendationId: row.recommendationId ?? null,
      entryPriceUsd:    row.entryPriceUsd,
      currentPriceUsd:  row.currentPriceUsd,
      positionSizeUsd:  row.positionSizeUsd,
      positionSizePct:  row.positionSizePct,
      stopLossPct:      row.stopLossPct,
      takeProfitPct:    row.takeProfitPct,
      unrealizedPnlPct: row.unrealizedPnlPct,
      status:           row.status as PositionStatus,
      closeReason:      row.closeReason as CloseReason | null,
      closePriceUsd:    row.closePriceUsd,
      openedAt:         row.openedAt,
      closedAt:         row.closedAt,
      updatedAt:        row.updatedAt,
    };
  }
}
