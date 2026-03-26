#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="${WORKSPACE:-$HOME/idena-ai-benchmark-workspace}"

mkdir -p "$WORKSPACE"
cd "$WORKSPACE"

git clone https://github.com/idena-network/idena-go.git || true
git clone https://github.com/idena-network/idena-desktop.git || true
git clone https://github.com/idena-network/idena-wasm.git || true
git clone https://github.com/idena-network/idena-wasm-binding.git || true

cd "$WORKSPACE/idena-go"
git fetch --tags --prune
git switch --detach v1.1.2
git switch -C research/benchmark-chain

cd "$WORKSPACE/idena-desktop"
git fetch --tags --prune
git switch --detach v0.39.1
git switch -C research/benchmark-desktop

cat <<MSG
Workspace prepared at:
  $WORKSPACE

Anchors:
  idena-go      -> v1.1.2 (research/benchmark-chain)
  idena-desktop -> v0.39.1 (research/benchmark-desktop)
MSG
