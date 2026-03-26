#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[check] repo root: $ROOT"

if [[ ! -d "$ROOT/idena-desktop" || ! -d "$ROOT/idena-go" || ! -d "$ROOT/idena-wasm-binding" ]]; then
  echo "[fail] expected directories missing"
  exit 1
fi

if [[ ! -f "$ROOT/idena-go/go.mod" ]]; then
  echo "[fail] missing idena-go/go.mod"
  exit 1
fi

if ! grep -q "replace github.com/idena-network/idena-wasm-binding => ../idena-wasm-binding" "$ROOT/idena-go/go.mod"; then
  echo "[fail] go.mod replace directive missing"
  exit 1
fi

if [[ ! -f "$ROOT/idena-wasm-binding/lib/libidena_wasm_darwin_arm64.a" ]]; then
  echo "[fail] missing darwin arm64 wasm lib"
  exit 1
fi

echo "[ok] snapshot structure verified"
