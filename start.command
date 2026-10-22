#!/usr/bin/env bash
# Codex Local — double-clickable launcher for macOS (opens Terminal).
# Make sure it stays executable:  chmod +x start.command
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[codex-local] ERROR: Node.js 20+ is required but was not found on PATH."
  echo "[codex-local] Install it from https://nodejs.org (or use nvm) and re-run."
  read -r -p "Press Enter to close..."
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

read -r -p "Codex Local closed. Press Enter to close this window..."
