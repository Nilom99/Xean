#!/usr/bin/env bash
# Codex Local — one-click launcher for Linux / macOS (no VS Code required).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[codex-local] ERROR: Node.js 20+ is required but was not found on PATH."
  echo "[codex-local] Install it from https://nodejs.org and re-run this script."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[codex-local] ERROR: Node.js 20+ is required (found $(node -v))."
  exit 1
fi

echo "[codex-local] Installing dependencies (this only happens once)..."
if [ ! -d node_modules ]; then
  npm install
fi

echo "[codex-local] Building and launching Codex Local..."
if [ "${1:-}" = "--dev" ]; then
  npm run dev
else
  npm run start
fi
