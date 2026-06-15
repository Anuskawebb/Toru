import { getCurrentWmntPrice } from './price.js';
import { callSetPrice, callClosePosition } from './keeper.js';
import { log, warn, error } from './logger.js';
import { markStopLoss } from './stop-loss-registry.js';
import { assessPositionRiskAI } from './risk-agent.js';
import type { Db } from './db.js';

// Global fallback (env STOP_LOSS_PCT) used only for startup log; actual threshold is per-vault
const DEFAULT_STOP_LOSS_PCT = Number(process.env.STOP_LOSS_PCT ?? '20');

// On-chain token addresses (VaultManager uses these as price-oracle keys,
// see frontend/config/tokens.ts MAINNET_TOKENS)
const TOKEN_ADDRESS: Record<string, `0x${string}`> = {
  WMNT: '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8',
};

// Prevent duplicate concurrent closes for the same position
const closingSet = new Set<string>();

async function triggerClose(
  label:      string, // 'STOP-LOSS' | 'AI-RISK'
  logTag:     string, // 'stop-loss' | 'risk-agent'
  positionId: string,
  token:      string,
  follower:   string,
  pct:        number,
  priceUsd:   number,
  reason:     string,
): Promise<void> {
  const tokenAddr = TOKEN_ADDRESS[token];
  if (!tokenAddr) {
    error('pnl', `${logTag}: no token address mapping for ${token} — cannot close posId=${positionId.slice(0, 10)}…`);
    return;
  }

  warn('pnl', `${label} triggered — follower=${follower.slice(0, 10)}…  token=${token}  drawdown=${(pct * 100).toFixed(1)}%  posId=${positionId.slice(0, 10)}…  reason="${reason}"`);

  try {
    log('pnl', `${logTag}: pushing on-chain price for ${token}…`);
    await callSetPrice(tokenAddr, BigInt(Math.round(priceUsd * 1e10)));
    log('pnl', `${logTag}: price set — closing posId=${positionId.slice(0, 10)}…`);
    // Register before the tx so vault-listener stamps STOP_LOSS when it sees PositionClosed
    markStopLoss(positionId);
    await callClosePosition(positionId as `0x${string}`);
    log('pnl', `${logTag}: position closed ✓  posId=${positionId.slice(0, 10)}…`);
  } finally {
    closingSet.delete(positionId);
  }
}

async function triggerStopLoss(
  positionId: string,
  token:      string,
  follower:   string,
  pct:        number,
  priceUsd:   number
): Promise<void> {
  return triggerClose('STOP-LOSS', 'stop-loss', positionId, token, follower, pct, priceUsd, `drawdown exceeded ${(pct * 100).toFixed(1)}%`);
}

async function triggerAIRiskClose(
  positionId: string,
  token:      string,
  follower:   string,
  pct:        number,
  priceUsd:   number,
  reason:     string,
): Promise<void> {
  return triggerClose('AI-RISK', 'risk-agent', positionId, token, follower, pct, priceUsd, reason);
}

/** Polls open on-chain positions every 60s, updates token prices in DB,
 *  and triggers stop-loss auto-close when drawdown exceeds STOP_LOSS_PCT. */
export function startPnlUpdater(db: Db): () => void {
  log('pnl', `P&L updater started (60s interval, stop-loss: per-vault (env default: ${DEFAULT_STOP_LOSS_PCT}%))`);

  const timer = setInterval(async () => {
    try {
      // Fetch prices for all volatile tokens in one pass
      const [wmntPrice, onChainPositions] = await Promise.all([
        getCurrentWmntPrice(),
        db.getOpenOnChainPositions(),
      ]);
      log('pnl', `WMNT price: $${wmntPrice.toFixed(6)}`);
      await db.upsertTokenPrice('WMNT', wmntPrice);

      const priceOf = (token: string): number | null => {
        if (token === 'WMNT') return wmntPrice;
        if (token === 'USDe' || token === 'USDC' || token === 'USDT') return 1.0;
        return null;
      };

      // ── Legacy paper-trade P&L logging (unchanged) ────────────────────────
      const paperPositions = await db.getAllOpenPositions();
      if (paperPositions.length > 0) {
        log('pnl', `paper positions: ${paperPositions.length}`);
        for (const pos of paperPositions) {
          const price = priceOf(pos.token) ?? wmntPrice;
          const pct   = (price - pos.entryPrice) / pos.entryPrice;
          const pnl   = pos.usdcSpent * pct;
          const sign  = pnl >= 0 ? '+' : '';
          log('pnl', `[paper] follower=${pos.follower.slice(0, 10)}… ${pos.token}  entry=$${pos.entryPrice.toFixed(6)}  now=$${price.toFixed(6)}  unrealised=${sign}$${pnl.toFixed(4)} (${sign}${(pct * 100).toFixed(2)}%)`);
        }
      }

      // ── On-chain position P&L + stop-loss ────────────────────────────────
      if (onChainPositions.length === 0) {
        log('pnl', 'no open on-chain positions');
        return;
      }

      log('pnl', `on-chain positions: ${onChainPositions.length}`);
      const unknownPriceTokens = new Set<string>();
      for (const pos of onChainPositions) {
        const currentPrice = priceOf(pos.token);
        if (currentPrice === null) {
          unknownPriceTokens.add(pos.token);
          continue;
        }

        const pct  = (currentPrice - pos.entryPrice) / pos.entryPrice;
        const pnl  = pos.ausdcAllocated * pct;
        const sign = pnl >= 0 ? '+' : '';
        log('pnl', `[on-chain] follower=${pos.follower.slice(0, 10)}… ${pos.token}  entry=$${pos.entryPrice.toFixed(6)}  now=$${currentPrice.toFixed(6)}  unrealised=${sign}$${pnl.toFixed(4)} (${sign}${(pct * 100).toFixed(2)}%)`);

        if (Math.abs(pct) > 0.5) {
          warn('pnl', `large swing — follower=${pos.follower.slice(0, 10)}… ${(pct * 100).toFixed(1)}%`);
        }

        // ── Stop-loss (per-vault threshold from DB) — hard safety floor ────
        const stopLossThreshold = pos.stopLossPct / 100;
        if (pct < -stopLossThreshold) {
          if (closingSet.has(pos.onChainPositionId)) {
            log('pnl', `stop-loss already in progress for posId=${pos.onChainPositionId.slice(0, 10)}…`);
            continue;
          }
          closingSet.add(pos.onChainPositionId);
          // Run async — don't block the poll cycle
          triggerStopLoss(pos.onChainPositionId, pos.token, pos.follower, pct, currentPrice).catch((e) => {
            error('pnl', `stop-loss execution failed for posId=${pos.onChainPositionId.slice(0, 10)}…`, e);
            closingSet.delete(pos.onChainPositionId);
          });
          continue;
        }

        // ── AI risk-management agent — "watch zone" early closes ──────────
        // Past half the stop-loss threshold but not yet past it: ask the AI
        // risk agent whether to close early. No-ops if OPENAI_API_KEY unset.
        if (pct < -stopLossThreshold * 0.5) {
          if (closingSet.has(pos.onChainPositionId)) {
            log('pnl', `risk-agent: close already in progress for posId=${pos.onChainPositionId.slice(0, 10)}…`);
            continue;
          }
          const heldForMinutes = (Date.now() - pos.openedAt.getTime()) / 60_000;
          const assessment = await assessPositionRiskAI({
            token:          pos.token,
            entryPrice:     pos.entryPrice,
            currentPrice,
            pnlPct:         pct,
            riskLevel:      pos.riskLevel,
            stopLossPct:    pos.stopLossPct,
            heldForMinutes,
          });
          if (assessment) {
            log('pnl', `[risk-agent] follower=${pos.follower.slice(0, 10)}… posId=${pos.onChainPositionId.slice(0, 10)}… action=${assessment.action} — ${assessment.reason}`);
            if (assessment.action === 'close') {
              closingSet.add(pos.onChainPositionId);
              triggerAIRiskClose(pos.onChainPositionId, pos.token, pos.follower, pct, currentPrice, assessment.reason).catch((e) => {
                error('pnl', `risk-agent close failed for posId=${pos.onChainPositionId.slice(0, 10)}…`, e);
                closingSet.delete(pos.onChainPositionId);
              });
            }
          }
        }
      }

      if (unknownPriceTokens.size > 0) {
        log('pnl', `[on-chain] skipping positions with unknown price for: ${[...unknownPriceTokens].join(', ')}`);
      }
    } catch (e) {
      error('pnl', 'P&L update cycle failed', e);
    }
  }, 60_000);

  return () => clearInterval(timer);
}
