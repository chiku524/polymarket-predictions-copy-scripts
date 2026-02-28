#!/usr/bin/env bash
# Set Fly.io secrets for polymarket-trader and polymarket-trader-worker.
# Usage: source .env.secrets 2>/dev/null; bash scripts/fly-set-secrets.sh
# Or: REDIS_URL="..." CRON_SECRET="..." bash scripts/fly-set-secrets.sh
#
# Required (provide via env or .env.secrets):
#   REDIS_URL, CRON_SECRET, PRIVATE_KEY, MY_ADDRESS
#   POLY_BUILDER_API_KEY, POLY_BUILDER_SECRET, POLY_BUILDER_PASSPHRASE (for claiming)
#
# Create .env.secrets (gitignored) with your values, then: source .env.secrets; bash scripts/fly-set-secrets.sh

set -e

WEB_APP="polymarket-trader"
WORKER_APP="polymarket-trader-worker"

# Optional: load from .env.secrets if present
if [ -f .env.secrets ]; then
  set -a
  source .env.secrets
  set +a
fi

echo "=== Setting secrets for $WEB_APP ==="

if [ -z "$REDIS_URL" ]; then
  echo "Skip REDIS_URL (not set). Set REDIS_URL=redis://default:PASSWORD@host:6379 to enable Redis."
else
  fly secrets set REDIS_URL="$REDIS_URL" -a "$WEB_APP"
fi

# Set CRON_SECRET, PRIVATE_KEY, MY_ADDRESS (only if provided)
WEB_SECRETS=()
[ -n "$CRON_SECRET" ] && WEB_SECRETS+=(CRON_SECRET="$CRON_SECRET")
[ -n "$PRIVATE_KEY" ] && WEB_SECRETS+=(PRIVATE_KEY="$PRIVATE_KEY")
[ -n "$MY_ADDRESS" ] && WEB_SECRETS+=(MY_ADDRESS="$MY_ADDRESS")

if [ ${#WEB_SECRETS[@]} -gt 0 ]; then
  fly secrets set "${WEB_SECRETS[@]}" -a "$WEB_APP"
fi

# Optional Polymarket Builder API (for claiming)
if [ -n "$POLY_BUILDER_API_KEY" ] && [ -n "$POLY_BUILDER_SECRET" ] && [ -n "$POLY_BUILDER_PASSPHRASE" ]; then
  fly secrets set \
    POLY_BUILDER_API_KEY="$POLY_BUILDER_API_KEY" \
    POLY_BUILDER_SECRET="$POLY_BUILDER_SECRET" \
    POLY_BUILDER_PASSPHRASE="$POLY_BUILDER_PASSPHRASE" \
    -a "$WEB_APP"
  echo "Builder API keys set."
else
  echo "Skip POLY_BUILDER_* (not all set). Required for claiming winnings."
fi

echo ""
echo "=== Setting secrets for $WORKER_APP ==="
if [ -n "$CRON_SECRET" ]; then
  fly secrets set CRON_SECRET="$CRON_SECRET" -a "$WORKER_APP"
else
  echo "Skip worker CRON_SECRET (not set). Must match web app."
fi

echo ""
echo "Done. APP_BASE_URL is in fly.worker.toml; no secret needed."
echo "Verify: fly secrets list -a $WEB_APP && fly secrets list -a $WORKER_APP"
