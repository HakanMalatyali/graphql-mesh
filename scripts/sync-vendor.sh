#!/usr/bin/env bash
# Builds graphql-mesh and syncs the compiled output to compass vendor directory.
# Usage: ./scripts/sync-vendor.sh [--compass-dir <path>]
#
# Default compass dir: ../compass (sibling of graphql-mesh repo)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MESH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPASS_DIR="${1:-}"

# Parse --compass-dir argument
while [[ $# -gt 0 ]]; do
  case $1 in
    --compass-dir)
      COMPASS_DIR="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$COMPASS_DIR" ]]; then
  COMPASS_DIR="$(cd "$MESH_DIR/../compass" && pwd)"
fi

VENDOR_DIR="$COMPASS_DIR/vendor"

if [[ ! -d "$VENDOR_DIR" ]]; then
  echo "ERROR: vendor directory not found at $VENDOR_DIR"
  echo "Use --compass-dir <path> to specify the compass repo location."
  exit 1
fi

echo "==> graphql-mesh: $MESH_DIR"
echo "==> compass vendor: $VENDOR_DIR"
echo ""

# ─── 1. Build ───────────────────────────────────────────────────────────────
echo "[1/3] Building graphql-mesh..."
cd "$MESH_DIR"
yarn bob build
echo ""

# ─── 2. Copy .bob output → packages/*/dist ──────────────────────────────────
echo "[2/3] Copying .bob output to dist directories..."

copy_to_dist() {
  local bob_src="$1"   # e.g. .bob/cjs/transports/soap/src
  local dist_dst="$2"  # e.g. packages/transports/soap/dist/cjs
  mkdir -p "$dist_dst"
  # copy only .js files (skip .d.ts — dist doesn't need typings at runtime)
  cp "$bob_src"/*.js "$dist_dst/"
  echo "  copied $bob_src -> $dist_dst"
}

# transport-soap
copy_to_dist "$MESH_DIR/.bob/cjs/transports/soap/src"  "$MESH_DIR/packages/transports/soap/dist/cjs"
copy_to_dist "$MESH_DIR/.bob/esm/transports/soap/src"  "$MESH_DIR/packages/transports/soap/dist/esm"

# loaders/soap (@omnigraph/soap)
copy_to_dist "$MESH_DIR/.bob/cjs/loaders/soap/src"  "$MESH_DIR/packages/loaders/soap/dist/cjs"
copy_to_dist "$MESH_DIR/.bob/esm/loaders/soap/src"  "$MESH_DIR/packages/loaders/soap/dist/esm"

# compose-cli
copy_to_dist "$MESH_DIR/.bob/cjs/compose-cli/src"  "$MESH_DIR/packages/compose-cli/dist/cjs"
copy_to_dist "$MESH_DIR/.bob/esm/compose-cli/src"  "$MESH_DIR/packages/compose-cli/dist/esm"

echo ""

# ─── 3. Copy dist → compass vendor ──────────────────────────────────────────
echo "[3/3] Syncing to compass vendor..."

sync_vendor() {
  local src="$1"
  local dst="$2"
  if [[ ! -d "$src" ]]; then
    echo "  SKIP (not found): $src"
    return
  fi
  mkdir -p "$dst"
  cp "$src"/*.js "$dst/"
  echo "  synced $src -> $dst"
}

# @graphql-mesh/transport-soap
sync_vendor "$MESH_DIR/packages/transports/soap/dist/cjs"  "$VENDOR_DIR/@graphql-mesh/transport-soap/cjs"
sync_vendor "$MESH_DIR/packages/transports/soap/dist/esm"  "$VENDOR_DIR/@graphql-mesh/transport-soap/esm"

# @omnigraph/soap
sync_vendor "$MESH_DIR/packages/loaders/soap/dist/cjs"  "$VENDOR_DIR/@omnigraph/soap/dist/cjs"
sync_vendor "$MESH_DIR/packages/loaders/soap/dist/esm"  "$VENDOR_DIR/@omnigraph/soap/dist/esm"

# @graphql-mesh/compose-cli
sync_vendor "$MESH_DIR/packages/compose-cli/dist/cjs"  "$VENDOR_DIR/@graphql-mesh/compose-cli/dist/cjs"
sync_vendor "$MESH_DIR/packages/compose-cli/dist/esm"  "$VENDOR_DIR/@graphql-mesh/compose-cli/dist/esm"

echo ""
echo "Done. Compass vendor is up to date."
