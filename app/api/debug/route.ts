import { NextResponse } from "next/server";
import { getConfig, getState } from "@/lib/kv";
import { getCashBalance } from "@/lib/copy-trade";

const MY_ADDRESS = process.env.MY_ADDRESS ?? "0x370e81c93aa113274321339e69049187cce03bb9";
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request) {
  try {
    const [config, state, cashBalance, geoblock] = await Promise.all([
      getConfig(),
      getState(),
      getCashBalance(MY_ADDRESS).catch(() => 0),
      fetch("https://polymarket.com/api/geoblock")
        .then((r) => r.json())
        .catch(() => ({ blocked: null, ip: null, country: null, region: null })),
    ]);

    const walletRunCapUsd = (cashBalance * config.walletUsagePercent) / 100;
    const lastRunAgeSec = state.lastRunAt
      ? Math.floor((Date.now() - state.lastRunAt) / 1000)
      : null;
    const cronHint =
      lastRunAgeSec != null && lastRunAgeSec > 120
        ? `Worker/cron may not be hitting: last run ${lastRunAgeSec}s ago. Check worker APP_BASE_URL (your web app URL, e.g. https://polymarket-trader.fly.dev) and Authorization: Bearer CRON_SECRET.`
        : null;

    const diag = state.lastStrategyDiagnostics;

    return NextResponse.json({
      config: { ...config, enabled: config.enabled },
      state: {
        lastTimestamp: state.lastTimestamp,
        copiedKeysCount: state.copiedKeys?.length ?? 0,
        lastRunAt: state.lastRunAt,
        lastCopiedAt: state.lastCopiedAt,
        lastError: state.lastError,
      },
      lastRunDiagnostics: diag
        ? {
            evaluatedSignals: diag.evaluatedSignals,
            eligibleSignals: diag.eligibleSignals ?? (diag.copied ?? 0) + (diag.paper ?? 0),
            rejectedReasons: diag.rejectedReasons ?? {},
          }
        : null,
      cashBalance,
      cronSecretSet: !!CRON_SECRET,
      diagnosis: {
        status:
          config.mode === "off"
            ? "Trading mode is off"
            : "Paired strategy runs on worker/cron cycles",
      },
      hints: [cronHint].filter(Boolean),
      walletBudget: {
        walletUsagePercent: config.walletUsagePercent,
        runCapUsd: walletRunCapUsd,
      },
      geoblock: {
        blocked: geoblock.blocked,
        country: geoblock.country,
        region: geoblock.region,
        ip: geoblock.ip,
        note: geoblock.blocked
          ? `Server IP is in restricted region (${geoblock.country}). Use a server in an allowed region (e.g. Fly.io Mumbai/bom).`
          : null,
      },
      _requestHost: new URL(request.url).host,
      _debugHint:
        geoblock.blocked && geoblock.country === "US"
          ? "If _requestHost is localhost, Polymarket sees YOUR IP. Open https://polymarket-trader.fly.dev (Fly URL) and use Diagnostics there instead."
          : undefined,
    });
  } catch (e) {
    console.error("Debug error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
