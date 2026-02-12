import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import JSZip from "jszip";

const DATA_API = "https://data-api.polymarket.com";
const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

export async function getCashBalance(address: string): Promise<number> {
  const res = await fetch(
    `${DATA_API}/v1/accounting/snapshot?user=${encodeURIComponent(address)}`
  );
  if (!res.ok) throw new Error(`Snapshot failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const equityFile = zip.file("equity.csv");
  if (!equityFile) return 0;
  const text = await equityFile.async("string");
  const lines = text.trim().split("\n");
  if (lines.length < 2) return 0;
  const headers = lines[0].split(",");
  const values = lines[1].split(",");
  const cashIdx = headers.indexOf("cashBalance");
  if (cashIdx < 0) return 0;
  return parseFloat(values[cashIdx] ?? "0") || 0;
}

export interface TradeActivity {
  type: string;
  timestamp: number;
  transactionHash: string;
  asset: string;
  side: string;
  price: number;
  size: number;
  title: string;
  outcome?: string;
}

export async function getTargetActivity(
  address: string,
  limit = 50
): Promise<TradeActivity[]> {
  const params = new URLSearchParams({
    user: address,
    type: "TRADE",
    limit: String(limit),
    sortBy: "TIMESTAMP",
    sortDirection: "DESC",
  });
  const res = await fetch(`${DATA_API}/activity?${params}`);
  if (!res.ok) throw new Error(`Activity failed: ${res.status}`);
  const data = (await res.json()) as TradeActivity[];
  return (Array.isArray(data) ? data : []).map((a) => ({
    ...a,
    price: parseFloat(String(a.price ?? 0)) || 0,
    timestamp: Number(a.timestamp) || 0,
  }));
}

export function computeBetSize(
  cashBalance: number,
  price: number,
  minPct: number,
  maxPct: number,
  minUsd: number
): number {
  const minFraction = minPct / 100;
  const maxFraction = maxPct / 100;
  const pct = minFraction + price * (maxFraction - minFraction);
  const amount = cashBalance * pct;
  return amount >= minUsd ? Math.max(amount, minUsd) : 0;
}

export interface CopiedTrade {
  title: string;
  outcome: string;
  side: string;
  amountUsd: number;
  price: number;
  asset: string;
  timestamp: number;
}

export interface CopyTradeResult {
  copied: number;
  failed: number;
  error?: string;
  lastTimestamp?: number;
  copiedKeys: string[];
  copiedTrades: CopiedTrade[];
}

export async function runCopyTrade(
  privateKey: string,
  myAddress: string,
  targetAddress: string,
  signatureType: number,
  config: { minPercent: number; maxPercent: number; minBetUsd: number },
  state: { lastTimestamp: number; copiedKeys: string[] }
): Promise<CopyTradeResult> {
  const result: CopyTradeResult = { copied: 0, failed: 0, copiedKeys: [], copiedTrades: [] };

  const signer = new Wallet(privateKey);
  const rawClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer);
  const creds = await rawClient.createOrDeriveApiKey();
  const client = new ClobClient(
    CLOB_HOST,
    CHAIN_ID,
    signer,
    creds,
    signatureType,
    myAddress
  );

  const cashBalance = await getCashBalance(myAddress);
  if (cashBalance < 1) {
    result.error = "Low balance";
    return result;
  }

  const activities = await getTargetActivity(targetAddress, 50);
  let lastTimestamp = state.lastTimestamp;
  const copiedSet = new Set(state.copiedKeys);
  const isFirstRun = lastTimestamp === 0 && copiedSet.size === 0;

  // On first run, only sync lastTimestamp—don't copy historical trades
  if (isFirstRun && activities.length > 0) {
    const tradeTs = activities
      .filter((a) => a.type === "TRADE")
      .map((a) => a.timestamp);
    if (tradeTs.length > 0) {
      result.lastTimestamp = Math.max(...tradeTs);
      result.copiedKeys = state.copiedKeys;
      return result;
    }
  }

  for (const act of activities) {
    if (act.type !== "TRADE") continue;
    const ts = act.timestamp;
    if (ts <= lastTimestamp) continue;

    const txHash = act.transactionHash ?? "";
    const asset = act.asset ?? "";
    const sideStr = (act.side ?? "BUY").toUpperCase();
    const price = act.price;

    if (!asset || price <= 0) continue;

    const key = `${txHash}|${asset}|${sideStr}`;
    if (copiedSet.has(key)) continue;

    const betUsd = computeBetSize(
      cashBalance,
      price,
      config.minPercent,
      config.maxPercent,
      config.minBetUsd
    );
    if (betUsd < config.minBetUsd) continue;

    const side = sideStr === "BUY" ? Side.BUY : Side.SELL;

    try {
      const resp = await client.createAndPostMarketOrder(
        {
          tokenID: asset,
          amount: betUsd,
          side,
          price,
          orderType: OrderType.FOK,
        },
        undefined,
        OrderType.FOK
      );

      if (resp?.success) {
        copiedSet.add(key);
        lastTimestamp = Math.max(lastTimestamp ?? 0, ts);
        result.copied++;
        result.copiedTrades.push({
          title: act.title ?? "Unknown",
          outcome: act.outcome ?? (sideStr === "BUY" ? "Yes" : "No"),
          side: sideStr,
          amountUsd: betUsd,
          price,
          asset,
          timestamp: Date.now(),
        });
      } else {
        result.failed++;
      }
    } catch (e) {
      result.failed++;
      console.error("Copy trade error:", e);
    }
  }

  if (activities.length > 0) {
    const tradeTs = activities
      .filter((a) => a.type === "TRADE")
      .map((a) => a.timestamp);
    if (tradeTs.length > 0 && lastTimestamp === state.lastTimestamp) {
      lastTimestamp = Math.max(...tradeTs);
    }
  }

  result.lastTimestamp = lastTimestamp;
  result.copiedKeys = Array.from(copiedSet);
  return result;
}

export async function sellPosition(
  privateKey: string,
  myAddress: string,
  signatureType: number,
  asset: string,
  sizeShares: number,
  price: number
): Promise<{ success: boolean; error?: string }> {
  const signer = new Wallet(privateKey);
  const rawClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer);
  const creds = await rawClient.createOrDeriveApiKey();
  const client = new ClobClient(
    CLOB_HOST,
    CHAIN_ID,
    signer,
    creds,
    signatureType,
    myAddress
  );

  try {
    const resp = await client.createAndPostMarketOrder(
      {
        tokenID: asset,
        amount: sizeShares,
        side: Side.SELL,
        price: Math.max(0.01, Math.min(0.99, price)),
        orderType: OrderType.FOK,
      },
      undefined,
      OrderType.FOK
    );
    return { success: !!resp?.success, error: resp?.errorMsg };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { success: false, error: err };
  }
}
