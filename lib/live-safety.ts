import { sellPosition } from "@/lib/copy-trade";
import { getPositions } from "@/lib/polymarket";
import type { DailyRiskState, SafetyLatchState } from "@/lib/kv";

export function utcDayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function initDailyRiskState(
  current: DailyRiskState | undefined,
  cashBalance: number,
  now = Date.now()
): DailyRiskState {
  const dayKey = utcDayKey(now);
  if (!current || current.dayKey !== dayKey) {
    return {
      dayKey,
      dayStartBalanceUsd: Math.max(0, Number(cashBalance) || 0),
      liveNotionalUsd: 0,
      liveRuns: 0,
      lastRunAt: undefined,
      alertedDrawdownCap: false,
      alertedNotionalCap: false,
    };
  }
  return {
    dayKey: current.dayKey,
    dayStartBalanceUsd: Math.max(0, Number(current.dayStartBalanceUsd) || 0),
    liveNotionalUsd: Math.max(0, Number(current.liveNotionalUsd) || 0),
    liveRuns: Math.max(0, Math.floor(Number(current.liveRuns) || 0)),
    lastRunAt: current.lastRunAt,
    alertedDrawdownCap: current.alertedDrawdownCap === true,
    alertedNotionalCap: current.alertedNotionalCap === true,
  };
}

export function applyDailyLiveRun(
  dailyRisk: DailyRiskState,
  budgetUsedUsd: number,
  now = Date.now()
): DailyRiskState {
  return {
    ...dailyRisk,
    liveNotionalUsd: Math.max(0, dailyRisk.liveNotionalUsd + Math.max(0, Number(budgetUsedUsd) || 0)),
    liveRuns: dailyRisk.liveRuns + 1,
    lastRunAt: now,
  };
}

export function evaluateDailyRiskCaps(params: {
  dailyRisk: DailyRiskState;
  cashBalance: number;
  maxDailyLiveNotionalUsd: number;
  maxDailyDrawdownUsd: number;
}): {
  blocked: boolean;
  reason?: "daily_notional_cap" | "daily_drawdown_cap";
  message?: string;
  drawdownUsd: number;
  shouldAlert: boolean;
  dailyRisk: DailyRiskState;
} {
  const { dailyRisk, cashBalance, maxDailyLiveNotionalUsd, maxDailyDrawdownUsd } = params;
  const drawdownUsd = Math.max(0, dailyRisk.dayStartBalanceUsd - Math.max(0, Number(cashBalance) || 0));
  let next = { ...dailyRisk };

  if (maxDailyLiveNotionalUsd > 0 && dailyRisk.liveNotionalUsd >= maxDailyLiveNotionalUsd) {
    const shouldAlert = !dailyRisk.alertedNotionalCap;
    next = { ...next, alertedNotionalCap: true };
    return {
      blocked: true,
      reason: "daily_notional_cap",
      message: `Daily live notional cap reached: $${dailyRisk.liveNotionalUsd.toFixed(2)} / $${maxDailyLiveNotionalUsd.toFixed(2)}`,
      drawdownUsd,
      shouldAlert,
      dailyRisk: next,
    };
  }

  if (maxDailyDrawdownUsd > 0 && drawdownUsd >= maxDailyDrawdownUsd) {
    const shouldAlert = !dailyRisk.alertedDrawdownCap;
    next = { ...next, alertedDrawdownCap: true };
    return {
      blocked: true,
      reason: "daily_drawdown_cap",
      message: `Daily drawdown cap reached: $${drawdownUsd.toFixed(2)} / $${maxDailyDrawdownUsd.toFixed(2)}`,
      drawdownUsd,
      shouldAlert,
      dailyRisk: next,
    };
  }

  return {
    blocked: false,
    drawdownUsd,
    shouldAlert: false,
    dailyRisk: next,
  };
}

export function shouldSendLatchAlert(
  latch: SafetyLatchState | undefined,
  now = Date.now(),
  cooldownMs = 15 * 60 * 1000
): boolean {
  if (!latch) return true;
  if (!latch.lastAlertAt) return true;
  return now - latch.lastAlertAt >= cooldownMs;
}

export async function attemptResolveSafetyLatch(params: {
  latch: SafetyLatchState;
  privateKey: string;
  myAddress: string;
  signatureType: number;
  unwindSellSlippageCents: number;
  unwindShareBufferPct: number;
}): Promise<{
  resolved: boolean;
  attemptedAssets: string[];
  resolvedAssets: string[];
  failedAssets: string[];
  remainingAssets: string[];
  message: string;
}> {
  const assets = Array.from(
    new Set((params.latch.unresolvedAssets ?? []).map((a) => String(a ?? "").trim()).filter(Boolean))
  );
  if (assets.length === 0) {
    return {
      resolved: true,
      attemptedAssets: [],
      resolvedAssets: [],
      failedAssets: [],
      remainingAssets: [],
      message: "Safety latch had no tracked unresolved assets",
    };
  }

  try {
    const positions = await getPositions(params.myAddress, 200);
    const slippage = Math.max(0, Math.min(20, Number(params.unwindSellSlippageCents) || 0)) / 100;
    const buffer = Math.max(0.5, Math.min(1, (Number(params.unwindShareBufferPct) || 100) / 100));
    const attemptedAssets: string[] = [];
    const resolvedAssets: string[] = [];
    const failedAssets: string[] = [];

    for (const asset of assets) {
      const pos = positions.find((p) => !p.redeemable && p.asset === asset && Number(p.size) > 0);
      if (!pos) {
        resolvedAssets.push(asset);
        continue;
      }
      attemptedAssets.push(asset);
      const sellSize = Math.max(0.1, Number(pos.size) * buffer);
      const rawPrice = Number(pos.curPrice) > 0 ? Number(pos.curPrice) : 0.5;
      const sellPrice = Math.max(0.01, Math.min(0.99, rawPrice - slippage));
      const sell = await sellPosition(
        params.privateKey,
        params.myAddress,
        params.signatureType,
        asset,
        sellSize,
        sellPrice
      );
      if (sell.success) {
        resolvedAssets.push(asset);
      } else {
        failedAssets.push(asset);
      }
    }

    const resolved = failedAssets.length === 0;
    const message = resolved
      ? `Safety latch preflight resolved (${resolvedAssets.length}/${assets.length} assets)`
      : `Safety latch preflight still blocked: ${failedAssets.length} unresolved asset(s)`;
    return {
      resolved,
      attemptedAssets,
      resolvedAssets,
      failedAssets,
      remainingAssets: failedAssets,
      message,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      resolved: false,
      attemptedAssets: [],
      resolvedAssets: [],
      failedAssets: assets,
      remainingAssets: assets,
      message: `Safety latch preflight failed: ${msg}`,
    };
  }
}
