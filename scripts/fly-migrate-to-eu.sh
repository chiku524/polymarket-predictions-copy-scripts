#!/usr/bin/env bash
# Migrate Fly.io apps to Amsterdam (required for Polymarket - US IPs are blocked)
# Run: bash scripts/fly-migrate-to-eu.sh

set -e

for app in polymarket-trader polymarket-trader-worker; do
  echo "=== Migrating $app to Amsterdam ==="
  # Destroy all machines - deploy will create fresh in ams
  for id in $(fly machine list -a "$app" -q 2>/dev/null || true); do
    [ -n "$id" ] && fly machine destroy "$id" -a "$app" --force
  done
  fly scale count app=0 -a "$app" -y 2>/dev/null || true
  config="fly.toml"
  [ "$app" = "polymarket-trader-worker" ] && config="fly.worker.toml"
  fly deploy -a "$app" -c "$config" --remote-only --depot=false --primary-region ams -y
  echo ""
done

echo "Done. Verify with Diagnostics in the UI - geoblock should show country=NL (not US)."
