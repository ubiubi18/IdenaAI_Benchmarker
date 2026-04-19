#!/usr/bin/env bash
set -euo pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"

close_with_playwright_cli() {
  if [[ -x "$PWCLI" ]]; then
    "$PWCLI" close-all >/dev/null 2>&1 || true
    "$PWCLI" kill-all >/dev/null 2>&1 || true
    return 0
  fi

  if command -v npx >/dev/null 2>&1; then
    npx --yes --package @playwright/cli playwright-cli close-all >/dev/null 2>&1 || true
    npx --yes --package @playwright/cli playwright-cli kill-all >/dev/null 2>&1 || true
  fi
}

close_with_playwright_cli

pkill -f "playwright-core/lib/entry/cliDaemon.js" >/dev/null 2>&1 || true
pkill -f "Google Chrome for Testing" >/dev/null 2>&1 || true
pkill -f "playwright_chromiumdev_profile" >/dev/null 2>&1 || true

echo "Closed Playwright browser sessions and cleaned up stale Chrome for Testing processes."
