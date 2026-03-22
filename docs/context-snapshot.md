# Context Snapshot (Desktop)

## Branch and commits
- Branch: `research/benchmark-desktop`
- Latest commits:
  - `45aeeac7` `chore(preview): add browser-safe validation ai preview harness`
  - `02064cda` `feat(ai-helper): add ui-first cloud solver integration`

## Implemented scope
- AI provider bridge in main process (OpenAI + Gemini).
- Session-only API key handling.
- Strict/custom benchmark profile controls.
- Validation short-session AI orchestration and apply-answers event.
- Settings UI route: `/settings/ai`.
- Local benchmark logging to `userData/ai-benchmark/session-metrics.jsonl`.

## Preview/testing support
- Validation visual preview URL:
  - `/validation?previewAi=1`
- Browser-safe guards added for non-Electron preview mode.

## Not implemented yet
- Per-flip benchmark telemetry widgets in validation UI.
- Automated tests for provider adapters/orchestrator.
- Full desktop branding/network fork separation.

## Next priority
1. Finalize AI helper modular boundaries and tests.
2. Desktop fork separation (branding + network defaults).
3. Start chain rule implementation in `idena-go v1.1.2`.
