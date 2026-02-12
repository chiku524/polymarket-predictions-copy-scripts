"use client";

import { useEffect, useState } from "react";

interface Config {
  enabled: boolean;
  minPercent: number;
  maxPercent: number;
  minBetUsd: number;
}

interface Status {
  config: Config;
  state: {
    lastTimestamp: number;
    lastRunAt?: number;
    lastCopiedAt?: number;
    lastError?: string;
  };
  cashBalance: number;
  recentActivity: { title: string; outcome: string; side: string; amountUsd: number; price: number; timestamp: number }[];
}

interface Position {
  asset: string;
  title: string;
  outcome: string;
  size: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  curPrice: number;
  icon?: string;
  slug: string;
  eventSlug: string;
  redeemable: boolean;
}

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [cashingOut, setCashingOut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    try {
      const [statusRes, positionsRes] = await Promise.all([
        fetch("/api/status"),
        fetch("/api/positions"),
      ]);
      if (!statusRes.ok) throw new Error("Failed to load status");
      if (!positionsRes.ok) throw new Error("Failed to load positions");
      const statusData = await statusRes.json();
      const positionsData = await positionsRes.json();
      setStatus(statusData);
      setPositions(positionsData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 10000);
    return () => clearInterval(id);
  }, []);

  const updateConfig = async (updates: Partial<Config>) => {
    if (!status) return;
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setStatus((s) => (s ? { ...s, config: data } : null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/run-now", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  };

  const cashout = async (pos: Position) => {
    setCashingOut(pos.asset);
    try {
      const res = await fetch("/api/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: pos.asset,
          size: pos.size,
          price: pos.curPrice > 0 ? pos.curPrice : 0.5,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Cashout failed");
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cashout failed");
    } finally {
      setCashingOut(null);
    }
  };

  const toggleEnabled = () => updateConfig({ enabled: !status?.config.enabled });

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="animate-pulse text-zinc-500">Loading...</div>
      </main>
    );
  }

  if (error && !status) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-zinc-950">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={fetchAll} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
            Retry
          </button>
        </div>
      </main>
    );
  }

  const cfg = status?.config ?? { enabled: false, minPercent: 5, maxPercent: 10, minBetUsd: 1 };
  const activity = status?.recentActivity ?? [];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl mx-auto p-6 md:p-8">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Polymarket Copy Trader</h1>
          <p className="mt-1 text-zinc-500">
            Copying <span className="text-emerald-400">gabagool22</span> → your account
          </p>
        </header>

        {/* Balance + Control bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8 p-4 rounded-xl bg-zinc-900/80 border border-zinc-800/60">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Cash balance</p>
            <p className="text-2xl font-semibold text-emerald-400">
              ${(status?.cashBalance ?? 0).toFixed(2)}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              role="switch"
              aria-checked={cfg.enabled}
              onClick={toggleEnabled}
              disabled={saving}
              className={`
                relative w-14 h-8 rounded-full transition-colors flex-shrink-0
                ${cfg.enabled ? "bg-emerald-500" : "bg-zinc-700"}
                ${saving ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
              `}
            >
              <span
                className={`
                  absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-transform
                  ${cfg.enabled ? "left-7 translate-x-[-2px]" : "left-1"}
                `}
              />
            </button>
            <button
              onClick={runNow}
              disabled={running}
              className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {running ? "Running…" : "Run now"}
            </button>
          </div>
        </div>

        {/* Settings */}
        <section className="mb-8 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/60">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-4">Bet size</h2>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-zinc-500 mb-1">Min {cfg.minPercent}% · Max {cfg.maxPercent}%</p>
              <div className="flex gap-2">
                <input
                  type="range"
                  min={1}
                  max={15}
                  value={cfg.minPercent}
                  onChange={(e) =>
                    updateConfig({ minPercent: Math.min(parseInt(e.target.value, 10), cfg.maxPercent - 1) })
                  }
                  className="w-24 h-2 rounded-full bg-zinc-700 accent-emerald-500"
                />
                <input
                  type="range"
                  min={5}
                  max={25}
                  value={cfg.maxPercent}
                  onChange={(e) =>
                    updateConfig({ maxPercent: Math.max(parseInt(e.target.value, 10), cfg.minPercent + 1) })
                  }
                  className="w-24 h-2 rounded-full bg-zinc-700 accent-emerald-500"
                />
              </div>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Min bet (USDC)</p>
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={cfg.minBetUsd}
                onChange={(e) => updateConfig({ minBetUsd: parseFloat(e.target.value) || 1 })}
                className="w-20 px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm"
              />
            </div>
          </div>
        </section>

        {/* Recent activity */}
        {activity.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-medium text-zinc-400 mb-3">Recently copied</h2>
            <div className="space-y-2">
              {activity.slice(0, 8).map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/40"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-200 truncate">{a.title}</p>
                    <p className="text-xs text-zinc-500">
                      {a.side} {a.outcome} · ${a.amountUsd.toFixed(2)} @ {(a.price * 100).toFixed(0)}¢
                    </p>
                  </div>
                  <span className="text-xs text-zinc-500">
                    {new Date(a.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Positions */}
        <section>
          <h2 className="text-sm font-medium text-zinc-400 mb-3">Your positions</h2>
          {positions.length === 0 ? (
            <p className="text-zinc-500 text-sm py-8 text-center">No open positions</p>
          ) : (
            <div className="space-y-4">
              {positions.map((pos) => {
                const marketUrl = `https://polymarket.com/event/${pos.eventSlug || pos.slug}`;
                const canSell = !pos.redeemable && pos.curPrice > 0;
                const pnlPositive = pos.cashPnl >= 0;
                return (
                  <div
                    key={pos.asset}
                    className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800/60 hover:border-zinc-700/60 transition-colors"
                  >
                    <a
                      href={marketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block group"
                    >
                      <div className="flex gap-3">
                        {pos.icon && (
                          <img
                            src={pos.icon}
                            alt=""
                            className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-100 group-hover:text-emerald-400 transition-colors line-clamp-2">
                            {pos.title}
                          </p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                              {pos.outcome}
                            </span>
                            <span className="text-xs text-zinc-500">
                              ${pos.initialValue.toFixed(2)} → ${pos.currentValue.toFixed(2)}
                            </span>
                            <span
                              className={`text-xs font-medium ${
                                pnlPositive ? "text-emerald-400" : "text-red-400"
                              }`}
                            >
                              {pnlPositive ? "+" : ""}{pos.cashPnl.toFixed(2)} ({pos.percentPnl.toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                      </div>
                    </a>
                    {canSell && (
                      <div className="mt-3 pt-3 border-t border-zinc-800/60">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            cashout(pos);
                          }}
                          disabled={cashingOut === pos.asset}
                          className="w-full py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-sm font-medium disabled:opacity-50 transition-colors"
                        >
                          {cashingOut === pos.asset ? "Selling…" : "Cash out"}
                        </button>
                      </div>
                    )}
                    {pos.redeemable && (
                      <p className="mt-2 text-xs text-zinc-500">Resolved · Redeem on Polymarket</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Status footer */}
        <footer className="mt-8 pt-6 border-t border-zinc-800/60 text-xs text-zinc-500">
          Last run: {status?.state.lastRunAt ? new Date(status.state.lastRunAt).toLocaleString() : "—"} ·{" "}
          Last copied: {status?.state.lastCopiedAt ? new Date(status.state.lastCopiedAt).toLocaleString() : "—"}
          {status?.state.lastError && (
            <span className="block mt-1 text-red-400">{status.state.lastError}</span>
          )}
        </footer>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </main>
  );
}
