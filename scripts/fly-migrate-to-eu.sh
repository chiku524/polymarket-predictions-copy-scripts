#!/usr/bin/env bash
# Migrate Fly.io apps to Tokyo (required for Polymarket - US/EU regions blocked)
# Run: bash scripts/fly-migrate-to-eu.sh

set -e

for app in polymarket-trader polymarket-trader-worker; do
  echo "=== Migrating $app to Tokyo (nrt) ==="
  # Destroy all machines - deploy will create fresh in nrt
  for id in $(fly machine list -a "$app" -q 2>/dev/null || true); do
    [ -n "$id" ] && fly machine destroy "$id" -a "$app" --force
  done
  fly scale count app=0 -a "$app" -y 2>/dev/null || true
  config="fly.toml"
  [ "$app" = "polymarket-trader-worker" ] && config="fly.worker.toml"
  fly deploy -a "$app" -c "$config" --remote-only --depot=false --primary-region nrt -y
  echo ""
done

echo "Done. Allocate egress if needed: fly ips allocate-egress -a polymarket-trader -r nrt"
echo "Verify: open https://polymarket-trader.fly.dev (NOT localhost) - geoblock should show country=JP, blocked=false."
