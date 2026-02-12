const DATA_API = "https://data-api.polymarket.com";

export interface Position {
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  curPrice: number;
  title: string;
  slug: string;
  icon?: string;
  outcome: string;
  oppositeOutcome: string;
  redeemable: boolean;
  mergeable: boolean;
  endDate?: string;
}

export async function getPositions(address: string, limit = 50): Promise<Position[]> {
  const params = new URLSearchParams({
    user: address,
    limit: String(limit),
    sortBy: "TOKENS",
    sortDirection: "DESC",
  });
  const res = await fetch(`${DATA_API}/positions?${params}`);
  if (!res.ok) throw new Error(`Positions failed: ${res.status}`);
  const data = (await res.json()) as Position[];
  return Array.isArray(data) ? data : [];
}
