#!/usr/bin/env bash
# Backward-compatible wrapper.
# The canonical script name is now scripts/fly-migrate-to-bom.sh.

set -e

echo "[deprecated] scripts/fly-migrate-to-eu.sh -> use scripts/fly-migrate-to-bom.sh"
bash scripts/fly-migrate-to-bom.sh
