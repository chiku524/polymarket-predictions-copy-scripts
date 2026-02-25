# Polymarket Paired Strategy Trader

Run your own BTC/ETH Up-Down paired strategy on Polymarket with **Off / Paper / Live** modes, wallet budget caps, and paper analytics before going live.

## Web UI (Railway)

A Next.js app provides a control UI to set trading mode (**Off / Paper / Live**), adjust sizing, cap wallet usage per run, and run manually.

### Deploy to Railway (single platform, two services)

Use one Railway project with:
- **Service A (web)**: Next.js UI + API routes
- **Service B (worker)**: persistent strategy worker loop

Both services can point to this same repo.

#### 1) Create services from this repo

- **web service**
  - Dockerfile path: `Dockerfile`
  - Exposes port `3000`
- **worker service**
  - Dockerfile path: `Dockerfile.worker`
  - Runs `npm run worker`

#### 2) Add Redis in Railway

- Add a Railway Redis service in the same project.
- Share Redis env vars with both services (`REDIS_URL` and/or `REDIS_PRIVATE_URL`).
- This app now uses Redis directly (no Vercel KV dependency required).

#### 3) Set environment variables

For **web service**:
- `PRIVATE_KEY` – Your wallet private key
- `MY_ADDRESS` – Your Polymarket proxy/funder address
- `SIGNATURE_TYPE` – `1` (Email/Magic) or `2` (Browser wallet)
- `CRON_SECRET` – shared secret used by worker when calling `/api/copy-trade`
- optional claiming vars:
  - `POLY_BUILDER_API_KEY`, `POLY_BUILDER_SECRET`, `POLY_BUILDER_PASSPHRASE`
  - or aliases: `BUILDER_API_KEY`, `BUILDER_SECRET`, `BUILDER_PASSPHRASE`
- optional: `POLYGON_RPC_URL`, `CLAIM_EVERY_N_RUNS`
- optional alerts: `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_TOKEN`

For **worker service**:
- `APP_BASE_URL` – public URL of your Railway web service
- `CRON_SECRET` – must match web service
- optional: `WORKER_INTERVAL_MS` (default `15000`)
- optional: `WORKER_REQUEST_TIMEOUT_MS` (default `70000`)

#### 4) Claiming winnings

Resolved positions must be claimed to move winnings into available cash:
- app auto-claims every `CLAIM_EVERY_N_RUNS` (default 10)
- or use **Claim now** in UI / `POST /api/claim-now`

### Local dev

```bash
npm install
npm run dev
```

Requires Redis (set `REDIS_URL` locally).

### Persistent worker (recommended over cron)

Instead of cron, you can run an always-on worker that continuously triggers the strategy run endpoint.

1. Set env vars for the worker process:
   - `APP_BASE_URL` (e.g. `https://your-app-domain.com`)
   - `CRON_SECRET` (must match your app env)
   - optional: `WORKER_INTERVAL_MS` (default `15000`)
   - optional: `WORKER_REQUEST_TIMEOUT_MS` (default `70000`)

2. Start the worker:

```bash
npm run worker
```

3. Deploy pattern (production):
   - Service A: web app (`next start`)
   - Service B: worker (`npm run worker`)
   - Both share the same Redis + wallet env vars.

Control behavior from UI:
- **Off** = pause (worker keeps running but places no new orders)
- **Paper** = simulate only
- **Live** = real orders
- Paper analytics can be viewed in UI and via `GET /api/paper-stats` (reset with `DELETE /api/paper-stats`).

To avoid duplicate triggers, run **either** cron **or** worker (not both).

---

## Is This Doable?

**Yes.** The public Polymarket API supports everything needed:

| Need | API | Endpoint |
|------|-----|----------|
| Your cash balance | Data API | `GET /v1/accounting/snapshot` |
| Place orders | CLOB API | `POST /order` (auth required) |

Docs: [Polymarket Developer Quickstart](https://docs.polymarket.com/quickstart/overview)

## Configuration Reference

| Variable | Description |
|----------|-------------|
| `MY_ADDRESS` | Your Polymarket proxy/funder address |
| `CRON_SECRET` | Required for worker-to-web auth (random string) |

### UI Controls (Web App)

- **Mode**: `Off` (paused), `Paper` (simulate only), `Live` (real orders)
- **Paper baseline preset**: one-click starter profile for safe paper testing (`Paper` mode, conservative wallet cap/chunk, broad cadence coverage)
- **Wallet usage % / run**: caps how much balance can be spent each run in Paper/Live
- **Coins**: enable/disable `BTC` and `ETH` independently
- **Cadence filters**: enable/disable `5m`, `15m`, and `Hourly` Up/Down markets
- **Cadence min-edge thresholds**: tune different edge requirements for `5m`, `15m`, and `Hourly`
- **Diagnostics trend (last N runs)**: view rolling execution/rejection trends and Phase 2 coin/cadence mix
- **Auto-tune suggestions**: one-click suggested cadence edge updates from trend diagnostics
- **Live safety guardrails**: configurable `max unresolved imbalances/run`, `unwind slippage`, and `unwind share buffer` for one-leg recovery
- **Daily live risk caps**: configurable max daily notional and max daily drawdown hard-stops
- **Safety latch preflight**: attempts to unwind prior unresolved exposure before allowing new live entries
- **Alert webhook (optional)**: set `ALERT_WEBHOOK_URL` (and optional `ALERT_WEBHOOK_TOKEN`) for critical safety notifications
