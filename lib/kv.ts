import { kv } from "@vercel/kv";

const CONFIG_KEY = "copy_trader_config";
const STATE_KEY = "copy_trader_state";
const ACTIVITY_KEY = "copy_trader_activity";

export type TradingMode = "off" | "paper" | "live";

export interface CopyTraderConfig {
  /** Legacy toggle; derived from mode (mode !== "off") */
  enabled: boolean;
  /** Trading mode: off (paused), paper (simulate), live (place real orders) */
  mode: TradingMode;
  /** Max % of wallet balance this bot can allocate per run */
  walletUsagePercent: number;
  /** Copy at this % of target's bet (default 5) */
  copyPercent: number;
  /** Max USDC per bet (default 3) */
  maxBetUsd: number;
  /** Min bet to place - skip if below (default 0.10) */
  minBetUsd: number;
  /** Stop copying when cash balance falls below this (0 = disabled) */
  stopLossBalance: number;
  /** When true, round bets below $1 up to $1 (Polymarket min) to copy smaller target bets (default true) */
  floorToPolymarketMin: boolean;
}

export interface CopyTraderState {
  lastTimestamp: number;
  copiedKeys: string[];
  lastRunAt?: number;
  lastCopiedAt?: number;
  lastError?: string;
  /** Incremented each copy-trade run; claim runs when this reaches CLAIM_EVERY_N_RUNS */
  runsSinceLastClaim?: number;
  lastClaimAt?: number;
  lastClaimResult?: { claimed: number; failed: number };
}

export interface RecentActivity {
  title: string;
  outcome: string;
  side: string;
  amountUsd: number;
  price: number;
  timestamp: number;
}

const DEFAULT_CONFIG: CopyTraderConfig = {
  enabled: false,
  mode: "off",
  walletUsagePercent: 25,
  copyPercent: 5,
  maxBetUsd: 3,
  minBetUsd: 0.1,
  stopLossBalance: 0,
  floorToPolymarketMin: true,
};

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeMode(value: unknown): TradingMode | undefined {
  if (value === "off" || value === "paper" || value === "live") return value;
  return undefined;
}

function sanitizeConfig(
  raw: Partial<CopyTraderConfig> & Record<string, unknown>,
  current: CopyTraderConfig
): CopyTraderConfig {
  let mode = normalizeMode(raw.mode) ?? current.mode;
  if (raw.enabled !== undefined && raw.mode === undefined) {
    mode = Boolean(raw.enabled) ? (current.mode === "off" ? "live" : current.mode) : "off";
  }

  return {
    enabled: mode !== "off",
    mode,
    walletUsagePercent: clamp(
      toFiniteNumber(raw.walletUsagePercent, current.walletUsagePercent),
      1,
      100
    ),
    copyPercent: clamp(toFiniteNumber(raw.copyPercent, current.copyPercent), 1, 100),
    maxBetUsd: clamp(toFiniteNumber(raw.maxBetUsd, current.maxBetUsd), 1, 10000),
    minBetUsd: clamp(toFiniteNumber(raw.minBetUsd, current.minBetUsd), 0.1, 10000),
    stopLossBalance: clamp(
      toFiniteNumber(raw.stopLossBalance, current.stopLossBalance),
      0,
      10000000
    ),
    floorToPolymarketMin: raw.floorToPolymarketMin !== false,
  };
}

export async function getConfig(): Promise<CopyTraderConfig> {
  const c = await kv.get<Record<string, unknown>>(CONFIG_KEY);
  if (!c) return { ...DEFAULT_CONFIG };

  // Migration path for older config keys.
  const legacyMode =
    normalizeMode(c.mode) ??
    normalizeMode(c.tradingMode) ??
    normalizeMode(c.operatingMode);
  const legacyEnabled =
    c.enabled == null ? undefined : Boolean(c.enabled ?? DEFAULT_CONFIG.enabled);
  const mode = legacyMode ?? (legacyEnabled ? "live" : "off");

  const migratedRaw: Record<string, unknown> = {
    ...c,
    mode,
    enabled: mode !== "off",
    walletUsagePercent:
      c.walletUsagePercent ?? c.walletPercent ?? DEFAULT_CONFIG.walletUsagePercent,
    copyPercent: c.copyPercent ?? c.minPercent ?? DEFAULT_CONFIG.copyPercent,
    maxBetUsd: c.maxBetUsd ?? c.minBetUsd ?? DEFAULT_CONFIG.maxBetUsd,
    minBetUsd: c.minBetUsd ?? DEFAULT_CONFIG.minBetUsd,
    stopLossBalance: c.stopLossBalance ?? DEFAULT_CONFIG.stopLossBalance,
    floorToPolymarketMin: c.floorToPolymarketMin,
  };

  return sanitizeConfig(
    migratedRaw as Partial<CopyTraderConfig> & Record<string, unknown>,
    { ...DEFAULT_CONFIG }
  );
}

export async function setConfig(config: Partial<CopyTraderConfig>): Promise<CopyTraderConfig> {
  const current = await getConfig();
  const updated = sanitizeConfig({ ...current, ...config }, current);
  await kv.set(CONFIG_KEY, updated);
  return updated;
}

export async function getState(): Promise<CopyTraderState> {
  const s = await kv.get<CopyTraderState>(STATE_KEY);
  return s
    ? {
        lastTimestamp: s.lastTimestamp ?? 0,
        copiedKeys: s.copiedKeys ?? [],
        lastRunAt: s.lastRunAt,
        lastCopiedAt: s.lastCopiedAt,
        lastError: s.lastError,
        runsSinceLastClaim: s.runsSinceLastClaim ?? 0,
        lastClaimAt: s.lastClaimAt,
        lastClaimResult: s.lastClaimResult,
      }
    : { lastTimestamp: 0, copiedKeys: [] };
}

export async function setState(state: Partial<CopyTraderState>): Promise<void> {
  const current = await getState();
  const updated = { ...current, ...state };
  await kv.set(STATE_KEY, updated);
}

export async function resetSyncState(): Promise<void> {
  await kv.set(STATE_KEY, { lastTimestamp: 0, copiedKeys: [] });
}

export async function getRecentActivity(): Promise<RecentActivity[]> {
  const a = await kv.get<RecentActivity[]>(ACTIVITY_KEY);
  return Array.isArray(a) ? a : [];
}

export async function appendActivity(trades: RecentActivity[]): Promise<void> {
  if (trades.length === 0) return;
  const current = await getRecentActivity();
  const updated = [...trades, ...current].slice(0, 50);
  await kv.set(ACTIVITY_KEY, updated);
}
