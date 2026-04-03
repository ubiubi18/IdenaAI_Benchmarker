# Context Snapshot (Desktop)

## Branch and commits
- Branch: `research/benchmark-desktop`
- Latest commits:
  - `65b2e1ad` `feat(desktop): add persistent research warning banners`
  - `26070ecc` `feat(ai-helper): add validation telemetry panel`
  - `9eb742ac` `refactor(ai-helper): modularize providers and add focused tests`

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
- Local AI test unit utility under `/settings/ai-test-unit`:
  - queue, clear, run, and batch controls
  - JSON ingest (paste + file upload) and ad-hoc run
  - local queue/run logs in `userData/ai-benchmark/`
- Dataset import tooling:
  - `scripts/import_flip_challenge.py` converts HF FLIP-Challenge parquet to test-unit JSON
  - supports chunked export via `--skip-flips` and `--max-flips`
- Pre-publish flip actions in draft submit drawer:
  - `Run AI test before submit`
  - `Add to local AI test unit`
- Protocol-aware JSON flip normalization:
  - accepts AI-ready, protocol-style decrypted, and decoded flip shapes
  - accepts envelope formats including `{result:{...}}` and `{flips:[...]}`
  - accepts map-shaped payloads and uses map keys as hash fallback
- Browser preview runtime hardening:
  - fixed `dbPath is not a function` crash path
  - fixed `global.setZoomLevel is not a function` crash path
  - added in-memory DB fallback for non-Electron rendering
  - added synchronous `global.sub` preview fallback
  - added synchronous zoom API fallbacks (`getZoomLevel`/`setZoomLevel`)

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
