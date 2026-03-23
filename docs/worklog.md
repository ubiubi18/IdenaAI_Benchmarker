# Worklog (Desktop)

## 2026-03-22 - Step 1: UI-first AI helper foundation

### Inspected
- `main/index.js`
- `main/preload.js`
- `main/logger.js`
- `renderer/shared/providers/settings-context.js`
- `renderer/screens/validation/machine.js`
- `renderer/pages/validation.js`
- `renderer/screens/settings/layout.js`

### Changed
- Added AI IPC channels and command handling.
- Added `main/ai-providers.js`:
  - OpenAI + Gemini adapters
  - session-only key storage
  - strict/custom profile normalization
  - batch solving, retries, concurrency, deadline enforcement
  - benchmark metrics logging to `userData/ai-benchmark/session-metrics.jsonl`
- Exposed `global.aiSolver` methods in preload.
- Extended logger redaction for AI keys and image payload fields.
- Added `aiSolver` settings state and update action.
- Added `/settings/ai` page with provider/model/profile controls and key operations.
- Added AI solver hook in validation short-session flow.
- Added machine event `APPLY_AI_ANSWERS` for bulk answer application.

### Why
- Start with UI-first benchmark helper to make customer-side cloud-AI benchmarking usable immediately and reduce unverifiable claims of hidden compute/context.

### Commands
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm run lint -- main/channels.js main/ai-providers.js main/index.js main/preload.js main/logger.js renderer/shared/providers/settings-context.js renderer/screens/settings/layout.js renderer/pages/settings/ai.js renderer/screens/validation/machine.js renderer/pages/validation.js renderer/screens/validation/ai/solver-orchestrator.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && ./node_modules/.bin/eslint --fix main/ai-providers.js main/index.js renderer/pages/settings/ai.js renderer/pages/validation.js renderer/screens/settings/layout.js renderer/screens/validation/ai/solver-orchestrator.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && ./node_modules/.bin/eslint main/ai-providers.js renderer/screens/validation/ai/solver-orchestrator.js`

### Result
- Desktop AI-helper baseline is integrated and lint-clean on edited files.
- Remaining work moved to next step: richer benchmark UI telemetry and tests.

## 2026-03-22 - Step 2: Validation UI preview harness and browser-safe guards

### Inspected
- `renderer/shared/providers/node-context.js`
- `renderer/shared/providers/update-context.js`
- `renderer/shared/providers/timing-context.js`
- `renderer/shared/providers/epoch-context.js`
- `renderer/shared/hooks/use-logger.js`
- `renderer/pages/_app.js`
- `renderer/pages/validation.js`
- `renderer/shared/api/api-client.js`

### Changed
- Added a preview route mode for validation:
  - `http://localhost:3105/validation?previewAi=1`
- Added browser-safe fallbacks/guards for non-Electron preview mode:
  - missing `global.ipcRenderer`
  - missing `global.logger`
  - missing `global.env`
- Fixed null-state key access in RPC param defaults.
- Captured validation screenshots showing the new `AI solve short session` action in UI.

### Why
- Needed an inspectable validation UI without a fully running Electron + node stack, so the AI helper action can be visually verified quickly.

### Commands
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3105`
- `npx --yes playwright install chromium`
- `npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 2500 'http://localhost:3105/validation?previewAi=1' /tmp/idena-validation-ai-preview-desktop.png`
- `npx --yes playwright screenshot --browser=chromium --viewport-size="390,844" --full-page --wait-for-timeout 2500 'http://localhost:3105/validation?previewAi=1' /tmp/idena-validation-ai-preview-mobile.png`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && ./node_modules/.bin/eslint renderer/pages/validation.js renderer/pages/_app.js renderer/shared/api/api-client.js renderer/shared/hooks/use-logger.js renderer/shared/providers/node-context.js renderer/shared/providers/update-context.js renderer/shared/providers/timing-context.js renderer/shared/providers/epoch-context.js`

### Result
- Validation page preview now renders in browser mode and exposes the AI helper action for UX review.
- Desktop runtime changes remain modular and isolated from consensus/protocol code.

## 2026-03-23 - Step 3: AI provider modularization and focused tests

### Inspected
- `main/ai-providers.js`
- `main/index.js`
- `main/app-data-path.js`
- `renderer/screens/validation/ai/solver-orchestrator.js`

### Changed
- Split monolithic AI bridge into modular files:
  - `main/ai-providers/bridge.js`
  - `main/ai-providers/constants.js`
  - `main/ai-providers/profile.js`
  - `main/ai-providers/decision.js`
  - `main/ai-providers/concurrency.js`
  - `main/ai-providers/prompt.js`
  - `main/ai-providers/providers/openai.js`
  - `main/ai-providers/providers/gemini.js`
- Kept compatibility entrypoint:
  - `main/ai-providers.js` now re-exports from `main/ai-providers/bridge.js`.
- Added test-oriented dependency injection hooks in bridge:
  - `invokeProvider`
  - `writeBenchmarkLog`
  - `now`
  - `httpClient`
  - `getUserDataPath`
- Added focused unit tests:
  - `main/ai-providers/profile.test.js`
  - `main/ai-providers/decision.test.js`
  - `main/ai-providers/bridge.test.js`

### Why
- The previous single-file implementation was harder to maintain and difficult to test deterministically for benchmark timing behavior.
- Modular boundaries reduce regression risk while preserving runtime behavior.

### Commands
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && ./node_modules/.bin/eslint main/ai-providers.js main/ai-providers/bridge.js main/ai-providers/constants.js main/ai-providers/profile.js main/ai-providers/decision.js main/ai-providers/concurrency.js main/ai-providers/prompt.js main/ai-providers/providers/openai.js main/ai-providers/providers/gemini.js main/ai-providers/profile.test.js main/ai-providers/decision.test.js main/ai-providers/bridge.test.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/profile.test.js main/ai-providers/decision.test.js main/ai-providers/bridge.test.js`

### Result
- New AI provider module tree is in place with backward-compatible exports.
- Focused tests pass:
  - 3 test suites
  - 7 tests
  - all passing

## 2026-03-23 - Step 4: Validation telemetry panel for AI benchmark runs

### Inspected
- `renderer/pages/validation.js`

### Changed
- Added an in-session telemetry panel visible during short session when AI helper is enabled.
- Captured telemetry state per run:
  - status (`running|completed|failed`)
  - provider/model
  - summary counters (left/right/skipped/applied/elapsed)
  - per-flip rows (hash, answer, confidence, latency, error marker)
- Kept existing one-click and auto-run behavior unchanged.
- Captured updated UI screenshots:
  - `/tmp/idena-validation-ai-telemetry-desktop.png`
  - `/tmp/idena-validation-ai-telemetry-mobile.png`

### Why
- Benchmark users need immediate visibility into what the AI helper actually did per session and per flip, without exporting logs first.

### Commands
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && ./node_modules/.bin/eslint renderer/pages/validation.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3111`
- `npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 2500 'http://localhost:3111/validation?previewAi=1' /tmp/idena-validation-ai-telemetry-desktop.png`
- `npx --yes playwright screenshot --browser=chromium --viewport-size=\"390,844\" --full-page --wait-for-timeout 2500 'http://localhost:3111/validation?previewAi=1' /tmp/idena-validation-ai-telemetry-mobile.png`

### Result
- Validation UI now includes a persistent benchmark telemetry card for AI helper runs.
- Renderer changes lint clean.
