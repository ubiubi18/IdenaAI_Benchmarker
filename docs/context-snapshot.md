# Context Snapshot (Desktop)

## Branch and commits
- Branch: `research/benchmark-desktop`
- Latest commits:
  - `26070ecc` `feat(ai-helper): add validation telemetry panel`
  - `9eb742ac` `refactor(ai-helper): modularize providers and add focused tests`
  - `45aeeac7` `chore(preview): add browser-safe validation ai preview harness`

## Implemented scope
- AI provider bridge in main process (OpenAI + Gemini).
- Session-only API key handling.
- Strict/custom benchmark profile controls.
- Validation short-session AI orchestration and apply-answers event.
- Settings UI route: `/settings/ai`.
- Local benchmark logging to `userData/ai-benchmark/session-metrics.jsonl`.
- Modular AI provider architecture under `main/ai-providers/`.
- Focused unit tests for AI profile normalization, decision parsing, and deadline handling.
- Validation UI telemetry panel for AI short-session runs (provider/model/summary/per-flip rows).
- Persistent research warning banners on layout routes and validation session.

## Preview/testing support
- Validation visual preview URL:
  - `/validation?previewAi=1`
- Browser-safe guards added for non-Electron preview mode.

## Not implemented yet
- Orchestrator integration tests with realistic image payload generation.
- Full desktop branding/network fork separation.

## Next priority
1. Desktop fork separation (branding + network defaults).
2. Orchestrator integration tests with image compose/deadline flow.
3. Start chain rule implementation in `idena-go v1.1.2`.
