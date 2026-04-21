#!/usr/bin/env bash
set -euo pipefail

IDENA_GO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO_TOOLCHAIN="${IDENA_GO_GOTOOLCHAIN:-go1.19.13}"

if ! command -v go >/dev/null 2>&1; then
  echo "Go toolchain is missing." >&2
  exit 1
fi

cd "${IDENA_GO_DIR}"
exec env GOTOOLCHAIN="${GO_TOOLCHAIN}" go "$@"
