# Polymarket Paired Strategy Trader

Run your own BTC/ETH Up-Down paired strategy on Polymarket with **Off / Paper / Live** modes, wallet budget caps, and paper analytics before going live.

## Web UI (Fly.io)

A Next.js app provides a control UI to set trading mode (**Off / Paper / Live**), adjust sizing, cap wallet usage per run, and run manually.

### Deploy to Fly.io (two apps: web + worker)

Use two Fly.io apps from this repo:
- **polymarket-trader** (web): Next.js UI + API routes
- **polymarket-trader-worker**: persistent strategy worker loop

#### 1) Create apps and deploy

**Web app:**
```bash
fly launch --config fly.toml  # or fly deploy --config fly.toml
```

**Worker app (after web is live):**
```bash
fly launch --config fly.worker.toml  # or fly deploy --config fly.worker.toml
```

#### 2) Add Redis

- Use [Fly.io Redis](https://fly.io/docs/reference/redis/) or an external Redis (Upstash, etc.).
- Set `REDIS_URL` on both the web and worker apps.

#### 3) Set secrets (both apps)

```bash
fly secrets set PRIVATE_KEY=... MY_ADDRESS=... SIGNATURE_TYPE=1 CRON_SECRET=... REDIS_URL=...
```

Optional: `POLY_BUILDER_API_KEY`, `POLY_BUILDER_SECRET`, `POLY_BUILDER_PASSPHRASE`, `POLYGON_RPC_URL`, `CLAIM_EVERY_N_RUNS`, `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_TOKEN`.

**Worker app only:** `APP_BASE_URL` (e.g. `https://polymarket-trader.fly.dev`). It’s pre-set in `fly.worker.toml` for the default app name; adjust if your web app URL differs.

#### 4) GitHub Actions (optional)

`.github/workflows/fly-deploy.yml` deploys the web app and worker on push to `main`. Add `FLY_API_TOKEN` to repo secrets. The workflow deploys both `fly.toml` and `fly.worker.toml` apps.

#### 5) Claiming winnings

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
