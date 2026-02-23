import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import { getCashBalance, type CopiedTrade } from "@/lib/copy-trade";

const DATA_API = "https://data-api.polymarket.com";
const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;
const POLYMARKET_MIN_ORDER_USD = 1;

type TradingMode = "off" | "paper" | "live";

interface GlobalTrade {
  conditionId: string;
  title?: string;
  slug?: string;
  asset: string;
  outcome: string;
  price: number | string;
  timestamp: number | string;
}

interface OutcomeSnapshot {
  asset: string;
  outcome: string;
  price: number;
  timestamp: number;
}

interface PairSignal {
  conditionId: string;
  title: string;
  slug?: string;
  coin: "BTC" | "ETH";
  cadence: "5m" | "15m" | "hourly" | "other";
  latestTimestamp: number;
  pairSum: number;
  edge: number;
  outcomes: [OutcomeSnapshot, OutcomeSnapshot];
}

interface TradeConditionSnapshot {
  latestTimestamp: number;
  byOutcome: Map<string, OutcomeSnapshot>;
}

interface ClobMarketToken {
  token_id?: string;
  outcome?: string;
  price?: number | string;
}

interface ClobMarket {
  question?: string;
  market_slug?: string;
  active?: boolean;
  closed?: boolean;
  accepting_orders?: boolean;
  enable_order_book?: boolean;
  tokens?: ClobMarketToken[];
}

interface SignalBuildResult {
  signals: PairSignal[];
  diagnostics: Record<string, number>;
}

export interface PairedStrategyResult {
  copied: number;
  failed: number;
  paper: number;
  simulatedVolumeUsd: number;
  mode: TradingMode;
  budgetCapUsd: number;
  budgetUsedUsd: number;
  evaluatedSignals: number;
  eligibleSignals: number;
  rejectedReasons: Record<string, number>;
  error?: string;
  lastTimestamp?: number;
  copiedKeys: string[];
  copiedTrades: CopiedTrade[];
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bumpReason(map: Record<string, number>, reason: string) {
  map[reason] = (map[reason] ?? 0) + 1;
}

function detectUpDownIdentity(
  question: string,
  slug?: string
): { coin: "BTC" | "ETH"; cadence: "5m" | "15m" | "hourly" | "other" } | null {
  const q = question.toLowerCase();
  const s = String(slug ?? "").toLowerCase();
  const hay = `${q} ${s}`;

  let coin: "BTC" | "ETH" | null = null;
  if (
    hay.includes("bitcoin up or down") ||
    hay.includes("btc up or down") ||
    hay.includes("bitcoin-up-or-down") ||
    hay.includes("btc-updown")
  ) {
    coin = "BTC";
  } else if (
    hay.includes("ethereum up or down") ||
    hay.includes("eth up or down") ||
    hay.includes("ethereum-up-or-down") ||
    hay.includes("eth-updown")
  ) {
    coin = "ETH";
  }
  if (!coin) return null;

  let cadence: "5m" | "15m" | "hourly" | "other" = "other";
  if (s.includes("updown-5m")) cadence = "5m";
  else if (s.includes("updown-15m")) cadence = "15m";
  else if (
    s.includes("up-or-down") &&
    /(?:\d{1,2}(?:am|pm)-et)\b/.test(s) &&
    !s.includes("updown-5m") &&
    !s.includes("updown-15m")
  ) {
    cadence = "hourly";
  }

  return { coin, cadence };
}

const MARKET_CACHE_TTL_MS = 60_000;
const marketCache = new Map<string, { fetchedAt: number; market: ClobMarket | null }>();

async function getMarketCached(client: ClobClient, conditionId: string): Promise<ClobMarket | null> {
  const now = Date.now();
  const cached = marketCache.get(conditionId);
  if (cached && now - cached.fetchedAt < MARKET_CACHE_TTL_MS) {
    return cached.market;
  }
  try {
    const market = (await client.getMarket(conditionId)) as ClobMarket;
    marketCache.set(conditionId, { fetchedAt: now, market });
    return market;
  } catch {
    marketCache.set(conditionId, { fetchedAt: now, market: null });
    return null;
  }
}

function isCadenceEnabled(
  cadence: "5m" | "15m" | "hourly" | "other",
  toggles: { cadence5m: boolean; cadence15m: boolean; cadenceHourly: boolean }
): boolean {
  if (cadence === "5m") return toggles.cadence5m;
  if (cadence === "15m") return toggles.cadence15m;
  if (cadence === "hourly") return toggles.cadenceHourly;
  return false;
}

async function getRecentPairSignals(params: {
  lookbackSeconds: number;
  includeBtc: boolean;
  includeEth: boolean;
  cadence5m: boolean;
  cadence15m: boolean;
  cadenceHourly: boolean;
  tradeLimit?: number;
  maxConditionsToInspect?: number;
}): Promise<SignalBuildResult> {
  const {
    lookbackSeconds,
    includeBtc,
    includeEth,
    cadence5m,
    cadence15m,
    cadenceHourly,
    tradeLimit = 1000,
    maxConditionsToInspect = 120,
  } = params;
  const nowSec = Math.floor(Date.now() / 1000);
  const res = await fetch(`${DATA_API}/trades?limit=${tradeLimit}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Trades fetch failed: ${res.status}`);
  const trades = (await res.json()) as GlobalTrade[];
  const grouped = new Map<string, TradeConditionSnapshot>();
  const diagnostics: Record<string, number> = {};

  for (const t of Array.isArray(trades) ? trades : []) {
    const conditionId = String(t.conditionId ?? "");
    if (!conditionId) continue;
    const ts = toNum(t.timestamp);
    if (!ts || nowSec - ts > lookbackSeconds) continue;
    const price = toNum(t.price);
    if (price <= 0 || price >= 1) continue;
    const outcome = String(t.outcome ?? "");
    const asset = String(t.asset ?? "");
    if (!outcome || !asset) continue;

    const bucket = grouped.get(conditionId) ?? { latestTimestamp: 0, byOutcome: new Map<string, OutcomeSnapshot>() };
    const current = bucket.byOutcome.get(outcome);
    if (!current || ts > current.timestamp) {
      bucket.byOutcome.set(outcome, {
        asset,
        outcome,
        price,
        timestamp: ts,
      });
    }
    bucket.latestTimestamp = Math.max(bucket.latestTimestamp, ts);
    grouped.set(conditionId, bucket);
  }

  const marketClient = new ClobClient(CLOB_HOST, CHAIN_ID);
  const conditionIds = Array.from(grouped.entries())
    .sort((a, b) => b[1].latestTimestamp - a[1].latestTimestamp)
    .map(([conditionId]) => conditionId)
    .slice(0, maxConditionsToInspect);
  const marketsByCondition = new Map<string, ClobMarket | null>();
  const LOOKUP_BATCH_SIZE = 15;
  for (let i = 0; i < conditionIds.length; i += LOOKUP_BATCH_SIZE) {
    const batchIds = conditionIds.slice(i, i + LOOKUP_BATCH_SIZE);
    const batchMarkets = await Promise.all(batchIds.map((conditionId) => getMarketCached(marketClient, conditionId)));
    batchIds.forEach((conditionId, idx) => {
      marketsByCondition.set(conditionId, batchMarkets[idx] ?? null);
    });
  }

  const signals: PairSignal[] = [];
  for (const conditionId of conditionIds) {
    const groupedSnapshot = grouped.get(conditionId);
    if (!groupedSnapshot) continue;
    if (groupedSnapshot.byOutcome.size < 2) {
      bumpReason(diagnostics, "missing_two_outcomes");
      continue;
    }

    const market = marketsByCondition.get(conditionId) ?? null;
    if (!market) {
      bumpReason(diagnostics, "market_lookup_failed");
      continue;
    }
    if (market.closed) {
      bumpReason(diagnostics, "market_closed");
      continue;
    }
    if (!market.active) {
      bumpReason(diagnostics, "market_inactive");
      continue;
    }
    if (!market.accepting_orders) {
      bumpReason(diagnostics, "market_not_accepting_orders");
      continue;
    }
    if (!market.enable_order_book) {
      bumpReason(diagnostics, "market_orderbook_disabled");
      continue;
    }
    const title = String(market.question ?? "");
    const slug = String(market.market_slug ?? "");
    const identity = detectUpDownIdentity(title, slug);
    if (!identity) {
      bumpReason(diagnostics, "market_not_btc_eth_updown");
      continue;
    }
    if ((identity.coin === "BTC" && !includeBtc) || (identity.coin === "ETH" && !includeEth)) {
      bumpReason(diagnostics, "coin_disabled");
      continue;
    }
    if (!isCadenceEnabled(identity.cadence, { cadence5m, cadence15m, cadenceHourly })) {
      bumpReason(diagnostics, "cadence_disabled");
      continue;
    }

    const tokens = Array.isArray(market.tokens) ? market.tokens.slice(0, 2) : [];
    if (tokens.length < 2) {
      bumpReason(diagnostics, "market_missing_tokens");
      continue;
    }

    const resolvedOutcomes = tokens
      .map((token) => {
        const outcome = String(token.outcome ?? "");
        const tokenId = String(token.token_id ?? "");
        const snapshot = groupedSnapshot.byOutcome.get(outcome);
        const price = snapshot?.price ?? toNum(token.price);
        const timestamp = snapshot?.timestamp ?? groupedSnapshot.latestTimestamp;
        if (!outcome || !tokenId || price <= 0 || price >= 1) return null;
        return {
          asset: tokenId,
          outcome,
          price,
          timestamp,
        } as OutcomeSnapshot;
      })
      .filter(Boolean) as OutcomeSnapshot[];

    if (resolvedOutcomes.length < 2) {
      bumpReason(diagnostics, "missing_valid_token_snapshot");
      continue;
    }
    const [first, second] = resolvedOutcomes as [OutcomeSnapshot, OutcomeSnapshot];
    if (first.asset === second.asset) {
      bumpReason(diagnostics, "duplicate_token_assets");
      continue;
    }

    const outcomes: [OutcomeSnapshot, OutcomeSnapshot] = [first, second];
    const pairSum = outcomes[0].price + outcomes[1].price;
    const edge = 1 - pairSum;
    signals.push({
      conditionId,
      title,
      slug,
      coin: identity.coin,
      cadence: identity.cadence,
      latestTimestamp: Math.max(outcomes[0].timestamp, outcomes[1].timestamp),
      pairSum,
      edge,
      outcomes,
    });
  }

  return {
    diagnostics,
    signals: signals.sort((a, b) => {
      if (b.edge !== a.edge) return b.edge - a.edge;
      return b.latestTimestamp - a.latestTimestamp;
    }),
  };
}

export async function runPairedStrategy(
  privateKey: string,
  myAddress: string,
  signatureType: number,
  config: {
    mode: TradingMode;
    walletUsagePercent: number;
    pairChunkUsd: number;
    minBetUsd: number;
    stopLossBalance: number;
    floorToPolymarketMin: boolean;
    pairMinEdgeCents: number;
    pairLookbackSeconds: number;
    pairMaxMarketsPerRun: number;
    enableBtc: boolean;
    enableEth: boolean;
    enableCadence5m: boolean;
    enableCadence15m: boolean;
    enableCadenceHourly: boolean;
  },
  state: { lastTimestamp: number; copiedKeys: string[] }
): Promise<PairedStrategyResult> {
  const mode = config.mode;
  const result: PairedStrategyResult = {
    copied: 0,
    failed: 0,
    paper: 0,
    simulatedVolumeUsd: 0,
    mode,
    budgetCapUsd: 0,
    budgetUsedUsd: 0,
    evaluatedSignals: 0,
    eligibleSignals: 0,
    rejectedReasons: {},
    copiedKeys: [],
    copiedTrades: [],
  };
  const reject = (reason: string) => {
    result.rejectedReasons[reason] = (result.rejectedReasons[reason] ?? 0) + 1;
  };
  if (mode === "off") {
    result.error = "Trading mode is off";
    return result;
  }

  const cashBalance = await getCashBalance(myAddress);
  const walletUsagePercent = Math.max(1, Math.min(100, Number(config.walletUsagePercent) || 100));
  const runBudgetCapUsd = (cashBalance * walletUsagePercent) / 100;
  let remainingBudgetUsd = runBudgetCapUsd;
  result.budgetCapUsd = runBudgetCapUsd;

  if (mode === "live" && cashBalance < 1) {
    result.error = "Low balance";
    return result;
  }
  if (mode === "live" && config.stopLossBalance > 0 && cashBalance < config.stopLossBalance) {
    result.error = `Stop-loss: balance $${cashBalance.toFixed(2)} below threshold $${config.stopLossBalance}`;
    return result;
  }
  if (mode === "live" && runBudgetCapUsd < POLYMARKET_MIN_ORDER_USD * 2) {
    result.error = `Wallet usage cap too low: ${walletUsagePercent.toFixed(1)}% of $${cashBalance.toFixed(2)} is $${runBudgetCapUsd.toFixed(2)} (< $2 for paired leg minimums)`;
    return result;
  }

  const minEdge = Math.max(0, Number(config.pairMinEdgeCents) || 0) / 100;
  const lookbackSeconds = Math.max(20, Number(config.pairLookbackSeconds) || 120);
  const maxMarketsPerRun = Math.max(1, Math.min(20, Number(config.pairMaxMarketsPerRun) || 4));
  const pairChunkUsd = Math.max(1, Number(config.pairChunkUsd) || 3);
  const minLegUsd = Math.max(0.1, Number(config.minBetUsd) || 0.1);
  const includeBtc = config.enableBtc !== false;
  const includeEth = config.enableEth !== false;
  const cadence5m = config.enableCadence5m !== false;
  const cadence15m = config.enableCadence15m !== false;
  const cadenceHourly = config.enableCadenceHourly !== false;

  if (!includeBtc && !includeEth) {
    result.error = "Both BTC and ETH are disabled";
    reject("all_coins_disabled");
    return result;
  }
  if (!cadence5m && !cadence15m && !cadenceHourly) {
    result.error = "All cadences are disabled";
    reject("all_cadences_disabled");
    return result;
  }

  const signalBuild = await getRecentPairSignals({
    lookbackSeconds,
    includeBtc,
    includeEth,
    cadence5m,
    cadence15m,
    cadenceHourly,
  });
  for (const [reason, count] of Object.entries(signalBuild.diagnostics)) {
    result.rejectedReasons[reason] = (result.rejectedReasons[reason] ?? 0) + count;
  }
  const signals = signalBuild.signals;
  result.evaluatedSignals = signals.length;
  if (result.evaluatedSignals === 0) {
    reject("no_recent_signals");
  }

  const copiedSet = new Set(state.copiedKeys);
  let client: ClobClient | null = null;
  if (mode === "live") {
    const signer = new Wallet(privateKey);
    const rawClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer);
    const creds = await rawClient.createOrDeriveApiKey();
    client = new ClobClient(
      CLOB_HOST,
      CHAIN_ID,
      signer,
      creds,
      signatureType,
      myAddress
    );
  }

  let lastTimestamp = state.lastTimestamp;

  for (const signal of signals) {
    if (result.eligibleSignals >= maxMarketsPerRun) {
      reject("max_markets_per_run_reached");
      break;
    }
    if (remainingBudgetUsd < (mode === "live" ? 2 : 0.2)) {
      reject("insufficient_remaining_budget");
      break;
    }
    if (signal.edge < minEdge) {
      reject("edge_below_threshold");
      continue;
    }
    if (signal.latestTimestamp <= state.lastTimestamp) {
      reject("signal_not_new");
      continue;
    }

    const signalKey = `${signal.conditionId}|${signal.latestTimestamp}`;
    if (copiedSet.has(signalKey)) {
      reject("already_processed_signal");
      continue;
    }

    const [outcomeA, outcomeB] = signal.outcomes;
    const pairSum = signal.pairSum;
    if (pairSum <= 0 || pairSum >= 2) {
      reject("invalid_pair_sum");
      continue;
    }

    let pairSpend = Math.min(pairChunkUsd, remainingBudgetUsd);
    if (pairSpend <= 0) {
      reject("pair_spend_non_positive");
      continue;
    }
    const shares = pairSpend / pairSum;
    let legAUsd = shares * outcomeA.price;
    let legBUsd = shares * outcomeB.price;

    if (legAUsd < minLegUsd || legBUsd < minLegUsd) {
      reject("leg_below_min_bet");
      continue;
    }
    if (mode === "live") {
      if (legAUsd < POLYMARKET_MIN_ORDER_USD || legBUsd < POLYMARKET_MIN_ORDER_USD) {
        if (!config.floorToPolymarketMin) {
          reject("leg_below_polymarket_min_no_floor");
          continue;
        }
        legAUsd = Math.max(POLYMARKET_MIN_ORDER_USD, legAUsd);
        legBUsd = Math.max(POLYMARKET_MIN_ORDER_USD, legBUsd);
      }
      pairSpend = legAUsd + legBUsd;
      if (pairSpend > remainingBudgetUsd) {
        reject("pair_exceeds_remaining_budget");
        continue;
      }
    }

    result.eligibleSignals++;

    if (mode === "paper") {
      copiedSet.add(signalKey);
      result.copied++;
      result.paper++;
      result.simulatedVolumeUsd += legAUsd + legBUsd;
      remainingBudgetUsd = Math.max(0, remainingBudgetUsd - (legAUsd + legBUsd));
      lastTimestamp = Math.max(lastTimestamp ?? 0, signal.latestTimestamp);
      result.copiedTrades.push({
        title: signal.title,
        outcome: outcomeA.outcome,
        side: `PAPER BUY (${signal.coin} pair)`,
        amountUsd: legAUsd,
        price: outcomeA.price,
        asset: outcomeA.asset,
        timestamp: Date.now(),
      });
      result.copiedTrades.push({
        title: signal.title,
        outcome: outcomeB.outcome,
        side: `PAPER BUY (${signal.coin} pair)`,
        amountUsd: legBUsd,
        price: outcomeB.price,
        asset: outcomeB.asset,
        timestamp: Date.now(),
      });
      continue;
    }

    try {
      if (!client) throw new Error("Missing CLOB client in live mode");
      const respA = await client.createAndPostMarketOrder(
        {
          tokenID: outcomeA.asset,
          amount: legAUsd,
          side: Side.BUY,
          orderType: OrderType.FOK,
          price: Math.max(0.001, Math.min(0.999, outcomeA.price)),
        },
        undefined,
        OrderType.FOK
      );
      const respB = await client.createAndPostMarketOrder(
        {
          tokenID: outcomeB.asset,
          amount: legBUsd,
          side: Side.BUY,
          orderType: OrderType.FOK,
          price: Math.max(0.001, Math.min(0.999, outcomeB.price)),
        },
        undefined,
        OrderType.FOK
      );
      const okA = !!respA?.success;
      const okB = !!respB?.success;
      if (okA && okB) {
        copiedSet.add(signalKey);
        result.copied++;
        remainingBudgetUsd = Math.max(0, remainingBudgetUsd - (legAUsd + legBUsd));
        lastTimestamp = Math.max(lastTimestamp ?? 0, signal.latestTimestamp);
        result.copiedTrades.push({
          title: signal.title,
          outcome: outcomeA.outcome,
          side: `BUY (${signal.coin} pair)`,
          amountUsd: legAUsd,
          price: outcomeA.price,
          asset: outcomeA.asset,
          timestamp: Date.now(),
        });
        result.copiedTrades.push({
          title: signal.title,
          outcome: outcomeB.outcome,
          side: `BUY (${signal.coin} pair)`,
          amountUsd: legBUsd,
          price: outcomeB.price,
          asset: outcomeB.asset,
          timestamp: Date.now(),
        });
      } else {
        result.failed++;
        reject("live_order_rejected");
        const errorA = respA?.errorMsg ?? "legA failed";
        const errorB = respB?.errorMsg ?? "legB failed";
        const next = result.error
          ? `${result.error}; ${errorA}; ${errorB}`
          : `${errorA}; ${errorB}`;
        result.error = next.length > 500 ? `${next.slice(0, 497)}...` : next;
      }
    } catch (e) {
      result.failed++;
      reject("live_order_exception");
      const errStr = e instanceof Error ? e.message : String(e);
      const next = result.error ? `${result.error}; ${errStr}` : errStr;
      result.error = next.length > 500 ? `${next.slice(0, 497)}...` : next;
    }
  }

  result.lastTimestamp = lastTimestamp;
  result.copiedKeys = Array.from(copiedSet).slice(-5000);
  result.budgetUsedUsd = Math.max(0, result.budgetCapUsd - remainingBudgetUsd);
  return result;
}
