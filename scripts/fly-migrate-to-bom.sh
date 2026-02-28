#!/usr/bin/env bash
# Migrate Fly.io apps to Mumbai (required for Polymarket - US/EU regions blocked)
# Run: bash scripts/fly-migrate-to-bom.sh

set -e

for app in polymarket-trader polymarket-trader-worker; do
  echo "=== Migrating $app to Mumbai (bom) ==="
  # Destroy existing machines so deploy recreates them in bom
  for id in $(fly machine list -a "$app" -q 2>/dev/null || true); do
    [ -n "$id" ] && fly machine destroy "$id" -a "$app" --force
  done
  fly scale count app=0 -a "$app" -y 2>/dev/null || true
  config="fly.toml"
  [ "$app" = "polymarket-trader-worker" ] && config="fly.worker.toml"
  fly deploy -a "$app" -c "$config" --remote-only --depot=false --primary-region bom -y
  echo ""
done

echo "Done. Allocate egress if needed: fly ips allocate-egress -a polymarket-trader -r bom"
echo "Verify: open https://polymarket-trader.fly.dev (NOT localhost) - geoblock should show country=IN, blocked=false."
