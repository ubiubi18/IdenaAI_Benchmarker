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

- `cd $WORKSPACE/idena-desktop && npm run lint -- main/channels.js main/ai-providers.js main/index.js main/preload.js main/logger.js renderer/shared/providers/settings-context.js renderer/screens/settings/layout.js renderer/pages/settings/ai.js renderer/screens/validation/machine.js renderer/pages/validation.js renderer/screens/validation/ai/solver-orchestrator.js`
- `cd $WORKSPACE/idena-desktop && ./node_modules/.bin/eslint --fix main/ai-providers.js main/index.js renderer/pages/settings/ai.js renderer/pages/validation.js renderer/screens/settings/layout.js renderer/screens/validation/ai/solver-orchestrator.js`
- `cd $WORKSPACE/idena-desktop && ./node_modules/.bin/eslint main/ai-providers.js renderer/screens/validation/ai/solver-orchestrator.js`

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

- `cd $WORKSPACE/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3105`
- `npx --yes playwright install chromium`
- `npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 2500 'http://localhost:3105/validation?previewAi=1' /tmp/idena-validation-ai-preview-desktop.png`
- `npx --yes playwright screenshot --browser=chromium --viewport-size="390,844" --full-page --wait-for-timeout 2500 'http://localhost:3105/validation?previewAi=1' /tmp/idena-validation-ai-preview-mobile.png`
- `cd $WORKSPACE/idena-desktop && ./node_modules/.bin/eslint renderer/pages/validation.js renderer/pages/_app.js renderer/shared/api/api-client.js renderer/shared/hooks/use-logger.js renderer/shared/providers/node-context.js renderer/shared/providers/update-context.js renderer/shared/providers/timing-context.js renderer/shared/providers/epoch-context.js`

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

- `cd $WORKSPACE/idena-desktop && ./node_modules/.bin/eslint main/ai-providers.js main/ai-providers/bridge.js main/ai-providers/constants.js main/ai-providers/profile.js main/ai-providers/decision.js main/ai-providers/concurrency.js main/ai-providers/prompt.js main/ai-providers/providers/openai.js main/ai-providers/providers/gemini.js main/ai-providers/profile.test.js main/ai-providers/decision.test.js main/ai-providers/bridge.test.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/profile.test.js main/ai-providers/decision.test.js main/ai-providers/bridge.test.js`

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

- `cd $WORKSPACE/idena-desktop && ./node_modules/.bin/eslint renderer/pages/validation.js`
- `cd $WORKSPACE/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3111`
- `npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 2500 'http://localhost:3111/validation?previewAi=1' /tmp/idena-validation-ai-telemetry-desktop.png`
- `npx --yes playwright screenshot --browser=chromium --viewport-size=\"390,844\" --full-page --wait-for-timeout 2500 'http://localhost:3111/validation?previewAi=1' /tmp/idena-validation-ai-telemetry-mobile.png`

### Result

- Validation UI now includes a persistent benchmark telemetry card for AI helper runs.
- Renderer changes lint clean.

## 2026-03-23 - Step 5: Persistent benchmark warning banners

### Inspected

- `renderer/shared/components/layout.js`
- `renderer/pages/validation.js`

### Changed

- Added a global warning banner in `Layout` pages:
  - explicitly states this is a research benchmark fork
  - explicitly states this is not Idena mainnet
  - links directly to `/settings/ai`
  - shows current AI-helper enabled/disabled status
- Added a top warning strip in validation session page:
  - `Research benchmark fork. Not Idena mainnet.`
- Captured updated screenshots:
  - `/tmp/idena-validation-warning-telemetry-desktop.png`
  - `/tmp/idena-settings-ai-warning-banner-desktop.png`

### Why

- The fork must be visually impossible to confuse with upstream production defaults.

### Commands

- `cd $WORKSPACE/idena-desktop && ./node_modules/.bin/eslint renderer/pages/validation.js renderer/shared/components/layout.js`
- `cd $WORKSPACE/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3112`
- `npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 2500 'http://localhost:3112/validation?previewAi=1' /tmp/idena-validation-warning-telemetry-desktop.png`
- `npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 2500 'http://localhost:3112/settings/ai' /tmp/idena-settings-ai-warning-banner-desktop.png`

### Result

- Warning messaging is now always visible on normal app routes and on validation UI.

## 2026-03-23 - Step 6: Local AI test unit + pre-publish draft testing + protocol JSON formats

### Inspected

- `$WORKSPACE/idena-desktop/main/index.js`
- `$WORKSPACE/idena-desktop/main/preload.js`
- `$WORKSPACE/idena-desktop/main/channels.js`
- `$WORKSPACE/idena-desktop/renderer/pages/flips/new.js`
- `$WORKSPACE/idena-desktop/renderer/screens/flips/components.js`
- `$WORKSPACE/idena-desktop/renderer/pages/settings/ai-test-unit.js`
- `$WORKSPACE/idena-desktop/renderer/screens/validation/ai/test-unit-utils.js`
- `$WORKSPACE/idena-desktop/renderer/shared/api/dna.js`
- `$WORKSPACE/idena-desktop/renderer/screens/flips/utils.js`
- `$WORKSPACE/idena-desktop/renderer/screens/validation/machine.js`
- `$WORKSPACE/idena-go/api/flip_api.go`

### Changed

- Added `main/ai-test-unit.js` bridge:
  - queue add/list/clear/run operations
  - persistent queue storage in `userData/ai-benchmark/test-unit-flips.json`
  - run logs in `userData/ai-benchmark/test-unit-runs.jsonl`
- Added IPC channel `ai-test-unit/command` and preload exposure `global.aiTestUnit`.
- Added settings utility route `/settings/ai-test-unit` with:
  - queue controls
  - bulk JSON ingest
  - ad-hoc JSON execution
  - last-run summary
- Added publish drawer draft actions:
  - `Run AI test before submit`
  - `Add to local AI test unit`
- Added protocol JSON normalization module `renderer/screens/validation/ai/test-unit-utils.js`:
  - AI-ready `{leftImage,rightImage}`
  - protocol-style decrypted `{hex/privateHex/publicHex}`
  - decoded `{images,orders}`
  - wrapper support for `{flips:[...]}`, `{result:{...}}`, `{result:[...]}`.
- Added doc `docs/flip-format-reference.md` with concrete payload templates.

### Why

- You requested a split testing flow: pre-publish AI trial in the normal flip builder plus a separate local stress-test utility for dozens/hundreds of flips, including protocol-style JSON input.

### Commands

- `cd $WORKSPACE/idena-desktop && npm run lint -- --quiet main/channels.js main/index.js main/preload.js main/ai-test-unit.js main/ai-test-unit.test.js renderer/pages/_app.js renderer/pages/flips/new.js renderer/screens/flips/components.js renderer/screens/settings/layout.js renderer/pages/settings/ai-test-unit.js renderer/screens/validation/ai/test-unit-utils.js`
- `cd $WORKSPACE/idena-desktop && npm test -- main/ai-providers/profile.test.js main/ai-providers/decision.test.js main/ai-providers/bridge.test.js main/ai-test-unit.test.js`
- `cd $WORKSPACE/idena-desktop && npm run lint -- --quiet renderer/screens/validation/ai/test-unit-utils.js renderer/pages/settings/ai-test-unit.js`
- `cd $WORKSPACE/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3114`
- `cd $WORKSPACE/idena-desktop && npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 1000 'http://localhost:3114/settings/ai-test-unit' $WORKSPACE/idena-desktop/docs/ai-test-unit-ui.png`
- `cd $WORKSPACE/idena-desktop && npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 1000 'http://localhost:3114/flips/new' $WORKSPACE/idena-desktop/docs/flips-new-ui.png`
- `pkill -f \"next dev renderer -p 3114\" || true`

### Result

- New testing flow is active in UI and main process bridge.
- JSON import now accepts direct RPC-style envelopes and protocol-format flips.
- Lint and focused test suites pass.
- UI proof screenshots captured:
  - `$WORKSPACE/idena-desktop/docs/ai-test-unit-ui.png`
  - `$WORKSPACE/idena-desktop/docs/flips-new-ui.png`

## 2026-03-23 - Step 7: Fix browser-preview runtime crash (`dbPath is not a function`)

### Inspected

- `$WORKSPACE/idena-desktop/renderer/shared/utils/db.js`
- `$WORKSPACE/idena-desktop/renderer/pages/_app.js`
- `$WORKSPACE/idena-desktop/renderer/screens/hardfork/hooks.js`

### Runtime issue

- Command:
  - `cd $WORKSPACE/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3115`
  - `npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 1000 'http://localhost:3115/settings/ai-test-unit' $WORKSPACE/idena-desktop/docs/ai-test-unit-ui-fixed.png`
- Error summary:
  - `TypeError: dbPath is not a function`
  - source: `renderer/shared/utils/db.js` in `requestDb()`
- Root-cause hypothesis:
  - Browser preview path does not have Electron preload globals (`dbPath`, `levelup`, `leveldown`) at first render.
  - Existing fallback setup in `_app.js` ran in `useEffect`, which is too late for code paths that call `requestDb()` during initial render.

### Changed

- `renderer/shared/utils/db.js`:
  - removed static global destructuring for db bindings.
  - added runtime detection for native DB bindings.
  - added in-memory DB fallback implementing `get`, `put`, `batch`, `clear`, `isOpen`, `close`.
  - added safe `sub` fallback inside `epochDb`.
- `renderer/pages/_app.js`:
  - moved preview global fallback initialization to synchronous path (not `useEffect`).
  - added `global.sub` identity fallback for preview mode.

### Why

- Keep browser preview stable while preserving Electron runtime behavior.
- Prevent hard crash when rendering settings/validation pages outside Electron.

### Commands

- `cd $WORKSPACE/idena-desktop && npm run lint -- --quiet renderer/shared/utils/db.js renderer/pages/_app.js renderer/screens/validation/ai/test-unit-utils.js`
- `cd $WORKSPACE/idena-desktop && npm test -- main/ai-providers/profile.test.js main/ai-providers/decision.test.js main/ai-providers/bridge.test.js main/ai-test-unit.test.js`
- `cd $WORKSPACE/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3115`
- `cd $WORKSPACE/idena-desktop && npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 1000 'http://localhost:3115/settings/ai-test-unit' $WORKSPACE/idena-desktop/docs/ai-test-unit-ui-fixed.png`
- `cd $WORKSPACE/idena-desktop && npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 1000 'http://localhost:3115/flips/new' $WORKSPACE/idena-desktop/docs/flips-new-ui-fixed.png`
- `pkill -f "next dev renderer -p 3115" || true`

### Result

- Browser preview pages load without the `dbPath` runtime crash.
- Updated screenshots captured:
  - `$WORKSPACE/idena-desktop/docs/ai-test-unit-ui-fixed.png`
  - `$WORKSPACE/idena-desktop/docs/flips-new-ui-fixed.png`

## 2026-03-23 - Step 8: Add JSON file-import flow to AI Test Unit

### Inspected

- `$WORKSPACE/idena-desktop/renderer/pages/settings/ai-test-unit.js`

### Changed

- Added direct JSON file upload in `/settings/ai-test-unit`:
  - `Load JSON file` button with hidden file input
  - supports `.json` and `application/json`
  - reads file content into JSON textarea
  - displays loaded filename
- Added `Clear JSON` action for quick iteration.
- Kept existing paste-based ingest/run flow unchanged.
- Captured updated screenshot:
  - `$WORKSPACE/idena-desktop/docs/ai-test-unit-ui-file-import.png`

### Why

- You asked to continue and optimize real local testing flow for large datasets; file-based import removes paste friction for dozens/hundreds of flips.

### Commands

- `cd $WORKSPACE/idena-desktop && npm run lint -- --quiet renderer/pages/settings/ai-test-unit.js renderer/shared/utils/db.js renderer/pages/_app.js renderer/screens/validation/ai/test-unit-utils.js`
- `cd $WORKSPACE/idena-desktop && npm test -- main/ai-providers/profile.test.js main/ai-providers/decision.test.js main/ai-providers/bridge.test.js main/ai-test-unit.test.js`
- `cd $WORKSPACE/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3116`
- `cd $WORKSPACE/idena-desktop && npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 1000 'http://localhost:3116/settings/ai-test-unit' $WORKSPACE/idena-desktop/docs/ai-test-unit-ui-file-import.png`
- `pkill -f "next dev renderer -p 3116" || true`

### Result

- AI Test Unit now supports both paste and file-based JSON ingestion for benchmark batches.

## 2026-03-23 - Step 9: Fix browser-preview runtime crash (`global.setZoomLevel is not a function`)

### Inspected

- `$WORKSPACE/idena-desktop/renderer/shared/components/layout.js`
- `$WORKSPACE/idena-desktop/renderer/pages/_app.js`
- `$WORKSPACE/idena-desktop/main/preload.js`

### Runtime issue

- Error summary:
  - `TypeError: global.setZoomLevel is not a function`
  - source: `renderer/shared/components/layout.js`
- Root-cause hypothesis:
  - Preview/browser mode path has no Electron `webFrame` bindings.
  - `layout.js` tried to call `global.setZoomLevel` unconditionally.
  - Existing fallback only covered `toggleFullScreen`, not zoom APIs.

### Changed

- `renderer/shared/components/layout.js`:
  - fixed bad default (`global.getZoomLevel` was initialized to `{}`)
  - added safe function defaults:
    - `global.getZoomLevel = () => 0`
    - `global.setZoomLevel = () => {}`
- `renderer/pages/_app.js`:
  - added synchronous preview fallbacks for:
    - `global.getZoomLevel`
    - `global.setZoomLevel`

### Why

- Keep preview mode deterministic and crash-free while preserving Electron behavior.

### Commands

- `cd $WORKSPACE/idena-desktop && npm run lint -- --quiet renderer/shared/components/layout.js renderer/pages/_app.js`
- `cd $WORKSPACE/idena-desktop && npm test -- main/ai-providers/profile.test.js main/ai-providers/decision.test.js main/ai-providers/bridge.test.js main/ai-test-unit.test.js`
- `cd $WORKSPACE/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3117`
- `cd $WORKSPACE/idena-desktop && npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 1000 'http://localhost:3117/settings/ai-test-unit' $WORKSPACE/idena-desktop/docs/ai-test-unit-ui-zoom-fix.png`
- `cd $WORKSPACE/idena-desktop && npx --yes playwright screenshot --browser=chromium --full-page --wait-for-timeout 1000 'http://localhost:3117/flips/new' $WORKSPACE/idena-desktop/docs/flips-new-ui-zoom-fix.png`
- `pkill -f "next dev renderer -p 3117" || true`

### Result

- Preview pages render without zoom-related runtime crash.
- New verification screenshots:
  - `$WORKSPACE/idena-desktop/docs/ai-test-unit-ui-zoom-fix.png`
  - `$WORKSPACE/idena-desktop/docs/flips-new-ui-zoom-fix.png`

## 2026-03-23 - Step 10: Import FLIP-Challenge dataset (Hugging Face)

### Inspected

- `https://huggingface.co/datasets/aplesner-eth/FLIP-Challenge`
- HF dataset file tree API and dataset metadata API
- Verified parquet layout and row schema (`task_id`, `task_data`, `image_id`, `image`)

### Changed

- Added dataset importer script:
  - `$WORKSPACE/idena-desktop/scripts/import_flip_challenge.py`
  - Downloads parquet files from HF (with local cache)
  - Converts grouped image rows per task into decoded flip format accepted by AI Test Unit
  - Supports chunk paging with `--skip-flips` and `--max-flips`
- Added docs:
  - `$WORKSPACE/idena-desktop/docs/flip-challenge-import.md`

### Why

- You requested importing lots of flips from FLIP-Challenge for local AI helper benchmarking.
- Chunked conversion avoids huge single-file imports and keeps UI stable.

### Commands

- `python3 -m pip install --user pyarrow`
- `cd $WORKSPACE/idena-desktop && python3 scripts/import_flip_challenge.py --split test --max-flips 200 --output data/flip-challenge-test-200-decoded.json`
- `cd $WORKSPACE/idena-desktop && for SKIP in 200 400 600 800; do OUT="data/flip-challenge-test-${SKIP}-to-$((SKIP+199))-decoded.json"; python3 scripts/import_flip_challenge.py --split test --skip-flips "$SKIP" --max-flips 200 --output "$OUT"; done`
- `ls -lh $WORKSPACE/idena-desktop/data/flip-challenge-test*decoded.json`

### Result

- Imported and converted 1,752 test flips into chunked JSON files:
  - `data/flip-challenge-test-200-decoded.json`
  - `data/flip-challenge-test-200-to-399-decoded.json`
  - `data/flip-challenge-test-400-to-599-decoded.json`
  - `data/flip-challenge-test-600-to-799-decoded.json`
  - `data/flip-challenge-test-800-to-999-decoded.json`
  - `data/flip-challenge-test-1000-to-1199-decoded.json`
  - `data/flip-challenge-test-1200-to-1399-decoded.json`
  - `data/flip-challenge-test-1400-to-1599-decoded.json`
  - `data/flip-challenge-test-1600-to-1799-decoded.json`
- File sizes are roughly `38-44 MB` per 200-flip chunk.

## 2026-03-23 - Step 11: Preload FLIP-Challenge data directly into local AI test queue

### Inspected

- Existing converted JSON chunks under `$WORKSPACE/idena-desktop/data`
- Local queue path: `~/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json`

### Changed

- Added queue preload script:
  - `$WORKSPACE/idena-desktop/scripts/preload_ai_test_unit_queue.py`
  - converts decoded flips (`images` + `orders`) into AI-ready queue entries (`leftImage` + `rightImage`)
  - writes directly into local queue file used by desktop bridge
- Preloaded 300 flips into local queue (`--replace --max-total 300`).

### Commands

- `cd $WORKSPACE/idena-desktop && python3 scripts/preload_ai_test_unit_queue.py --replace --max-total 300 --input data/flip-challenge-test-200-decoded.json data/flip-challenge-test-200-to-399-decoded.json`
- `ls -lh "$HOME/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json"`

### Result

- Queue file updated:
  - `~/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json`
- Current queue size: `300` flips.
- In app, `Settings -> AI Test Unit -> Reload queue` should display the preloaded entries.

## 2026-03-23 - Step 12: Fix file-input clear crash in AI Test Unit and reload queue

### Error report

- Runtime error from app UI:
  - `TypeError: Cannot set property 'value' of null`
  - Source: `renderer/pages/settings/ai-test-unit.js` around file load handler cleanup.

### Root cause hypothesis

- `event.target` was accessed after an `await` in a React handler.
- React synthetic events can be pooled; `target` may become `null` by the time cleanup executes.

### Changed

- Updated `loadJsonFile` in `$WORKSPACE/idena-desktop/renderer/pages/settings/ai-test-unit.js`:
  - Capture `const inputElement = event.target` before async work.
  - In `finally`, clear with null-safe guard:
    - `if (inputElement) inputElement.value = ''`

### Commands

- `cd $WORKSPACE/idena-desktop && nl -ba renderer/pages/settings/ai-test-unit.js | sed -n '116,144p'`
- `cd $WORKSPACE/idena-desktop && python3 scripts/preload_ai_test_unit_queue.py --replace --max-total 300 --input data/flip-challenge-test-200-decoded.json data/flip-challenge-test-200-to-399-decoded.json`
- `python3 - <<'PY'`
- `import json, pathlib`
- `p=pathlib.Path('~/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json')`
- `print('exists',p.exists(),'bytes',p.stat().st_size if p.exists() else 0)`
- `arr=json.loads(p.read_text())`
- `print('count',len(arr))`
- `PY`

### Result

- Crash condition is fixed in code.
- Queue reload retry completed successfully with `300` flips in local queue file.
- Next app action: `Settings -> AI Test Unit -> Reload queue` and run batch.

### 2026-03-23 - Step 12b: Additional defensive guard for file input event target

#### Changed

- Hardened `loadJsonFile` in `$WORKSPACE/idena-desktop/renderer/pages/settings/ai-test-unit.js`:
  - `const inputElement = event.target || event.currentTarget || null`
  - clear value only when `typeof inputElement.value === 'string'`

#### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/settings/ai-test-unit.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-test-unit.test.js`

#### Result

- Lint clean.
- AI test unit queue bridge tests pass.

## 2026-03-23 - Step 13: Make AI provider test errors actionable in UI

### Inspected

- `$WORKSPACE/idena-desktop/main/ai-providers/bridge.js`
- `$WORKSPACE/idena-desktop/main/index.js`
- `$WORKSPACE/idena-desktop/renderer/pages/settings/ai.js`
- `~/Library/Logs/Electron/idena.log`

### Problem

- UI showed generic toast:
  - `Error invoking remote method 'ai-solver/command'...`
- Actual provider failure reason (invalid key, no quota, model mismatch, timeout) was not surfaced clearly.

### Changed

- Added normalized provider error extraction in `main/ai-providers/bridge.js`:
  - extracts HTTP status + provider error code/type + message from API responses.
  - wraps `testProvider` failures with readable message:
    - `openai test failed (401 invalid_api_key) for model gpt-4o-mini: ...`
  - uses same formatter for per-flip provider failures in batch runs.
- Added IPC command failure logging in `main/index.js` for `AI_SOLVER_COMMAND`.
- Added renderer-side message cleanup in `renderer/pages/settings/ai.js`:
  - strips `Error invoking remote method ...` prefix before showing toast.
- Added test coverage in `main/ai-providers/bridge.test.js` for formatted OpenAI error messages.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-providers/bridge.js main/index.js renderer/pages/settings/ai.js main/ai-providers/bridge.test.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Result

- Provider test toast now shows actionable reason instead of generic IPC wrapper text.
- Lint passes.
- Relevant tests pass.

### 2026-03-23 - Step 13b: 429 quota/rate-limit hint in AI settings toast

#### Changed

- Updated `$WORKSPACE/idena-desktop/renderer/pages/settings/ai.js`:
  - `formatErrorForToast()` now detects `429`, `insufficient_quota`, and `rate_limit` patterns.
  - appends actionable hint to check OpenAI billing/credits and project budget limits.

#### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/settings/ai.js`

#### Result

- Provider test failure toasts for 429 now include next-step guidance.

## 2026-03-24 - Step 14: Add 429 retry/backoff for OpenAI/Gemini provider requests

### Inspected

- `$WORKSPACE/idena-desktop/main/ai-providers/bridge.js`
- `$WORKSPACE/idena-desktop/main/ai-providers/concurrency.js`
- User-provided successful OpenAI curl output (`gpt-4o-mini-2024-07-18`), confirming credentials are valid.

### Problem

- App-side provider test could fail with transient `429` even though direct API call works.
- Existing retries were immediate and did not honor `Retry-After`.

### Changed

- In `main/ai-providers/bridge.js`:
  - Added `getResponseStatus()` and `getRetryAfterMs()` helpers.
  - Added injected `sleep()` dependency (default `setTimeout`) for controlled retry delays.
  - `testProvider()` now retries once on `429` with backoff (`Retry-After` header when available, else 1200ms).
  - `solveFlipBatch()` retry path now waits on `429` before retrying.
- In `renderer/pages/settings/ai.js`:
  - Existing error formatter now adds explicit guidance for `429` / quota / rate-limit messages.
- In `main/ai-providers/bridge.test.js`:
  - Added tests for `testProvider` retry-on-429 success.
  - Added tests for per-flip retry-on-429 success.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/bridge.test.js renderer/pages/settings/ai.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- Transient `429` no longer fails immediately in provider test and batch solve path.
- Lint passes.
- AI provider bridge tests pass.

## 2026-03-24 - Step 15: Prevent main-process crash from oversized local test queue file

### Error observed

- Main process crash in app dialog:
  - `Cannot create a string longer than 0x1fffffe8 characters`
  - stack through `node_modules/jsonfile/index.js` while reading queue JSON.

### Root cause

- Local AI queue file exceeded safe JSON string parse size.
- Observed queue file size:
  - `~/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json`
  - `561391774` bytes.

### Changed

- Updated `$WORKSPACE/idena-desktop/main/ai-test-unit.js`:
  - added `MAX_QUEUE_FILE_BYTES` guard (`350 MB` default)
  - if queue file is larger than threshold, rotate file and reset queue to `[]`
  - changed queue save to compact JSON (no pretty spaces)
  - added `MAX_QUEUED_FLIPS` cap (`500` default) and drop-oldest behavior on overflow
  - added dependency overrides for tests: `maxQueueFileBytes`, `maxQueuedFlips`
- Updated `$WORKSPACE/idena-desktop/main/ai-test-unit.test.js`:
  - test for queue cap/drop-oldest behavior
  - test for oversized queue file rotation/reset behavior

### Local recovery actions executed

- Rotated oversized queue file manually:
  - `~/Library/Application Support/Idena/ai-benchmark/test-unit-flips.oversize-manual-1774344098.json`
- Rebuilt queue with smaller payload:
  - 80 flips loaded
  - new queue file size: `144915570` bytes

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-test-unit.js main/ai-test-unit.test.js main/ai-providers/bridge.js renderer/pages/settings/ai.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-test-unit.test.js main/ai-providers/bridge.test.js`
- `python3 - <<'PY'`
- `from pathlib import Path`
- `p=Path('~/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json')`
- `print('exists',p.exists(),'bytes',p.stat().st_size if p.exists() else 0)`
- `PY`

### Result

- Oversized queue crash is mitigated in code and recovered in local data.
- AI queue now loads with safe size.

## 2026-03-24 - Step 16: Fail fast when API key is missing and repopulate queue

### Inspected

- Runtime log excerpt from user showed:
  - `Error occurred in handler for 'ai-solver/command': Error: API key is not set for provider: openai`
- Run artifacts showed prior queue runs were all skipped due missing key after restart.

### Changed

- Updated `$WORKSPACE/idena-desktop/main/ai-providers/bridge.js`:
  - `solveFlipBatch()` now validates provider key up front (`getApiKey(provider)`) before any per-flip execution.
  - prevents silent all-skipped runs when key is not loaded.
  - `runProvider()` accepts injected `apiKey` and uses it if provided.
- Updated `$WORKSPACE/idena-desktop/main/ai-providers/bridge.test.js`:
  - added explicit test: fails fast without key and does not invoke provider.
  - adjusted existing solve tests to set a provider key.

### Commands

- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`
- `cd $WORKSPACE/idena-desktop && python3 scripts/preload_ai_test_unit_queue.py --replace --max-total 80 --input data/flip-challenge-test-200-decoded.json`

### Local state reset

- Refilled queue to continue testing:
  - queue count: `80`
  - queue file size: `144915570` bytes

### Result

- Missing-key runs now fail immediately with clear error, avoiding silent benchmark invalidation.
- Queue is ready for a fresh valid run after setting key in current app session.

## 2026-03-24 - Step 17: Human-consensus audit tooling for local AI runs

### Goal

- User requested human consensus for completed AI run to enable auditing.

### Inspected

- FLIP-Challenge parquet `task_data` fields include `agreed_answer`.
- Local run files:
  - `~/Library/Application Support/Idena/ai-benchmark/test-unit-runs.jsonl`
  - `~/Library/Application Support/Idena/ai-benchmark/session-metrics.jsonl`

### Changed

- Added script:
  - `$WORKSPACE/idena-desktop/scripts/audit_flip_consensus.py`
- Added documentation:
  - `$WORKSPACE/idena-desktop/docs/flip-consensus-audit.md`

### What script does

- Selects a run from `test-unit-runs.jsonl` (default latest).
- Collects corresponding local-test-unit batch entries from `session-metrics.jsonl`.
- Builds consensus map from FLIP-Challenge parquet `agreed_answer`.
- Produces per-flip and aggregate audit metrics.
- Writes JSON report under:
  - `~/Library/Application Support/Idena/ai-benchmark/audits/`

### Command executed

- `cd $WORKSPACE/idena-desktop && python3 scripts/audit_flip_consensus.py --run-index -1 --parquet-dir .tmp/flip-challenge/data`

### Result for latest run

- Report file:
  - `~/Library/Application Support/Idena/ai-benchmark/audits/audit-20260324T093358.252Z.json`
- Summary:
  - `matched=20`
  - `labeled=20`
  - `answered=10`
  - `correct=6`
  - `accuracy_labeled=0.3`
  - `accuracy_answered=0.6`
  - `skipped=10`
  - `rate_limit_errors=10`

## 2026-03-24 - Step 18: 6-flips/60s strict profile + custom provider mode + model presets

### User request

- Clarify rate limits.
- Align strict short-session benchmark with `6 flips / 60 seconds`.
- Add better model options and custom provider configuration for future provider/model tests.

### Inspected

- `main/ai-providers/constants.js`
- `main/ai-providers/bridge.js`
- `main/ai-providers/providers/openai.js`
- `renderer/pages/settings/ai.js`
- `renderer/pages/settings/ai-test-unit.js`
- `renderer/screens/validation/ai/solver-orchestrator.js`
- `renderer/shared/providers/settings-context.js`
- logs in `~/Library/Application Support/Idena/ai-benchmark/session-metrics.jsonl`

### Rate-limit observation

- Parsed recent provider errors from session logs:
  - `rate_limit_exceeded`
  - `Limit 200000, Used 200000, Requested 1670` (TPM on gpt-4o-mini)

### Changed

- Strict benchmark defaults moved to 60s path:
  - `deadlineMs: 60 * 1000`
  - updated in:
    - `main/ai-providers/constants.js`
    - renderer AI defaults (settings, validation, flips/new, solver orchestrator, ai-test-unit)
- Added new provider type:
  - `openai-compatible`
  - defaults + key slot + routing in bridge
- Added custom provider endpoint support:
  - configurable `baseUrl` + `chatPath` passed from renderer to main bridge
  - OpenAI provider module now resolves endpoint dynamically and builds auth headers
- Added model preset options in AI settings UI:
  - OpenAI / OpenAI-compatible presets including higher-tier model ids
  - still keeps editable custom model input
- Added custom provider settings UI fields:
  - provider display name
  - API base URL
  - chat path
- Wired providerConfig through execution paths:
  - AI settings `testProvider`
  - AI test unit queue runs
  - validation short-session orchestrator

### Validation

- Lint:
  - `npx eslint main/ai-providers/constants.js main/ai-providers/providers/openai.js main/ai-providers/bridge.js main/ai-providers/bridge.test.js renderer/shared/providers/settings-context.js renderer/pages/settings/ai.js renderer/pages/settings/ai-test-unit.js renderer/screens/validation/ai/solver-orchestrator.js renderer/pages/validation.js renderer/pages/flips/new.js`
- Tests:
  - `npm test -- --runInBand main/ai-providers/profile.test.js main/ai-providers/bridge.test.js main/ai-test-unit.test.js`
- Result:
  - all tests passed (`12/12`)

### Result

- Strict mode now targets your requested 60-second benchmark window.
- App can test standard OpenAI/Gemini and custom OpenAI-compatible provider endpoints.
- Better model selection is now available directly in settings while preserving custom model IDs.

## 2026-03-24 - Step 19: Diagnose right/skip pattern and add side-bias mitigation

### Diagnosis from latest audit

- File: `~/Library/Application Support/Idena/ai-benchmark/audits/audit-20260324T095524.741Z.json`
- Distribution:
  - consensus: `left=11`, `right=9`
  - predictions: `right=6`, `skip=14`
- Skip root cause:
  - all 14 skips were `429 rate_limit_exceeded` errors
  - message contains: `Limit 200000, Used 200000, Requested 1670`
- Interpretation:
  - run used `20` flips in `4` batches while short-session target is `6`
  - provider was token-rate-limited during latter batches

### Changed

- Added deterministic side-swapping for each flip hash in `main/ai-providers/bridge.js`:
  - swaps left/right payload for half of hashes (checksum parity)
  - remaps model answer back to original orientation
  - purpose: reduce positional right/left bias while preserving reproducibility
- Included `sideSwapped` in per-flip result and benchmark log rows.
- Added tests in `main/ai-providers/bridge.test.js`:
  - verifies remapping when model always answers right
  - adjusted existing tests for deterministic hash behavior

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/bridge.test.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-providers/profile.test.js main/ai-test-unit.test.js`

### Result

- Bias mitigation is active in solver pipeline.
- Test suite remains green (`13/13`).

## 2026-03-24 - Step 20: Add auditable bias diagnostics and balanced side swapping

### Why

- You asked for three concrete hardening points:
  - log `rawAnswerBeforeRemap` and `finalAnswerAfterRemap`
  - enforce exact side-swap balance for short 6-flip runs
  - expose an in-app bias diagnostics panel
- Previous hash-parity swap could produce imbalanced 4/2 or 2/4 split on a 6-flip batch.

### Inspected

- `main/ai-providers/bridge.js`
- `main/ai-providers/bridge.test.js`
- `main/ai-test-unit.js`
- `main/ai-test-unit.test.js`
- `renderer/pages/settings/ai-test-unit.js`

### Changed

- `main/ai-providers/bridge.js`
  - replaced parity-based swap with deterministic balanced swap plan per batch (`buildSwapPlan`)
  - for 6 flips, swap target is now exactly 3
  - each result now carries:
    - `rawAnswerBeforeRemap`
    - `finalAnswerAfterRemap`
    - `sideSwapped`
  - added summary diagnostics block:
    - `swapped`, `notSwapped`
    - `rawLeft/rawRight/rawSkip`
    - `finalLeft/finalRight/finalSkip`
    - `remappedDecisions`, `providerErrors`
  - diagnostics are written to `session-metrics.jsonl`
- `main/ai-test-unit.js`
  - batch summarizer now aggregates diagnostics across all batches
- `renderer/pages/settings/ai-test-unit.js`
  - Last run summary now includes a dedicated diagnostics code block
  - per-batch line now shows compact raw L/R/S and swapped count
- `main/ai-providers/bridge.test.js`
  - updated assertions for raw/final answer fields
  - added test to ensure 6-flip batches are split `swapped=3`, `notSwapped=3`
- `main/ai-test-unit.test.js`
  - mock bridge summary now includes diagnostics
  - run test now asserts aggregated diagnostics in response summary

### Commands

- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`
- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/bridge.test.js main/ai-test-unit.js main/ai-test-unit.test.js renderer/pages/settings/ai-test-unit.js`
- `cd $WORKSPACE/idena-desktop && npx prettier --write main/ai-test-unit.js`
- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/bridge.test.js main/ai-test-unit.js main/ai-test-unit.test.js renderer/pages/settings/ai-test-unit.js`

### Results

- Tests: passed (`12/12`)
- Lint: passed for touched files
- UI now shows auditable raw-vs-final decision metrics without leaving the app.

## 2026-03-24 - Step 21: Live AI solving in validation flow (short + long) with pacing

### Why

- Requested behavior:
  - show flips while AI is solving
  - show which side was chosen and how fast per flip
  - run AI helper in the same flow where short/long sessions are solved
  - reduce 429 risk by sequential processing and explicit delays instead of parallel bursts

### Inspected

- `renderer/pages/validation.js`
- `renderer/screens/validation/ai/solver-orchestrator.js`
- `renderer/pages/settings/ai.js`
- `renderer/shared/providers/settings-context.js`
- `renderer/pages/flips/new.js`
- `renderer/pages/settings/ai-test-unit.js`

### Changed

- Validation orchestrator now supports session-aware solving:
  - added `solveValidationSessionWithAi()` for `short` and `long` sessions
  - keeps existing `solveShortSessionWithAi()` as wrapper for compatibility
- Sequential request execution with pacing:
  - one provider call per flip (no parallel batch burst in validation flow)
  - configurable `interFlipDelayMs` between flips (default `650ms`)
  - `maxConcurrency` default changed to `1` for validation helper settings
- Live progress/events wiring into validation UI:
  - progress stages: `prepared`, `solving`, `solved`, `waiting`, `completed`
  - each solved flip emits hash, answer, confidence, latency, raw/final answer, swap flag
  - answers are applied incrementally in session flow via `ANSWER` events
- AI panel enhancements:
  - visible current flip image pair while solving (left/right preview)
  - visible selected side and per-flip latency
  - visible timeline of recent decisions during run
  - visible raw/final diagnostics summary
- Session coverage:
  - AI run button now appears in short and long solving phases
  - auto mode can trigger per session phase (`short` and `long`) without duplicate reruns
- Settings:
  - added custom field `interFlipDelayMs`
  - copy updated to mention short + long coverage and sequential pacing

### Commands

- `cd $WORKSPACE/idena-desktop && npx prettier --write renderer/pages/validation.js renderer/screens/validation/ai/solver-orchestrator.js`
- `cd $WORKSPACE/idena-desktop && npx eslint renderer/screens/validation/ai/solver-orchestrator.js renderer/pages/validation.js renderer/pages/settings/ai.js renderer/shared/providers/settings-context.js renderer/pages/flips/new.js renderer/pages/settings/ai-test-unit.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed for all touched renderer files.
- Tests passed (`12/12`).
- Validation UI now shows live AI decision stream with image preview and pacing suitable for rate-limit-sensitive benchmarking.

## 2026-03-24 - Step 22: Token tracking per flip for benchmark cost transparency

### Why

- Requested: track token usage per flip to make benchmark cost reporting transparent.

### Inspected

- `main/ai-providers/providers/openai.js`
- `main/ai-providers/providers/gemini.js`
- `main/ai-providers/bridge.js`
- `renderer/screens/validation/ai/solver-orchestrator.js`
- `renderer/pages/validation.js`
- `main/ai-test-unit.js`
- `renderer/pages/settings/ai-test-unit.js`
- `main/ai-providers/bridge.test.js`

### Changed

- Provider adapters now return structured payload `{rawText, usage}`:
  - OpenAI usage mapped from `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`
  - Gemini usage mapped from `usageMetadata.promptTokenCount`, `usageMetadata.candidatesTokenCount`, `usageMetadata.totalTokenCount`
- AI bridge now normalizes provider responses and stores token usage per flip:
  - `tokenUsage.promptTokens`
  - `tokenUsage.completionTokens`
  - `tokenUsage.totalTokens`
- Bridge summary now includes aggregate token totals:
  - `summary.tokens.promptTokens`
  - `summary.tokens.completionTokens`
  - `summary.tokens.totalTokens`
  - `summary.tokens.flipsWithUsage`
- Benchmark JSONL logs now include `tokenUsage` for each flip and summary token totals.
- Validation AI telemetry panel now shows:
  - session token totals
  - per-flip token usage in live timeline and fallback flip rows
- Local AI test unit batch summary now aggregates token totals across batches and displays them in last-run summary.
- Added bridge unit test verifying per-flip + summary token aggregation.

### Commands

- `cd $WORKSPACE/idena-desktop && npx prettier --write main/ai-providers/providers/openai.js main/ai-providers/bridge.js renderer/pages/validation.js`
- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-providers/providers/openai.js main/ai-providers/providers/gemini.js main/ai-providers/bridge.js main/ai-providers/bridge.test.js main/ai-test-unit.js renderer/screens/validation/ai/solver-orchestrator.js renderer/pages/validation.js renderer/pages/settings/ai-test-unit.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed for touched files.
- Tests passed (`13/13`).
- Per-flip token accounting is now persisted and visible in UI telemetry for benchmarking.

## 2026-03-24 - Step 23: Manual flip builder from uploaded single images (for AI tests)

### Why

- Requested: create custom flips directly in the app from uploaded single images, similar to normal flip creation, and use them in AI testing.

### Inspected

- `renderer/pages/settings/ai-test-unit.js`
- `renderer/screens/validation/ai/test-unit-utils.js`
- existing New Flip page flow in `renderer/pages/flips/new.js`

### Changed

- Added new section in AI Test Unit page:
  - `Manual flip builder (single image upload)`
- Builder features:
  - upload up to 4 images from local files
  - preview loaded images with index labels
  - enter custom `left order` and `right order` index sequences
  - optional custom hash
  - `Build and add to queue`
  - `Build and run now`
  - `Clear builder`
- Reused existing image compositor (`composeStoryImage`) to generate protocol-style `leftImage/rightImage` payloads from uploaded images and orders.
- Added robust input validation for order text:
  - exact index count
  - no duplicates
  - index range checks

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/settings/ai-test-unit.js main/ai-providers/providers/openai.js main/ai-providers/providers/gemini.js main/ai-providers/bridge.js main/ai-providers/bridge.test.js renderer/pages/validation.js renderer/screens/validation/ai/solver-orchestrator.js main/ai-test-unit.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed.
- Tests passed (`13/13`).
- You can now create AI-test flips directly from uploaded single images in-app without external JSON tooling.

## 2026-03-24 - Step 24: AI test-unit UX cleanup + live flip stream + strict sequential pacing

### Why

- Requested: `o3` preset was failing with user API access, run feedback was not visible in real time, and JSON-heavy UI blocks were too large/noisy.

### Inspected

- `main/ai-providers/constants.js`
- `main/ai-providers/profile.js`
- `main/ai-providers/bridge.js`
- `main/ai-providers/bridge.test.js`
- `main/ai-test-unit.js`
- `main/ai-test-unit.test.js`
- `main/channels.js`
- `main/index.js`
- `main/preload.js`
- `renderer/pages/settings/ai.js`
- `renderer/pages/settings/ai-test-unit.js`

### Changed

- OpenAI model presets updated in settings:
  - added explicit `gpt-4o` + `gpt-4.1` preset path
  - removed `o3` from default presets (still possible via custom model id)
- Strict benchmark profile hardened for rate-limit safety:
  - `maxConcurrency` set to `1`
  - added strict `interFlipDelayMs=650`
  - custom profile now supports configurable `interFlipDelayMs`
- Provider bridge upgraded for deterministic live progress:
  - per-flip progress callback support (`onFlipResult`)
  - sequential solving path when concurrency is `1`
  - delay inserted between flips according to `interFlipDelayMs`
- AI test-unit IPC event stream added:
  - new channel `ai-test-unit/event`
  - emits `run-start`, `batch-start`, `flip-result`, `batch-complete`, `run-complete`
- Renderer bridge exposed test-unit event subscription:
  - `global.aiTestUnit.onEvent(handler)` in preload
- AI Test Unit page UI updates:
  - new **Live run monitor** with current flip pair preview (left/right images)
  - real-time chosen side, swap marker, latency, and token count
  - compact scrollable event timeline
  - queue list limited height with scrolling
  - JSON ingest moved to optional advanced panel (`Show JSON tools`)
  - JSON textarea height reduced for less screen clutter
  - last-run diagnostics moved behind toggle (`Show diagnostics`)
- Added tests:
  - bridge test validates strict sequential pacing + per-flip progress callback
  - test-unit bridge test validates live progress event emission

### Commands

- `cd $WORKSPACE/idena-desktop && npx prettier --write main/ai-providers/bridge.js renderer/pages/settings/ai-test-unit.js main/ai-test-unit.test.js`
- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-providers/constants.js main/ai-providers/profile.js main/ai-providers/bridge.js main/ai-providers/bridge.test.js main/ai-test-unit.js main/ai-test-unit.test.js main/index.js main/preload.js main/channels.js renderer/pages/settings/ai.js renderer/pages/settings/ai-test-unit.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed on all touched files.
- Tests passed (`15/15`).
- AI test runs now show live flip visuals + decisions while running, with cleaner UI and stricter default pacing for 60s benchmark sessions.

## 2026-03-24 - Step 25: Move bulk/JSON tools into regular flip builder and harden live monitor routing

### Why

- Requested: run benchmark tools inside the standard flip building flow (not only in settings), and fix non-updating live monitor behavior.

### Inspected

- `renderer/pages/flips/new.js`
- `renderer/pages/settings/ai-test-unit.js`
- `main/index.js`
- `main/preload.js`
- `main/ai-test-unit.js`

### Changed

- Added benchmark tooling directly into the regular `/flips/new` submit step:
  - queue controls (`Reload queue`, `Clear queue`, `Run queue`)
  - queue sizing controls (`batch size`, `max flips`, `dequeue`)
  - advanced JSON controls (`Load JSON file`, paste JSON, add/run)
  - live monitor block with current flip pair preview, selected side, latency, token usage, timeline
- Kept one-click AI helper behavior in normal flow:
  - draft AI test before submit remains in submit drawer
  - add-draft-to-test-unit remains in submit drawer
- Hardened live progress delivery:
  - `main/index.js` now broadcasts progress via main-window channel and invoking sender
  - preload event parser now supports both event payload signatures
  - run progress now carries `requestId` to bind renderer updates to the active run
- Updated settings page monitor to use requestId and pre-filled expected totals for immediate feedback when a run starts.

### Commands

- `cd $WORKSPACE/idena-desktop && npx prettier --write main/index.js main/preload.js main/ai-test-unit.js renderer/pages/settings/ai-test-unit.js renderer/pages/flips/new.js`
- `cd $WORKSPACE/idena-desktop && npx eslint main/index.js main/preload.js main/ai-test-unit.js renderer/pages/settings/ai-test-unit.js renderer/pages/flips/new.js main/ai-providers/bridge.js main/ai-providers/constants.js main/ai-providers/profile.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed for all touched files.
- Tests passed (`15/15`).
- Bulk/JSON queue workflow is now available in the normal flip submit step, and live monitor updates are run-scoped and more reliable.

## 2026-03-24 - Step 26: Add 5s benchmark-session popup and per-flip start events (one-by-one flow)

### Why

- Requested: AI test should open a short-session-like solving popup with 5-second countdown, show both sides, show AI side choice in real time, and process flips strictly one by one.

### Inspected

- `renderer/pages/flips/new.js`
- `main/ai-providers/bridge.js`
- `main/ai-test-unit.js`
- `main/ai-providers/bridge.test.js`
- `main/ai-test-unit.test.js`
- `renderer/pages/settings/ai-test-unit.js`

### Changed

- Added per-flip start signaling in provider bridge:
  - new callback path `onFlipStart`
  - emits before each provider call with flip hash + left/right images
- Test-unit runner now forwards `flip-start` progress events to renderer.
- Enforced sequential benchmark processing in local test-unit runner:
  - `maxConcurrency` forced to `1` for test-unit runs
- Added benchmark popup in regular `/flips/new` submit step:
  - opens on `Run queue` / `Run JSON now`
  - 5-second countdown before requests
  - regular solving-style dark panel with two sides visible
  - real-time status for current flip: analyzing -> chosen side + latency + tokens
  - run timeline with per-flip decisions
- Updated builder monitor logic to handle `flip-start` events (not only `flip-result`).
- Updated settings monitor logic to handle `flip-start` state as "analyzing".

### Commands

- `cd $WORKSPACE/idena-desktop && npx prettier --write main/ai-providers/bridge.js main/ai-test-unit.js main/ai-providers/bridge.test.js main/ai-test-unit.test.js renderer/pages/flips/new.js renderer/pages/settings/ai-test-unit.js`
- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-test-unit.js main/ai-providers/bridge.test.js main/ai-test-unit.test.js renderer/pages/flips/new.js renderer/pages/settings/ai-test-unit.js main/index.js main/preload.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed.
- Tests passed (`15/15`).
- AI benchmark runs now open with a 5s countdown popup and render per-flip two-side progress in strict one-by-one order.

## 2026-03-24 - Step 27: De-duplicate settings benchmark UI and keep execution in regular builder

### Why

- Requested: avoid parallel benchmark tooling UIs and keep import/build/run workflow in the regular flip builder used for normal flip creation.

### Inspected

- `renderer/pages/settings/ai-test-unit.js`
- `renderer/pages/flips/new.js`
- `docs/fork-plan.md`

### Changed

- Replaced `/settings/ai-test-unit` content with a lightweight migration page:
  - explains that benchmark operations moved to regular builder flow
  - links to `/flips/new` for queue/JSON/AI benchmark execution
  - links to `/settings/ai` for provider/key configuration
- Left all execution controls in `/flips/new` submit step as the single active benchmark surface.
- Updated plan docs to mark settings route as guidance-only.

### Commands

- `cd $WORKSPACE/idena-desktop && npx prettier --write renderer/pages/settings/ai-test-unit.js`
- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/settings/ai-test-unit.js renderer/pages/flips/new.js main/ai-providers/bridge.js main/ai-test-unit.js main/index.js main/preload.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed.
- Tests passed (`15/15`).
- Benchmark tooling now has a single canonical user flow in regular flip builder, reducing confusion and duplicated UI paths.

## 2026-03-24 - Step 28: Re-align with native app flow (validation/session UX + builder-only entry)

### Why

- Requested: re-check original Idena desktop flow and ensure AI benchmark uses native flip creation/session flow, not a parallel tool experience.

### Inspected

- `renderer/pages/flips/new.js`
- `renderer/pages/validation.js`
- `renderer/screens/flips/components.js`
- `renderer/screens/settings/layout.js`
- `renderer/pages/settings/ai-test-unit.js`

### Changed

- Kept benchmark tooling anchored in the native flip creation route `/flips/new` and added deep-link anchor focus (`?focus=ai-benchmark`).
- Removed `AI Test Unit` as a primary settings tab to avoid an alternate workflow path.
- Updated `/settings/ai-test-unit` route to auto-redirect into regular builder benchmark section.
- Improved benchmark monitor resilience:
  - added fallback hydration from `run()` response batches when live IPC progress stream is delayed/missing
  - reset request id on completion/failure to avoid stale filter edge cases
- Simplified in-page monitor (less clutter) and kept full flip-by-flip visualization in the benchmark session popup.
- Improved popup session view clarity:
  - explicit left/right side labels
  - real-time side highlight for selected AI decision
  - retains 5-second countdown + one-by-one pacing semantics

### Commands

- `cd $WORKSPACE/idena-desktop && npx prettier --write renderer/pages/flips/new.js renderer/pages/settings/ai-test-unit.js renderer/screens/settings/layout.js`
- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/flips/new.js renderer/pages/settings/ai-test-unit.js renderer/screens/settings/layout.js main/ai-test-unit.js main/index.js main/preload.js main/ai-providers/bridge.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed.
- Tests passed (`15/15`).
- Native flow is now clearer: builder-first benchmark operations with one-click session preview and reduced settings duplication.

## 2026-03-24 - Step 29: Restore missing quick-access actions (add flips + session entry)

### Why

- Reported regression: option to add flips looked gone and session access was unclear from the AI Test Unit entry point.

### Inspected

- `renderer/pages/flips/new.js`
- `renderer/pages/settings/ai-test-unit.js`
- `renderer/screens/settings/layout.js`

### Changed

- Restored `AI Test Unit` quick-access tab in settings navigation.
- Reworked `/settings/ai-test-unit` page into a lightweight entry hub:
  - button to open builder benchmark section (`/flips/new?focus=ai-benchmark`)
  - button to open validation preview (`/validation?previewAi=1`)
- Added direct actions inside regular builder benchmark panel:
  - `Add current draft flip to queue`
  - `Run current draft now`
- Kept full benchmark run/session flow in the regular builder path.

### Commands

- `cd $WORKSPACE/idena-desktop && npx prettier --write renderer/pages/flips/new.js renderer/pages/settings/ai-test-unit.js renderer/screens/settings/layout.js`
- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/flips/new.js renderer/pages/settings/ai-test-unit.js renderer/screens/settings/layout.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed.
- Tests passed (`15/15`).
- Missing quick-access path is restored; users can now add draft flips and open session preview directly again.

## 2026-03-24 - Step 30: Fix blank New Flip screen and unblock import/setup when node is offline

### Why

- Reported blocker: `/flips/new` was blank, making it impossible to import/setup flips in practice.

### Root cause hypothesis

- `flipMasterMachine` only leaves `idle` after `SET_EPOCH_NUMBER` from `dna_epoch`.
- With offline/invalid node (`Node version 0.0.0`), `dna_epoch` can be unavailable, so page stayed non-editing and visually blank.
- In early prepare path, keyword source could also be missing/non-array, producing fragile setup behavior.

### Inspected

- `renderer/pages/flips/new.js`
- `renderer/screens/flips/machines.js`

### Changed

- Hardened keyword setup in `prepareFlip`:
  - safe guard for non-array `flipKeyWordPairs`
  - fallback when filtered keyword list is empty
- Added offline epoch bootstrap in `/flips/new`:
  - if `dna_epoch` does not arrive quickly, send `SET_EPOCH_NUMBER` with fallback `0`
  - show explicit `Offline builder mode` notice
- Added manual escape hatch UI when machine is not in `editing`:
  - `Start local builder now` button that immediately unlocks local builder mode

### Commands

- `cd $WORKSPACE/idena-desktop && npx prettier --write renderer/pages/flips/new.js`
- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/flips/new.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed.
- Tests passed (`15/15`).
- Flip setup/import is now reachable even with offline node conditions.

## 2026-03-24 - Step 31: Repair missing keywords, web image search fallback, and internal node download compatibility

### Why

- Reported: missing flip keywords in builder, broken web search, and inability to start/sync internal node on macOS with `idena-go` `v1.1.2` release selection.

### Root cause hypothesis

- Keywords were strictly loaded via local RPC (`bcn_keyWord`) and rendered empty when local node was down.
- DuckDuckGo image package token parsing is brittle and can return empty results due upstream HTML/token changes.
- `idena-go` latest release (`v1.1.2`) has no macOS asset, so downloader selected an invalid URL and could leave an empty temp binary.

### Inspected

- `renderer/shared/utils/utils.js`
- `main/index.js`
- `main/idena-node.js`
- Release metadata:
  - `https://api.github.com/repos/idena-network/idena-go/releases/latest`
  - `https://api.github.com/repos/idena-network/idena-go/releases?per_page=25`

### Changed

- Keyword fallback hardening:
  - `loadKeyword()` now falls back to official legacy dictionary from `idena-go v1.1.2` raw `keywords.json`.
  - Added cached legacy lookup and non-empty placeholder fallback (`keyword-<index>`) if both RPC and remote dictionary fail.
- Web search repair:
  - Added search result normalization to `{image, thumbnail}`.
  - Added fallback provider path: DuckDuckGo first, Openverse second.
  - Added guard for empty query and better warning logs.
- Node downloader repair:
  - Replaced single `latest` asset assumption with compatible-release scan (`/releases?per_page=25`) by platform/arch.
  - macOS now automatically falls back to latest release that actually contains `idena-node-mac` asset.
  - Added stronger download safety checks:
    - validated HTTP status
    - temp file cleanup on failure
    - minimum binary size check to reject empty/corrupt downloads
  - Made update step safer by validating temp binary before overwrite and using `fs.moveSync(..., {overwrite: true})`.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint main/idena-node.js main/index.js renderer/shared/utils/utils.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Dependency/debug notes

- Command:
  - `node - <<'NODE' ... require('./main/idena-node').getRemoteVersion() ... NODE`
- Error summary:
  - `TypeError: getSystemVersion is not a function` from `main/logger.js` when loading Electron-bound logger in plain Node runtime.
- Root cause hypothesis:
  - quick CLI check imported Electron-specific logger path outside Electron context.
- Fix attempt:
  - skipped plain-Node runtime probe; relied on lint + integration path inside Electron dev run.
- Result:
  - no production impact; diagnostics command adjusted as a known limitation.

### Results

- Lint passed.
- Tests passed (`15/15`).
- Builder can show keyword text even without local node RPC.
- Image search has a fallback path when DuckDuckGo token parsing fails.
- Internal node downloader is now compatible-aware and rejects empty temp binaries.

## 2026-03-25 - Step 32: Fix "cannot start session" flow for builder AI run (clear readiness checks + guided error handling)

### Why

- Reported blocker: running draft/session from regular builder failed with a generic IPC error toast (`Error invoking remote method 'ai-solver/command'`), making it unclear how to start.

### Root cause hypothesis

- Builder run paths called `solveFlipBatch` directly without preflight checks for:
  - AI helper enabled state
  - in-memory provider session key presence
- Session-key storage is intentionally memory-only, so after app restart key can be missing and produce low-context IPC errors.

### Inspected

- `renderer/pages/flips/new.js`
- `main/ai-providers/bridge.js`
- `main/index.js`
- `main/preload.js`
- `renderer/pages/_app.js`

### Changed

- Added new AI bridge method `hasProviderKey` in main process and preload bridge.
- Added renderer-side run readiness guard before any builder AI run:
  - fail fast if AI helper is disabled
  - fail fast if provider key is not loaded in memory for selected provider
- Added IPC error formatter in builder page:
  - strips `Error invoking remote method ...` prefix
  - maps missing-key and disabled-helper cases to actionable instructions
- Added automatic redirect to `/settings/ai` on missing-key/disabled cases.
- Added explicit `AI settings` button in regular builder benchmark helper panel.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-providers/bridge.js main/index.js main/preload.js renderer/pages/_app.js renderer/pages/flips/new.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed.
- Tests passed (`15/15`).
- Session start failure path now gives concrete guidance and sends user directly to AI settings when required prerequisites are missing.

## 2026-03-25 - Step 33: Make bulk JSON import permanently visible in New Flip submit step

### Why

- Reported blocker: bulk import was not visible enough and looked missing in the regular builder flow.

### Inspected

- `renderer/pages/flips/new.js`

### Changed

- Removed hidden JSON tools toggle (`Show JSON tools` / `Hide JSON tools`).
- Added always-visible `Bulk JSON import` panel near the top of AI benchmark helper.
- Kept same actions but now permanently visible:
  - `Load JSON file`
  - JSON text area
  - `Clear JSON`
  - `Add JSON to queue`
  - `Run JSON now`
- Kept queue/session monitor below this import panel.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Results

- Lint passed.
- Bulk import is now directly visible without any extra click.

## 2026-03-25 - Step 34: Import 20-flip session pack (6 short + 14 long) and make split visible in UI

### Why

- Requested concrete benchmark setup: exactly 20 imported flips with visible split into short session (6) and long session (14).

### Inspected

- `data/flip-challenge-test-200-decoded.json`
- `renderer/pages/flips/new.js`
- queue file: `~/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json`

### Changed

- Imported 20 flips into local AI benchmark queue (derived from decoded FLIP-Challenge data):
  - composed protocol-decoded images into AI-ready `leftImage` / `rightImage` data URLs
  - queue entries tagged with metadata `sessionPack=short6-long14` and phase (`short`/`long`)
  - exact counts: short `6`, long `14`
- Updated regular builder UI to show session split preview:
  - `Session split preview (20 flips)`
  - short count and list (`6`)
  - long count and list (`14`)

### Commands

- `cd $WORKSPACE/idena-desktop && python3 - <<'PY' ... writes ~/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json ... PY`
- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Results

- Queue now contains exactly 20 prepared flips.
- Split is visible in submit-step benchmark panel so short/long allocation is immediately auditable.

## 2026-03-25 - Step 35: mac-ready inbuilt node pin + no-noise flip flow + visible JSON import

### Why

- Requested:
  - inbuilt node must target `idena-go v1.1.2` and be startable on macOS.
  - adversarial/noise protection should be removed for benchmark UX.
  - JSON import must be clearly visible in regular flip tool flow.

### Inspected

- `main/idena-node.js`
- `renderer/screens/flips/machines.js`
- `renderer/pages/flips/new.js`

### Changed

- Inbuilt node pinning and mac fallback:
  - pinned desktop node updater to `v1.1.2`.
  - switched release lookup to tag-specific endpoint (`releases/tags/v1.1.2`) instead of latest.
  - for macOS arm64 where tagged asset is missing, added local-source build fallback:
    - auto-detect sibling `idena-go` repo
    - run `go build` with `GOTOOLCHAIN=go1.19.13` and `-ldflags "-X main.version=1.1.2"`
    - place output into inbuilt node temp file for normal update flow.
- Removed image-noise dependency from New Flip workflow:
  - `images -> shuffle -> submit` (protect/noise stage skipped).
  - `protectedImages` is now kept in sync with uploaded images.
  - submit/AI test paths now use unified `draftImages` derived from selected images.
- JSON import visibility fix:
  - added always-visible `Bulk JSON import for AI benchmark` panel directly under flip-step navbar.
  - controls available in every step (`load file`, `paste JSON`, `add to queue`, `run now`).
  - removed duplicate large JSON panel from submit block to reduce UI clutter.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint main/idena-node.js renderer/pages/flips/new.js renderer/screens/flips/machines.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Lint passed.
- Tests passed (`16/16`).
- New Flip flow no longer requires adversarial/noise step.
- Bulk JSON import is reachable without navigating deep into legacy submit-only layout.
- Desktop node updater now targets `v1.1.2` and includes macOS arm64 local build fallback.

## 2026-03-25 - Step 36: restore full WASM execution on macOS arm64

### Why

- Temporary no-wasm fallback is not acceptable for chain fidelity.

### Inspected

- `$WORKSPACE/idena-wasm-binding/lib/link_std_darwin.go`
- `$WORKSPACE/idena-go/go.mod`
- local build outputs from `idena-wasm v0.0.30`

### Changed

- Built real `libidena_wasm` for `aarch64-apple-darwin`.
- Added `libidena_wasm_darwin_arm64.a` to local `idena-wasm-binding`.
- Added arm64 linker selector file in binding module and restricted amd64 linker file to `darwin && amd64`.
- Switched `idena-go` to local binding module with arm64 lib via `replace` directive in `go.mod`.
- Added chain helper script `idena-go/scripts/build-node-macos-arm64.sh` for deterministic rebuild.
- Updated desktop node builder (`main/idena-node.js`) to call that script automatically when available.
- Rebuilt inbuilt node binary from this WASM-enabled path and replaced:
  - `~/Library/Application Support/Idena/node/idena-go`

### Commands

- `source "$HOME/.cargo/env" && cd $WORKSPACE/idena-wasm && cargo build --release --target aarch64-apple-darwin`
- `cp $WORKSPACE/idena-wasm/target/aarch64-apple-darwin/release/libidena_wasm.a $WORKSPACE/idena-wasm-binding/lib/libidena_wasm_darwin_arm64.a`
- `source "$HOME/.cargo/env" && $WORKSPACE/idena-go/scripts/build-node-macos-arm64.sh`
- `cd $WORKSPACE/idena-go && GOTOOLCHAIN=go1.19.13 go build -ldflags "-X main.version=1.1.2" -o "~/Library/Application Support/Idena/node/idena-go" .`
- `cd $WORKSPACE/idena-go && GOTOOLCHAIN=go1.19.13 go test ./vm/wasm -count=1`

### Results

- `idena-go version 1.1.2` binary rebuilt with real WASM symbols on macOS arm64.
- `vm/wasm` package tests pass on this machine.

## 2026-03-25 - Step 37: make desktop start resilient to global `NODE_OPTIONS`

### Why

- Shell sessions with `export NODE_OPTIONS=--openssl-legacy-provider` fail to start Electron:
  - `electron: --openssl-legacy-provider is not allowed in NODE_OPTIONS`

### Inspected

- `package.json` start script.

### Changed

- Updated `npm start` script to clear `NODE_OPTIONS` only for Electron launch:
  - from: `dotenv -e .env.local electron .`
  - to: `NODE_OPTIONS= dotenv -e .env.local electron .`

### Commands

- `cd $WORKSPACE/idena-desktop && export NODE_OPTIONS=--openssl-legacy-provider && npm run start`

### Results

- Start command no longer throws the Electron `NODE_OPTIONS` rejection error.

## 2026-03-25 - Step 38: allow manual AI benchmark runs even when global helper toggle is off

### Why

- Reported runtime error in New Flip benchmark flow:
  - `Queue run failed`
  - `AI helper is disabled. Open AI settings, enable AI helper, then retry.`
- This blocked explicit manual benchmark actions although provider key and connectivity were already valid.

### Inspected

- `renderer/pages/flips/new.js`

### Root cause hypothesis

- `ensureAiRunReady()` enforced `aiSolverSettings.enabled === true` for all run paths.
- New Flip benchmark actions (`Run queue`, `Run JSON now`, draft test) are user-triggered manual runs and should not depend on auto-session toggle.

### Changed

- Updated `ensureAiRunReady()` signature and guard:
  - now accepts `{requireEnabled = false}`
  - only throws `AI helper is disabled` when explicitly required.
- Kept provider key checks unchanged.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Results

- Lint passed.
- Manual benchmark runs in `Flips -> New -> Submit` are no longer blocked by the global AI-helper enabled switch.
- Auto-session paths can still enforce `enabled` where required.

## 2026-03-25 - Step 39: labeled accuracy in UI + explicit long session run + privacy video helper

### Why

- Requested additions:
  - show success rate for runs where test flips include known/human consensus answers.
  - provide explicit long session path (14 flips) in benchmark run controls.
  - record next benchmark run as a compact video with stripped metadata.

### Inspected

- `main/ai-test-unit.js`
- `main/ai-test-unit.test.js`
- `renderer/screens/validation/ai/test-unit-utils.js`
- `renderer/pages/flips/new.js`
- `scripts/import_flip_challenge.py`

### Root cause hypothesis

- Existing queue/run payloads only persisted `{hash,leftImage,rightImage}`; consensus labels were dropped during ingest.
- UI had no `summary.evaluation` structure to render accuracy.
- Queue runner had only generic/custom run path and no explicit long-session control.

### Changed

- Added expected-answer data path end-to-end:
  - ingest parser keeps `expectedAnswer` from multiple known input fields.
  - queue sanitizer persists optional `expectedAnswer`.
  - progress events now include `expectedAnswer` and `isCorrect`.
  - run summary now includes `summary.evaluation`:
    - `labeled`, `answered`, `correct`, `correctAnswered`
    - `accuracyLabeled`, `accuracyAnswered`
    - expected-side distribution.
- Updated FLIP-Challenge importer:
  - extracts `expectedAnswer` from `task_data.agreed_answer[0]`.
  - extracts optional `expectedStrength`.
- Updated New Flip benchmark UI:
  - added explicit `Run short (6)` and `Run long (14)` buttons.
  - queue custom run remains available (`Run queue (custom)`).
  - monitor/timeline show expected side and correctness where labels exist.
  - last run summary shows labeled accuracy metrics.
- Added privacy-friendly recording helper:
  - `scripts/record_ai_test_run.sh`
  - records run and emits compact MP4 with `-map_metadata -1`.

### Dependency/build issue log

- Command: `npx eslint main/ai-test-unit.js main/ai-test-unit.test.js renderer/pages/flips/new.js renderer/screens/validation/ai/test-unit-utils.js`
- Error summary:
  - `no-continue` in evaluation loop.
  - `no-nested-ternary` in run preset and live text rendering.
  - prettier formatting violations.
- Root cause hypothesis:
  - new logic used concise ternary/continue patterns disallowed by repo lint rules.
- Fix attempt:
  - replaced continue with guarded block.
  - extracted helper formatters (`benchmarkPresetToLabel`, `expectedSuffix`).
  - applied eslint autofix.
- Result:
  - lint clean on changed files.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-test-unit.js main/ai-test-unit.test.js renderer/pages/flips/new.js renderer/screens/validation/ai/test-unit-utils.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-test-unit.test.js main/ai-providers/bridge.test.js`
- `cd $WORKSPACE/idena-desktop && python3 scripts/import_flip_challenge.py --split test --max-flips 5 --output data/flip-challenge-test-5-decoded-labeled.json`

### Results

- Labeled benchmark runs now expose accuracy directly in the app summary.
- Long session can be started explicitly from the same benchmark control row.
- FLIP-Challenge imports now include expected consensus answer, enabling immediate auditability.
- Recording helper script added for privacy-oriented test-run capture.

## 2026-03-25 - Step 40: advanced uncertainty controls, no-skip mode, second-pass reasoning, and live total runtime counter

### Why

- Requested:
  - tune uncertainty level and solver behavior in detail.
  - allow advanced custom controls (prompt/tokens/timing/delay).
  - prefer no final skip by running an additional reasoning pass when time remains.
  - show total run length continuously after session start, also in offline benchmark flow.

### Inspected

- `main/ai-providers/constants.js`
- `main/ai-providers/profile.js`
- `main/ai-providers/prompt.js`
- `main/ai-providers/bridge.js`
- `main/ai-providers/providers/openai.js`
- `main/ai-providers/providers/gemini.js`
- `renderer/shared/providers/settings-context.js`
- `renderer/pages/settings/ai.js`
- `renderer/screens/validation/ai/solver-orchestrator.js`
- `renderer/pages/flips/new.js`

### Changed

- Added advanced profile fields across backend + renderer settings:
  - `temperature`
  - `forceDecision`
  - `uncertaintyRepromptEnabled`
  - `uncertaintyConfidenceThreshold`
  - `uncertaintyRepromptMinRemainingMs`
  - `uncertaintyRepromptInstruction`
  - `promptTemplateOverride`
- Extended profile sanitization and limits for numeric/boolean/text fields.
- Prompt system upgrade:
  - prompt now adapts to first pass vs second-pass uncertainty review.
  - optional prompt override with placeholders:
    - `{{hash}}`
    - `{{allowSkip}}`
    - `{{secondPass}}`
    - `{{allowedAnswers}}`
- Provider request behavior:
  - OpenAI and Gemini now use configurable `temperature`.
- Uncertainty pipeline in solver bridge:
  - first pass run
  - optional second pass when uncertain and enough remaining time
  - optional forced non-skip fallback decision when configured
  - merged token usage across multiple passes
  - logs/metrics include second-pass and force-decision markers
- Desktop UI:
  - added advanced controls in `Settings -> AI` (custom profile mode)
  - added live `runtime` counter (wall-clock) in benchmark monitor and session modal in `Flips -> New -> Submit`

### Dependency/build issue log

- Command: `npx eslint ...`
- Error summary:
  - prettier formatting violations after large multi-file refactor.
- Root cause hypothesis:
  - style drift from manual edits and conditional expressions.
- Fix attempt:
  - `npx eslint --fix` on affected files.
- Result:
  - lint clean.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-providers/constants.js main/ai-providers/profile.js main/ai-providers/prompt.js main/ai-providers/providers/openai.js main/ai-providers/providers/gemini.js main/ai-providers/bridge.js main/ai-providers/profile.test.js main/ai-providers/bridge.test.js renderer/shared/providers/settings-context.js renderer/pages/settings/ai.js renderer/pages/flips/new.js renderer/screens/validation/ai/solver-orchestrator.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/profile.test.js main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- Advanced uncertainty strategy is configurable in UI.
- No-skip mode is supported via force-decision with second-pass option.
- Prompt customization per test run is available through override template.
- Live total runtime counter is visible during active offline benchmark session runs.

## 2026-03-25 - Step 41: flip vision mode toggle (composite vs frame-by-frame, including two-pass frame reasoning)

### Why

- Requested capability: tweak whether AI judges a flip using 2 composed story images or by analyzing each frame first and then building a story.
- Requirement: setting must affect real solver execution, not only saved config.

### Inspected

- `main/ai-providers/bridge.js`
- `main/ai-providers/prompt.js`
- `main/ai-providers/providers/openai.js`
- `main/ai-providers/providers/gemini.js`
- `main/ai-test-unit.js`
- `renderer/screens/validation/ai/solver-orchestrator.js`
- `renderer/screens/validation/ai/test-unit-utils.js`
- `renderer/pages/settings/ai.js`
- `renderer/shared/providers/settings-context.js`
- `renderer/pages/flips/new.js`
- `renderer/pages/validation.js`
- `main/ai-providers/bridge.test.js`
- `main/ai-providers/profile.test.js`

### Changed

- Added persistent solver setting `flipVisionMode` with values:
  - `composite`
  - `frames_single_pass`
  - `frames_two_pass`
- Added UI control in `Settings -> AI` for selecting flip vision mode.
- Extended prompt pipeline:
  - decision prompt for composite mode.
  - decision prompt for frame-by-frame single pass (8 frames: left1-4, right5-8).
  - dedicated frame-reasoning phase prompt.
  - dedicated decision-from-frame-reasoning prompt.
- Extended provider payloads to support variable image counts (`flip.images`) and text-only requests.
- Extended bridge execution:
  - resolves requested/applied vision mode per flip.
  - automatic fallback to `composite` when frame payload is missing.
  - `frames_two_pass` now does:
    1. frame reasoning call,
    2. decision call using returned reasoning JSON.
  - logs and results now include:
    - `flipVisionModeRequested`
    - `flipVisionModeApplied`
    - `flipVisionModeFallback`
    - `frameReasoningUsed`
- Extended test-unit data path:
  - queue accepts/persists optional `leftFrames/rightFrames`.
  - decoded/protocol/local JSON conversion now generates/preserves frame arrays.
- Extended renderer execution payloads:
  - validation orchestrator now prepares `leftFrames/rightFrames` for frame modes.
  - flip builder run payload now forwards `flipVisionMode`.

### Dependency/build issue log

- Command: `npx eslint ...`
- Error summary:
  - prettier formatting violations in `bridge.js`, `prompt.js`, `ai-test-unit.js`, `solver-orchestrator.js`.
- Root cause hypothesis:
  - large logic patch inserted with formatting drift.
- Fix attempt:
  - ran `npx prettier --write` on affected files.
  - reran lint.
- Result:
  - lint clean.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/bridge.test.js main/ai-providers/prompt.js main/ai-providers/providers/openai.js main/ai-providers/providers/gemini.js main/ai-test-unit.js renderer/screens/validation/ai/solver-orchestrator.js renderer/screens/validation/ai/test-unit-utils.js renderer/pages/settings/ai.js renderer/pages/flips/new.js renderer/pages/validation.js renderer/shared/providers/settings-context.js main/ai-providers/profile.js main/ai-providers/profile.test.js`
- `cd $WORKSPACE/idena-desktop && npx prettier --write main/ai-providers/bridge.js main/ai-providers/prompt.js main/ai-test-unit.js renderer/screens/validation/ai/solver-orchestrator.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/profile.test.js main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- AI solver can now be switched between composed-story and frame-by-frame strategies.
- Frame strategy supports both one-pass and two-pass (reasoning + decision) execution.
- Import/queue/runtime paths now carry frame payloads required by frame-by-frame analysis.
- Lint and focused tests pass after implementation.

## 2026-03-25 - Step 42: GPT-5.x model presets + pre-run short/long session cost estimation

### Why

- Requested:
  - make latest OpenAI models (GPT-5.3 / GPT-5.4 family) selectable in UI presets.
  - estimate token cost before starting runs (especially short session 6 flips), since pricing differs per model.

### Inspected

- `renderer/pages/settings/ai.js`
- `renderer/pages/flips/new.js`
- Existing run payload and summary token paths in:
  - `main/ai-test-unit.js`
  - `main/ai-providers/bridge.js`

### Changed

- Added GPT-5.x presets in AI settings model dropdowns (`openai`, `openai-compatible`):
  - `gpt-5.4`
  - `gpt-5.3-chat-latest`
  - `gpt-5.3-codex`
  - `gpt-5-mini`
  - plus existing 4.x/o4 presets.
- Added pre-run cost estimator panel in regular builder benchmark section (`Flips -> New -> Submit`):
  - shows model pricing basis (when known).
  - shows expected and worst-case token/cost estimates for:
    - short (6)
    - long (14)
    - custom (current max flips)
  - estimation basis indicates:
    - `last_run` (if matching provider/model token history exists), or
    - `heuristic` (mode-aware fallback by `flipVisionMode` and output limits).
- Added internal OpenAI pricing map for common models and snapshot-prefix matching (e.g. dated snapshots).

### Dependency/build issue log

- Command: `npx eslint ...`
- Error summary:
  - `no-template-curly-in-string` due i18n text using `$ {{...}}` style.
  - prettier wrapping issues in long template lines.
- Root cause hypothesis:
  - string interpolation marker accidentally interpreted as JS template expression.
- Fix attempt:
  - switched to named i18n placeholders without `${...}` pattern and preformatted USD values.
  - ran prettier on touched file.
- Result:
  - lint clean.

### Commands

- `cd $WORKSPACE/idena-desktop && npx prettier --write renderer/pages/flips/new.js`
- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/settings/ai.js renderer/pages/flips/new.js main/ai-providers/bridge.js main/ai-providers/prompt.js main/ai-providers/providers/openai.js main/ai-providers/providers/gemini.js main/ai-test-unit.js renderer/screens/validation/ai/solver-orchestrator.js renderer/screens/validation/ai/test-unit-utils.js main/ai-providers/profile.js main/ai-providers/profile.test.js renderer/pages/validation.js renderer/shared/providers/settings-context.js`
- `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/profile.test.js main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Results

- GPT-5.3/GPT-5.4 can now be selected from presets directly.
- Cost preview is visible before run start, including short session (6 flips) projection.
- Estimation adapts to selected vision mode and uncertainty settings; uses actual last-run token usage when available.

## 2026-03-25 - Step 43: hotfix for compile error in flips/new.js (numeric separator syntax)

### Why

- Runtime compile popup reported parser failure in `pages/flips/new.js` around the new cost helper function.

### Inspected

- `renderer/pages/flips/new.js`

### Root cause

- Old parser/babel path in this desktop stack rejected numeric separator syntax (`1_000_000`).

### Changed

- Replaced `1_000_000` with `1000000` in `toUsdFromTokens()`.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Result

- File lint is clean.
- Compile blocker removed for this syntax path.

## 2026-03-26 - Step 44: session-auto full automation until human reporting handoff

### Why

- Requested behavior:
  - AI solver should run full auto for short + long flip choice solving.
  - reporting/relevance in long session must stay human-only.
  - app should hand over clearly at reporting phase.

### Inspected

- `renderer/pages/validation.js`
- `renderer/screens/validation/machine.js`

### Changed

- Added auto-mode orchestration state in `validation.js`:
  - `awaitingHumanReporting` flag.
- Added auto long-session start in session-auto mode:
  - when state enters `longSession.solve.answer.welcomeQualification`, send `START_LONG_SESSION`.
- Extended post-run behavior:
  - short session unchanged: auto `SUBMIT` after AI answers.
  - long session: after AI completes flip choices, auto `FINISH_FLIPS`, auto `START_KEYWORDS_QUALIFICATION`, then stop for human reporting.
- Added explicit human handoff toast in long keywords stage:
  - informs operator to manually complete report/approve and submit long session.

### Commands

- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/validation.js`
- `cd $WORKSPACE/idena-desktop && npx prettier --write renderer/pages/validation.js`
- `cd $WORKSPACE/idena-desktop && npx eslint renderer/pages/validation.js`

### Result

- Session-auto now enters long flip-solving automatically.
- AI no longer requires manual click-through to reach long flips.
- After long flip choices are done, the flow transitions into human-only reporting stage and waits for manual decisions/submission.

## 2026-03-26 - Step 45: optional multi-provider ensemble (2-3 APIs, averaged probabilities)

### Why

- Requested: optional consulting of two or three AI APIs in parallel per flip and final decision by probability averaging.

### Inspected

- `main/ai-providers/bridge.js`
- `main/ai-providers/bridge.test.js`
- `renderer/screens/validation/ai/solver-orchestrator.js`
- `renderer/pages/settings/ai.js`
- `renderer/pages/flips/new.js`
- `renderer/shared/providers/settings-context.js`
- `main/ai-test-unit.js`

### Changed

- Added ensemble provider normalization and deduplication in bridge:
  - primary provider/model + optional consultant #2/#3, max 3 total.
- Added per-consultant parallel calls per pass (`Promise.all`) and aggregated decision output:
  - converts each consultant answer+confidence into left/right/skip distribution.
  - averages probabilities across successful consultants.
  - picks max-probability side as final answer.
- Preserved backward-compatible single-provider diagnostics fields:
  - `rawAnswerBeforeRemap`
  - `finalAnswerAfterRemap`
- Added ensemble metadata in results/logs:
  - `consultedProviders`
  - `ensembleProbabilities`
  - `ensembleContributors`
  - `ensembleConsulted`
- Added settings fields + UI controls:
  - `ensembleEnabled`
  - consultant #2/#3 enable/provider/model selectors.
- Wired consult providers from UI into both:
  - validation solver orchestrator
  - flips/new benchmark payloads
- Added/updated tests for ensemble behavior and key validation.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx prettier --check main/ai-providers/bridge.js main/ai-providers/bridge.test.js renderer/pages/settings/ai.js renderer/screens/validation/ai/solver-orchestrator.js renderer/pages/flips/new.js renderer/shared/providers/settings-context.js main/ai-test-unit.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --quiet main/ai-providers/bridge.js main/ai-providers/bridge.test.js renderer/pages/settings/ai.js renderer/screens/validation/ai/solver-orchestrator.js renderer/pages/flips/new.js renderer/shared/providers/settings-context.js main/ai-test-unit.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Result

- Ensemble mode is implemented and optional.
- The app can now consult up to 3 providers/models per flip and decide using averaged probabilities.
- Targeted lint/format/tests are green (`23 passed`).

## 2026-03-26 - Step 46: FLIP paper review + weighted ensemble calibration for newer models

### Why

- Requested to read `/Users/jz/Downloads/2504.12256v1.pdf` and optimize while staying compatible with newer model generations.

### Inspected

- Paper: `/Users/jz/Downloads/2504.12256v1.pdf` (FLIP Reasoning Challenge, arXiv:2504.12256v1)
- Relevant findings extracted:
  - caption-first reasoning can outperform direct image-only prompting.
  - ensemble methods improve performance over single models.
  - weighted/subset ensembles outperform naive all-model voting.
- Code paths:
  - `main/ai-providers/bridge.js`
  - `main/ai-providers/bridge.test.js`
  - `renderer/pages/settings/ai.js`
  - `renderer/screens/validation/ai/solver-orchestrator.js`
  - `renderer/pages/flips/new.js`
  - `renderer/shared/providers/settings-context.js`
  - `renderer/pages/validation.js`
  - `main/ai-test-unit.js`

### Changed

- Added weighted ensemble support (optional, defaults keep equal averaging):
  - `ensemblePrimaryWeight` for consultant #1.
  - `weight` for consultant #2/#3.
- Aggregation now computes weighted average probabilities for left/right/skip.
- Ensemble metadata extended with total weight in results/logs.
- AI settings UI now exposes per-consultant weight fields.
- Validation orchestrator and regular builder benchmark payloads now pass weights.
- Local test-unit run logs now include ensemble weights.
- Added optimization note doc from paper review:
  - `docs/flip-reasoning-paper-optimizations.md`
- Updated fork plan entry to include weighted calibration for future/new models.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx prettier --write main/ai-providers/bridge.js main/ai-providers/bridge.test.js renderer/pages/settings/ai.js renderer/pages/flips/new.js renderer/screens/validation/ai/solver-orchestrator.js renderer/shared/providers/settings-context.js renderer/pages/validation.js main/ai-test-unit.js docs/fork-plan.md docs/flip-reasoning-paper-optimizations.md`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --quiet main/ai-providers/bridge.js main/ai-providers/bridge.test.js renderer/pages/settings/ai.js renderer/pages/flips/new.js renderer/screens/validation/ai/solver-orchestrator.js renderer/shared/providers/settings-context.js renderer/pages/validation.js main/ai-test-unit.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Result

- Weighted ensemble is active and configurable from the UI.
- Backward behavior remains stable when all weights stay at `1.0`.
- Targeted checks pass (`24` tests total, all passing).

## 2026-03-26 - Step 47: major provider expansion + latest-model check in AI settings

### Why

- Requested to wire major AI platforms beyond OpenAI/Gemini and add an option to check latest models.

### Inspected

- `main/ai-providers/constants.js`
- `main/ai-providers/providers/openai.js`
- `main/ai-providers/providers/gemini.js`
- `main/ai-providers/bridge.js`
- `main/index.js`
- `main/preload.js`
- `renderer/pages/_app.js`
- `renderer/pages/settings/ai.js`
- `renderer/pages/flips/new.js`
- `renderer/screens/validation/ai/solver-orchestrator.js`
- `main/ai-providers/bridge.test.js`

### Changed

- Added first-class providers:
  - `anthropic`, `xai`, `mistral`, `groq`, `deepseek`, `openrouter`
  - retained `openai`, `gemini`, `openai-compatible`
- Added provider default model + endpoint config registry in constants.
- Added native Anthropic provider adapter:
  - message call
  - provider test call
  - model list call
- Extended OpenAI-compatible adapter with model list support (`GET /models`) and optional extra headers.
- Extended Gemini adapter with model list support (`GET /v1beta/models`) and normalization.
- Bridge now supports:
  - all providers in key management
  - provider-aware routing for solve/test/list-models
  - new command `listModels` returning normalized model IDs
- IPC/preload/UI bridge updates:
  - exposed `aiSolver.listModels(...)`
  - added `listModels` command handling in main process
- AI settings UI updates:
  - provider dropdown expanded to major platforms
  - ensemble consultant provider options expanded
  - new button `Check latest models`
  - live model catalog merged into model preset selectors
- Guarded provider config passing so custom endpoint overrides are only applied to `openai-compatible` provider.

### Dependency/build issue log

- Command:
  - `npx prettier --write ...`
- Error summary:
  - parse error in `main/ai-providers/constants.js` (`Unexpected token` near `OPENAI_COMPATIBLE_PROVIDERS`)
- Root-cause hypothesis:
  - array closing bracket typo (`}` instead of `]`).
- Fix attempt:
  - corrected bracket, reran format/lint/tests.
- Result:
  - issue resolved.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx prettier --write main/ai-providers/constants.js main/ai-providers/providers/openai.js main/ai-providers/providers/anthropic.js main/ai-providers/providers/gemini.js main/ai-providers/bridge.js main/ai-providers/bridge.test.js main/index.js main/preload.js renderer/pages/_app.js renderer/pages/settings/ai.js renderer/pages/flips/new.js renderer/screens/validation/ai/solver-orchestrator.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --quiet main/ai-providers/constants.js main/ai-providers/providers/openai.js main/ai-providers/providers/anthropic.js main/ai-providers/providers/gemini.js main/ai-providers/bridge.js main/ai-providers/bridge.test.js main/index.js main/preload.js renderer/pages/_app.js renderer/pages/settings/ai.js renderer/pages/flips/new.js renderer/screens/validation/ai/solver-orchestrator.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Result

- Major provider options are now available in settings and ensemble selectors.
- App can query and load latest model catalogs from provider APIs.
- Targeted checks pass (`27` tests total, all passing).

## 2026-03-26 - Step 48: one-click latest-model scan across all providers

### Why

- Requested to make latest-model checks practical across all major providers, not only one provider at a time.

### Inspected

- `renderer/pages/settings/ai.js`

### Changed

- Added a second action button in AI settings:
  - `Check all providers`
- This runs sequential model discovery for all configured providers in the dropdown.
- Added per-run summary toast:
  - loaded provider count
  - skipped/failed provider count (for missing keys or provider-side failures)
- Kept single-provider action (`Check latest models`) intact and disabled conflicting button while the other is running.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx prettier --write renderer/pages/settings/ai.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --quiet renderer/pages/settings/ai.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Result

- AI settings now supports both:
  - quick refresh for currently selected provider
  - one-click refresh across all providers
- Targeted checks remain passing (`27` tests total, all passing).

## 2026-03-26 - Step 49: legacy heuristic strategy added as weighted ensemble consultant

### Why

- Requested to add the old/legacy approach as an additional strategy that can participate in averaged voting with one or multiple AI providers.

### Inspected

- `main/ai-providers/bridge.js`
- `main/ai-providers/bridge.test.js`
- `renderer/pages/settings/ai.js`
- `renderer/screens/validation/ai/solver-orchestrator.js`
- `renderer/pages/flips/new.js`
- `renderer/pages/validation.js`
- `renderer/shared/providers/settings-context.js`

### Changed

- Added internal solver strategy module:
  - `main/ai-providers/providers/legacy-heuristic.js`
  - strategy id: `legacy-heuristic`
  - local frame-continuity heuristic with deterministic fallback
  - no cloud API dependency, no token usage
- Bridge integration:
  - new payload flags:
    - `legacyHeuristicEnabled`
    - `legacyHeuristicWeight`
  - strategy is injected as an additional consultant into ensemble averaging
  - consultant cap increased from `3` to `4` so provider ensemble + legacy strategy can coexist
- UI/settings wiring:
  - new AI settings controls:
    - `Legacy heuristic vote` toggle
    - `Legacy heuristic weight`
  - defaults added across settings, validation page fallback defaults, and flip-builder run payloads
- Added test coverage:
  - verifies legacy heuristic is included in `consultedProviders`
  - verifies weighted consultant metadata and ensemble counts

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx prettier --write main/ai-providers/bridge.js main/ai-providers/providers/legacy-heuristic.js main/ai-providers/bridge.test.js renderer/pages/settings/ai.js renderer/shared/providers/settings-context.js renderer/screens/validation/ai/solver-orchestrator.js renderer/pages/flips/new.js renderer/pages/validation.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --quiet main/ai-providers/bridge.js main/ai-providers/providers/legacy-heuristic.js main/ai-providers/bridge.test.js renderer/pages/settings/ai.js renderer/shared/providers/settings-context.js renderer/screens/validation/ai/solver-orchestrator.js renderer/pages/flips/new.js renderer/pages/validation.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Result

- Legacy strategy can now be combined with:
  - single provider runs (provider + legacy weighted vote)
  - multi-provider ensemble runs (providers + legacy weighted vote)
- Targeted checks pass (`28` tests total, all passing).

## 2026-03-26 - Step 50: legacy-only mode (no API key) for local heuristic runs

### Why

- Reported issue: even with only legacy heuristic enabled, builder runs still requested cloud API key.

### Inspected

- `main/ai-providers/bridge.js`
- `main/ai-providers/bridge.test.js`
- `renderer/pages/settings/ai.js`
- `renderer/pages/flips/new.js`
- `renderer/screens/validation/ai/solver-orchestrator.js`
- `renderer/shared/providers/settings-context.js`
- `renderer/pages/validation.js`

### Changed

- Added new setting/payload flag:
  - `legacyHeuristicOnly`
- Bridge behavior update:
  - when `legacyHeuristicEnabled=true` and `legacyHeuristicOnly=true`
    - skip primary cloud consultant
    - run only internal `legacy-heuristic` consultant
    - do not require provider API key
    - report run provider/model as `legacy-heuristic` / `legacy-heuristic-v1`
- UI update:
  - new toggle in AI settings: `Legacy-only run mode`
- Builder preflight update:
  - API key check is skipped in legacy-only mode
- Test coverage:
  - added test ensuring legacy-only runs succeed without any provider key

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx prettier --write main/ai-providers/bridge.js main/ai-providers/bridge.test.js renderer/pages/settings/ai.js renderer/shared/providers/settings-context.js renderer/pages/flips/new.js renderer/pages/validation.js renderer/screens/validation/ai/solver-orchestrator.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --quiet main/ai-providers/bridge.js main/ai-providers/bridge.test.js renderer/pages/settings/ai.js renderer/shared/providers/settings-context.js renderer/pages/flips/new.js renderer/pages/validation.js renderer/screens/validation/ai/solver-orchestrator.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-test-unit.test.js`

### Result

- Legacy heuristic can now run standalone without cloud keys when legacy-only mode is enabled.
- Targeted checks pass (`29` tests total, all passing).

## 2026-03-26 - Step: Preserve consensus labels when preloading AI test queue

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/scripts/preload_ai_test_unit_queue.py`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-test-unit.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/.tmp/flip-challenge/flip-challenge-test-200-decoded.json`

### Changed

- Patched preload script so queue entries preserve consensus fields from import JSON:
  - `expectedAnswer` (normalized to `left|right|skip`)
  - `expectedStrength` (if present)
- Refilled queue with 200 FLIP-Challenge items from decoded import.

### Why

- Audit mode requires known expected outcomes to calculate correctness and accuracy after each run.
- Previously the preload script removed `expectedAnswer`, making post-run consensus checks impossible.

### Commands

- `python3 -m py_compile /Users/jz/Documents/idena-benchmark-workspace/idena-desktop/scripts/preload_ai_test_unit_queue.py`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && python3 scripts/preload_ai_test_unit_queue.py --input .tmp/flip-challenge/flip-challenge-test-200-decoded.json --replace --max-total 200 --source flip-challenge-import`
- `python3 - <<'PY'`
- `import json, collections`
- `from pathlib import Path`
- `p=Path('/Users/jz/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json')`
- `q=json.loads(p.read_text())`
- `answers=collections.Counter((item.get('expectedAnswer') or 'missing') for item in q)`
- `print('queue_total',len(q),dict(answers))`
- `PY`

### Result

- Queue contains 200 flips with consensus labels.
- Label distribution currently loaded:
  - `right: 108`
  - `left: 92`
- These entries are now ready for audited benchmarking in AI Test Unit.

## 2026-03-26 - Step: Fix OpenAI provider test failures (400 unsupported_parameter)

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/providers/openai.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/settings/ai.js`

### Changed

- Patched OpenAI adapter to handle cross-model parameter compatibility:
  - Added compatibility payload variants for chat requests.
  - Added fallback retry path for `400 unsupported_parameter` style errors.
  - Added support to fall back from `max_tokens` to `max_completion_tokens`.
  - Added fallback variants that remove `response_format` and `temperature` when needed.
- Made provider config handling null-safe in OpenAI adapter helper functions.
- Simplified provider connection test payload for OpenAI to minimal, broadly-compatible fields:
  - now sends only `model` + `messages` (no fixed `temperature`/`max_tokens`).
- Added regression tests:
  - `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/providers/openai.test.js`

### Why

- Legit API keys were failing test with `openai test failed (400 unsupported_parameter)` on some model families.
- Newer and reasoning-oriented models vary in supported request parameters.
- The desktop benchmark app must be robust across model generations without requiring manual parameter tweaking.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx prettier --write main/ai-providers/providers/openai.js main/ai-providers/providers/openai.test.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --quiet main/ai-providers/providers/openai.js main/ai-providers/providers/openai.test.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/providers/openai.test.js main/ai-providers/bridge.test.js`

### Result

- OpenAI adapter now gracefully retries with compatible parameter sets when a model rejects specific fields.
- Targeted test suites pass:
  - `2` suites
  - `27` tests
  - all passing

## 2026-03-26 - Step: Queue visibility fix for 200-flip imports

### Inspected

- `/Users/jz/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json`
- `/Users/jz/Library/Logs/Electron/idena.log`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-test-unit.js`

### Changed

- Increased AI test-unit queue file safety threshold:
  - from `350 * 1024 * 1024`
  - to `400 * 1024 * 1024`
- Refilled queue with 200 consensus-labeled flips after threshold adjustment.

### Why

- Queue appeared empty because the app rotated `test-unit-flips.json` as oversized.
- Actual imported file size was ~358MB, slightly above old 350MB limit.
- 400MB keeps current 200-flip payload visible while still blocking older oversized (~535MB) payloads that caused runtime instability.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --quiet main/ai-test-unit.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-test-unit.test.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && python3 scripts/preload_ai_test_unit_queue.py --input .tmp/flip-challenge/flip-challenge-test-200-decoded.json --replace --max-total 200 --source flip-challenge-import`

### Result

- Queue file now contains 200 flips again.
- App restart is required so main process picks up updated `MAX_QUEUE_FILE_BYTES` and stops rotating this queue file.

## 2026-03-26 - Step: Fix failing JSON import in flip builder (large files)

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/validation/ai/test-unit-utils.js`
- `/Users/jz/Library/Logs/Electron/idena.log`

### Changed

- Added lazy JSON file source handling in builder JSON tools:
  - large files are no longer forced into textarea state
  - file reference can be loaded and parsed on demand
- Added chunked JSON normalization + queue ingest path to reduce renderer/main IPC payload spikes:
  - `normalizeInputFlipsInChunks(raw, {chunkSize, onChunk})`
  - queue ingest now sends chunked `addFlips` calls instead of one giant payload
- Updated button enable logic so file-loaded source works even with empty textarea.
- Kept existing inline JSON paste path unchanged.

### Why

- JSON imports could fail when large payloads were loaded as one giant in-memory textarea string and then sent as one large IPC payload.
- Chunked processing keeps memory and IPC safer for big benchmark packs.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --quiet renderer/pages/flips/new.js renderer/screens/validation/ai/test-unit-utils.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx prettier --check renderer/pages/flips/new.js renderer/screens/validation/ai/test-unit-utils.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-test-unit.test.js main/ai-providers/providers/openai.test.js`

### Result

- Builder JSON import path now supports large file workflow more reliably.
- Targeted lint/format/tests all pass.

## 2026-03-26 - Step: Cost check + fresh non-overlapping flip pack loaded

### Inspected

- `/Users/jz/Library/Application Support/Idena/ai-benchmark/test-unit-runs.jsonl`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`

### Result snapshot (latest long run)

- provider/model: `openai/gpt-5.4`
- flips: `14`
- tokens:
  - prompt: `28257`
  - completion: `601`
  - total: `28858`
- estimated cost (pricing table in app):
  - input: `$0.070642`
  - output: `$0.009015`
  - total: `$0.079657`

### New flips loaded for repeat benchmark

- Generated non-overlapping pack:
  - `scripts/import_flip_challenge.py --skip-flips 200 --max-flips 200`
  - output: `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/.tmp/flip-challenge/flip-challenge-test-200-skip200-decoded.json`
- Replaced queue with this fresh pack:
  - `/Users/jz/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json`
  - queue size: `200`
  - labels: `left=91`, `right=109`

## 2026-03-26 - Step: Clarify audit-unavailable state + reload labeled queue

### Inspected

- `/Users/jz/Library/Application Support/Idena/ai-benchmark/test-unit-runs.jsonl`
- `/Users/jz/Library/Application Support/Idena/ai-benchmark/test-unit-flips.json`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`

### Findings

- Latest run had `labeled=0`, so no audit metrics could be computed.
- Queue was empty at inspection time (likely due `dequeue=true` on previous run).

### Changed

- UI summary now shows explicit message when audit is unavailable because `expectedAnswer` labels are missing.
  - file: `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- Reloaded queue with known-consensus flips from non-overlapping dataset slice.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --quiet renderer/pages/flips/new.js renderer/screens/validation/ai/test-unit-utils.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-test-unit.test.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && python3 scripts/preload_ai_test_unit_queue.py --input .tmp/flip-challenge/flip-challenge-test-200-skip200-decoded.json --replace --max-total 200 --source flip-challenge-import-skip200`

### Result

- Queue reloaded: `200` flips with labels (`left=91`, `right=109`).
- Audit availability is now clearly communicated in UI when labels are absent.

## 2026-03-30 - Step: AI-assisted flip generation flow in regular builder

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/providers/openai.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/index.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/preload.js`

### Changed

- Added new AI provider bridge commands:
  - `generateStoryOptions`: returns two structured story alternatives from current keyword pair.
  - `generateFlipPanels`: builds four panel images, supports full regenerate and per-panel regenerate.
- Added OpenAI-compatible image generation adapter (`/images/generations`) with data-URL output.
- Wired new commands through IPC and preload:
  - `global.aiSolver.generateStoryOptions(payload)`
  - `global.aiSolver.generateFlipPanels(payload)`
- Extended regular `Flips -> New -> Submit` helper UI with:
  - keyword-aware story generation (`Generate 2 story options`)
  - `Optimize story further` using editable panel text as context
  - story customization per panel (`Panel 1..4 text`)
  - one-click `Build flips`
  - `Accept and use flip` to apply generated images into regular builder slots
  - regenerate controls: `Redo whole flip`, `Redo panel 1..4`
  - random noise controls: toggle + panel index (0..3)
  - cost ledger tracking for generation actions (estimated + actual fields + token usage)

### Why

- Requested workflow needs AI support not only for solving but also for creating flips while keeping human common-sense selection in the loop.
- Keeping generation in the regular builder prevents context switching and lets users decide story quality before final flip acceptance.
- Cost traceability is required for transparent benchmark reporting.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/providers/openai.js main/ai-providers/bridge.js main/index.js main/preload.js renderer/pages/flips/new.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- New AI-assisted generation controls are now embedded in the regular flip builder flow.
- Story proposals, panel generation, per-panel redo, and cost ledger are wired end-to-end.
- Lint and targeted provider bridge tests pass.

## 2026-03-30 - Step: Restore web image search + add AI image search in regular flip editor

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/index.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/components/image-search.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/machines.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/preload.js`

### Changed

- Web image search backend:
  - kept DuckDuckGo search
  - added Wikimedia Commons search fallback
  - merged DuckDuckGo + Openverse + Wikimedia results and de-duplicated image URLs
- AI image search backend:
  - added `ai-solver` command `generateImageSearchResults`
  - implemented via OpenAI-compatible image generation endpoint with prompt variants
  - returns image list in the same `{image, thumbnail}` format used by existing picker
- Renderer image search dialog:
  - added mode buttons: `Web` and `AI image search`
  - added provider-key check when activating AI mode
  - when no key is set, shows exact required error text:
    - `this option is only available for users who provide an API key for a payed AI provider`
  - AI mode uses configured provider/model from AI settings

### Why

- DuckDuckGo-only flow is brittle; fallback providers keep regular flip image lookup usable.
- Users requested AI-driven prompt-based image search in the regular editor, gated by paid-provider key presence.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/index.js main/ai-providers/bridge.js main/preload.js renderer/screens/flips/machines.js renderer/screens/flips/components/image-search.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- Regular flip editor search now has robust web fallback and AI image search mode.
- Missing key path now shows the requested explicit paid-provider warning.

## 2026-03-30 - Step: Simplify AI UX to default few-click flow (advanced hidden)

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/settings/ai.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/settings/ai-test-unit.js`

### Changed

- Added a simple quick-start entry card in AI settings and AI test unit:
  - `Start benchmark now`
  - direct deep-link to regular flip builder submit step (`/flips/new?focus=ai-benchmark&autostep=submit`)
- Added advanced toggles so expert controls are collapsed by default:
  - `Advanced AI settings` in `/settings/ai`
  - `Show advanced import` in regular flip builder submit helper
- Kept the regular builder as the primary place for queue runs and JSON tools.
- Fixed JSX structure in advanced submit helper section (fragment wrapping), then normalized formatting.

### Why

- Requested UX target is non-technical users with minimal clicks, while preserving full customization behind explicit advanced toggles.
- Regular flow remains visible and stable, expert controls are still available but no longer overload first view.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js renderer/pages/settings/ai.js renderer/pages/settings/ai-test-unit.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --fix renderer/pages/flips/new.js renderer/pages/settings/ai.js renderer/pages/settings/ai-test-unit.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js renderer/pages/settings/ai.js renderer/pages/settings/ai-test-unit.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && unset NODE_OPTIONS && npm run start`

### Result

- New simplified benchmark entry path is active in settings and routes directly into submit-step benchmark actions.
- Advanced controls are hidden by default and can be expanded on demand.
- Lint passes for all touched UX files.
- App startup compiles successfully with these UI changes.

## 2026-03-30 - Step: Rename desktop app label to idenaAI-desktop v0.0.1

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/package.json`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/index.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/shared/components/sidebar.js`

### Changed

- Updated package metadata:
  - `name`: `idenaai-desktop`
  - `productName`: `idenaAI-desktop`
  - build `artifactName`: `idenaAI-desktop-${os}-${version}.${ext}`
- Updated app/tray menu labels in main process:
  - `Idena` -> `idenaAI-desktop`
  - `About Idena` -> `About idenaAI-desktop`
  - `Open Idena` -> `Open idenaAI-desktop`
- Updated sidebar client version label to explicit branding string:
  - `idenaAI-desktop v.<version>`

### Why

- Requested explicit rename from legacy `idena-desktop v0.0.1` to `idenaAI-desktop v0.0.1` for clearer fork branding and user-facing consistency.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/index.js renderer/shared/components/sidebar.js`

### Result

- App metadata and visible UI labels now use `idenaAI-desktop` branding.
- Lint passes on touched JS files.

## 2026-03-30 - Step: Fix node startup break after desktop rename (legacy node path compatibility)

### Inspected

- `/Users/jz/Library/Logs/Electron/idena.log`
- `/Users/jz/Library/Application Support/Idena/node`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/idena-node.js`

### Error summary

- Desktop showed network errors and node stayed at `0.0.0`.
- Main-process log showed:
  - `spawn /Users/jz/Library/Application Support/idenaAI-desktop/node/idena-go ENOENT`
  - then fallback download attempted and failed for local arch in that path.

### Root cause hypothesis

- Renaming desktop product/app name changed Electron `userData` directory from legacy `.../Application Support/Idena` to `.../Application Support/idenaAI-desktop`.
- Existing built node binary and datadir were still in the legacy `Idena/node` directory.
- Node launcher looked only in new location and failed before any peer connection.

### Changed

- Patched node path resolution in `main/idena-node.js`:
  - prefer current userData `node` directory when present
  - fallback to legacy `Idena/node` directory when current one does not exist
  - log compatibility fallback usage

### Runtime hotfix applied locally

- Added symlink for immediate compatibility during current run:
  - `/Users/jz/Library/Application Support/idenaAI-desktop/node -> /Users/jz/Library/Application Support/Idena/node`

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/idena-node.js`
- `mkdir -p "/Users/jz/Library/Application Support/idenaAI-desktop"`
- `ln -s "/Users/jz/Library/Application Support/Idena/node" "/Users/jz/Library/Application Support/idenaAI-desktop/node"`
- `"/Users/jz/Library/Application Support/idenaAI-desktop/node/idena-go" --version`

### Result

- Node binary resolves again and starts.
- Smoke run confirmed chain initialization and eventual peer connection (`Peer connected`, `Found manifest`).

## 2026-03-30 - Step: Stabilize OpenAI provider test for GPT-5.4 timeout

### Inspected

- `/Users/jz/Library/Application Support/Idena/node/datadir/logs/output.log`
- `/Users/jz/Library/Logs/Electron/idena.log`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/providers/openai.js`

### Error summary

- User-side provider test failed with:
  - `openai test failed (ECONNABORTED) for model gpt-5.4`

### Root cause hypothesis

- Provider test endpoint call used benchmark profile timeout values that can be too short for slower/high-load models.
- Test path retried only on HTTP 429, not on transient timeout (`ECONNABORTED`).

### Changed

- `testOpenAiProvider()` now enforces a larger timeout floor (`45s`) for test calls.
- `bridge.testProvider()` now retries once for transient timeout (`ECONNABORTED`) in addition to 429 rate-limit responses.
- Updated retry log message to generic transient-failure wording.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/providers/openai.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/providers/openai.test.js main/ai-providers/bridge.test.js`

### Result

- Lint passes.
- Targeted tests pass (27/27).
- Provider test path is now more robust for GPT-5.4 and similar slower models.

## 2026-03-30 - Step: Flip builder fallback keywords + real panel-size normalization

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/machines.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/shared/utils/utils.js`

### Error summary

- Flip creation could remain stuck at `Missing keywords` in the builder when keyword lookup failed or when no identity-based keyword source was usable.
- AI image generation used provider-native sizes (commonly `1024x1024`) but did not guarantee the canonical Idena per-panel dimensions before sending into the normal flip builder flow.

### Root cause hypothesis

- Keyword loader assumed a valid pair always exists in `availableKeywords.find(...)` and could throw into `keywords.failure` when no matching pair was found.
- Keyword fallback in `prepareFlip` returned only one random pair, reducing resilience and making retries harder.
- Generated AI panel images were inserted directly without enforced `440x330` normalization.

### Changed

- `flipMasterMachine` keyword hardening:
  - Added safe pair resolution for `loadKeywords` and `loadTranslations`.
  - Added per-word fallback object (`keyword-<id>`) when keyword RPC/lookup fails.
  - Added `USE_RANDOM_KEYWORDS` event that injects a local set of random test pairs and reloads keyword step.
- `new.js` flow updates:
  - `prepareFlip()` now seeds local random test pairs (not a single pair) when no usable chain pairs are available.
  - Added UI action in the keyword step: `Use random test words`.
  - Added image normalization pipeline for AI-generated panels:
    - normalize each panel to `440x330` before `CHANGE_IMAGES`
    - support composite import path by splitting one composite image into 4 normalized panels (`880x660` -> 4x `440x330`)
  - Updated helper text in AI generation UI to show that provider output is normalized to real Idena panel dimensions before submit.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js renderer/screens/flips/machines.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-providers/providers/openai.test.js`

### Result

- Keyword step no longer hard-fails for local/offline-style testing without identity.
- User can explicitly switch to local random keyword pairs inside the regular flip builder flow.
- AI-generated images are now normalized to actual Idena panel dimensions for downstream flip handling and submission steps.

## 2026-03-30 - Step: Auto-fallback to random keywords on keyword-load failure

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/machines.js`

### Changed

- Added automatic one-time recovery in keyword loader:
  - if keyword loading fails, machine switches to local random keyword pairs and retries automatically
  - if retry still fails, state goes to failure as before
- Added machine context flag `didUseRandomKeywordsFallback` to avoid infinite retry loops.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/screens/flips/machines.js`

### Result

- Missing-keyword state now self-recovers automatically in no-identity / no-keyword-source conditions.

## 2026-03-30 - Step: Submit-step shortcut now forces keyword fallback

### Inspected

- `/Users/jz/Library/Logs/Electron/idena.log`
- `/Users/jz/Library/Application Support/idenaAI-desktop/node/datadir/logs/output.log`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/machines.js`

### Error summary

- In regular flip flow, clicking `Open submit step` could land directly in submit with `Missing keywords`.
- This occurred even while node was synced because keyword RPC lookup remained unavailable in some runs (`dna_identity` / `dna_epoch` / `dna_ceremonyIntervals` errors in renderer log history).

### Root cause hypothesis

- The submit shortcut bypassed keyword hydration and entered submit UI state with empty keyword payload.
- Recovery existed in keyword state but was not guaranteed to run before forced submit navigation.

### Changed

- Added editing-level `USE_RANDOM_KEYWORDS` transition in machine so keyword fallback can be triggered from any substep (including submit).
- Added submit navigation helper in page:
  - `openSubmitStepWithKeywordFallback()`
  - if keywords are missing, it triggers random keyword fallback first, then opens submit after hydration.
- Added auto-repair effect:
  - if user is already on submit and keywords are missing, app auto-triggers keyword fallback and returns to submit once loaded.
- Added one-time autostep guard (`didAutostepSubmitRef`) to avoid repeated autostep loops.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js renderer/screens/flips/machines.js`

### Result

- `Open submit step` no longer depends on identity keyword RPC availability.
- Submit step now self-heals missing keywords by injecting local random test words.

## 2026-03-30 - Step: Visible submit-step rescue for missing keywords

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`

### Changed

- Added visible warning box in submit step when keyword payload is empty.
- Added `Load random test words` button directly in submit step, wired to the same keyword fallback helper.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js renderer/screens/flips/machines.js`

### Result

- Even if user is already on submit step, they can recover immediately without navigating back manually.

## 2026-03-30 - Step: Explicit keyword provenance (node preferred, random by manual approval)

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/machines.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Library/Logs/Electron/idena.log`
- `/Users/jz/Library/Application Support/idenaAI-desktop/node/datadir/logs/output.log`

### Error summary

- User had keywords but source was ambiguous (could be interpreted as node/on-chain).
- Flow still auto-switched in some paths, which could hide whether words were random test words.

### Root cause hypothesis

- Random fallback could trigger automatically in keyword loading/submit helper paths.
- UI did not always label keyword origin explicitly.

### Changed

- Machine-level provenance and control:
  - Added `keywordSource` context (`node` or `random`).
  - Added `nodeAvailableKeywords` context to keep preferred node list.
  - Added explicit `USE_NODE_KEYWORDS` event.
  - Removed automatic fallback-on-error to random keywords.
  - `loadKeywords` now fails when no pairs are available, so user must choose explicit fallback.
- UI-level clarity:
  - Added source badge in keyword step:
    - `Node keywords (preferred, from synced node)` or
    - `Local random test words (off-chain, not from synced node)`.
  - In failure/submit rescue areas added explicit actions:
    - `Retry node keywords`
    - `Load random test words`
  - Updated AI helper keyword text to include keyword source.
- Submit-step behavior:
  - `Open submit step` now prefers node keywords and routes user to keyword step when missing, instead of silently switching to random.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js renderer/screens/flips/machines.js`

### Result

- Keyword provenance is now explicit in UI.
- Node keywords remain default/preferred path.
- Random keywords require explicit one-click user approval.

## 2026-03-30 - Step: Build-flip visibility and auto-apply in regular builder flow

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Library/Logs/Electron/idena.log`

### Error summary

- User clicked `Build flips` in submit-step AI helper but did not see a persistent result in the page.
- Previous UX relied mostly on toast notifications; success/failure state was not clearly visible inline.

### Root cause hypothesis

- Generated panels were stored in `generatedFlipPanels` preview state, but not applied to current draft automatically.
- If toast was missed, it looked like nothing happened.

### Changed

- Added persistent inline status box below the build controls with explicit states:
  - running (`Building flip panels...`)
  - success (includes elapsed milliseconds)
  - error (shows normalized error text)
  - idle hint (explains expected behavior)
- Updated `buildFlipWithAi()` to auto-apply generated panels to the regular draft image slots immediately after successful generation.
- Updated `applyGeneratedPanelsToBuilder()` to preserve submit-step context:
  - temporarily switches to image step for machine updates
  - restores submit step afterwards when requested
- Kept manual `Accept and use flip` control available.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Result

- After `Build flips`, users now see immediate inline run status and generated panels are applied to the regular builder draft automatically.
- Submit-step no longer appears "stuck" with empty images after successful generation.

## 2026-03-30 - Step: Submit-step preservation fix for manual apply

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`

### Changed

- Removed redundant `send('PICK_IMAGES')` call after `applyGeneratedPanelsToBuilder()` in the `Accept and use flip` handler.
- Reason: `applyGeneratedPanelsToBuilder()` now already handles temporary image-step switch and return-to-submit, so the extra call forced users out of submit step.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Result

- Manual apply keeps users in submit step instead of unexpectedly navigating back to images.

## 2026-03-30 - Step: Fix flip-build timeout and improve default image size

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`

### Error summary

- Flip build failed with `timeout of 9000ms exceeded` in submit-step AI helper.
- Default image size still showed `1024x1024`, which is suboptimal for panel-style generation.

### Root cause hypothesis

- AI settings `requestTimeoutMs` default (9s) was being passed to image generation requests, which are slower than text calls.
- UI default image size remained at legacy square default.

### Changed

- Increased image generation minimum timeout in bridge for both flows:
  - `generateFlipPanels`: `requestTimeoutMs >= 45000ms`
  - `generateImageSearchResults`: `requestTimeoutMs >= 45000ms`
- Updated default AI image size from `1024x1024` to `1536x1024` (better aspect for panel normalization).
- Improved timeout error text in UI to be actionable.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js main/ai-providers/bridge.js`

### Result

- Build flow is no longer constrained by 9s request timeout for image generation.
- Default image output starts from a wider provider-native format before normalization to Idena panel dimensions.

## 2026-03-30 - Step: Harden image generation timeout path and diagnostics

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/profile.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/constants.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Library/Logs/Electron/idena.log`

### Error summary

- User still received image-generation timeout in build flow.
- Logs showed repeated `generateFlipPanels` commands, but no detailed timeout diagnostics per panel.

### Root cause hypothesis

- Request timeout limits for custom profile were globally capped too low (`30s`), while image generation for 4 panels can exceed this under load.
- Missing explicit image-timeout diagnostics made it hard to verify effective timeout values at runtime.

### Changed

- Increased custom timeout upper bound:
  - `CUSTOM_LIMITS.requestTimeoutMs`: `30s -> 180s`
- For image generation paths, enforce higher minimum timeout and bypass strict short-session limits:
  - `generateFlipPanels`: min `90s`, explicit `profile.requestTimeoutMs = imageRequestTimeoutMs`
  - `generateImageSearchResults`: min `90s`, explicit `profile.requestTimeoutMs = imageRequestTimeoutMs`
- Added runtime diagnostics log for flip image generation profile (provider/model/imageModel/size/timeout/retries).
- Added explicit timeout error with panel index and effective timeout when `ECONNABORTED` occurs.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/constants.js main/ai-providers/bridge.js`

### Result

- Image generation now uses robust timeout budgets independent from strict short-session text timeout.
- Failures now report actionable panel-level timeout diagnostics instead of ambiguous generic errors.

### Verification

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/profile.test.js main/ai-providers/bridge.test.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/providers/openai.test.js`

Result: passed.

## 2026-03-30 - Step: Fix submit shuffle blocker for AI-built flips + cost visibility

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/machines.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/utils.js`

### Error summary

- AI-generated draft could be visible in submit step but still fail with `You must shuffle flip before submit`.
- Users lacked a direct shuffle action in submit step and cost reason was not obvious.

### Root cause hypothesis

- Auto-apply inserted images but submit flow still depended on shuffle-state constraints from publish validation.
- No explicit submit-step shuffle button for quick recovery.
- Image cost perception was opaque during generation.

### Changed

- Added `shuffleDraftForSubmit()` helper in flip page flow.
- `applyGeneratedPanelsToBuilder()` now supports `autoShuffleSubmit`; AI build path uses it by default.
- `Build flips` and `Accept and use flip` now apply + shuffle + return to submit step.
- Added submit footer button:
  - `Shuffle now` when current order is invalid for publish
  - `Reshuffle` otherwise
- Added image cost hint under image size input (gpt-image-1 per-image and 4-panel estimate).

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Result

- AI-generated flips can now be shuffled directly in submit flow with one click.
- Auto-generated drafts are immediately prepared for submit (while still allowing manual reshuffle).
- Cost drivers are visible before generation.

## 2026-03-30 - Step: Make submit-shuffle deterministic + block submit until shuffled

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/shared/utils/arr.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/machines.js`

### Error summary

- Some AI-generated flips still hit `You must shuffle flip before submit`.
- Root cause remained possible because one random shuffle attempt can occasionally return an invalid permutation.

### Root cause hypothesis

- Single-shot random shuffle can return the same permutation (or adversarial-equivalent permutation) accepted by UI but rejected by publish validation.

### Changed

- Added deterministic shuffle helpers:
  - `isValidShuffleOrder()`
  - `buildValidShuffleOrder()`
- `shuffleDraftForSubmit()` now uses `MANUAL_SHUFFLE` with a validated permutation.
- Submit button is now disabled until shuffle is valid.
- Added explicit submit-step hint text: `Shuffle is required before submit.`
- Added explicit lowest-cost hint for image generation size options.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Result

- Shuffle cannot silently fail due to unlucky random permutation.
- Submit is guarded at UI level until permutation is publish-valid.
- Cost guidance is clearer before running image generation.

## 2026-03-30 - Step: Add model-aware image generation cost hints

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- OpenAI model docs/pricing references for `gpt-image-1`, `gpt-image-1.5`, `gpt-image-1-mini` (checked 2026-03-30).

### Changed

- Replaced single-size-only image pricing table with model-aware pricing table.
- Added `normalizeImageModelForPricing()` and computed hint by model + size.
- UI now shows:
  - estimated cost for currently selected image model/size
  - cheapest known size for the selected image model
  - fallback hint when model is unknown

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --fix renderer/pages/flips/new.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Result

- Cost display now better explains why generation can be expensive and how to reduce cost by model/size.

## 2026-03-30 - Step: Disable Ads surfaces in desktop app

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/shared/components/sidebar.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/shared/components/layout.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/validation/after.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/validation/lottery.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/_app.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/ads/containers.js`

### Changed

- Removed Ads navigation entry from sidebar.
- Removed rotating ad banner from global layout.
- Removed validation ad promotion blocks from lottery and after-validation pages.
- Added route guard in `_app.js` to redirect any `/adn/*` route to `/home`.
- Disabled central ads UI components:
  - `AdBanner()` now returns `null`.
  - `AdDrawer()` now renders only the base drawer content without ad promotion.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/shared/components/sidebar.js renderer/shared/components/layout.js renderer/pages/validation/after.js renderer/pages/validation/lottery.js renderer/pages/_app.js renderer/screens/ads/containers.js`

### Result

- Ads are no longer visible from normal app flows.
- Ads route entry points are blocked in-app (`/adn/*` redirects to `/home`).

## 2026-03-30 - Step: Optimize flip-builder story planner prompt (compliance-first)

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.test.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`

### Why this change

- The previous story planner prompt was short and sometimes produced ambiguous or policy-risky stories, leading to repeated re-runs and extra cost.
- We integrated key parts of your proposed compliance prompt to bias generation toward clear, low-risk, high-consensus stories.

### Changed

- Story planner prompt upgraded in backend (`buildStoryOptionsPrompt`) with:
  - strict hard constraints for text-free, causal, single-story flips
  - explicit anti-risk rules (no wake-up template, no thumbs up/down, no counting logic, no keyword cheating via screens/pages)
  - internal self-audit workflow instructions before output
  - structured JSON schema including `storySummary`, `complianceReport`, `riskFlags`, `revisionIfRisky`
- Story parsing hardened:
  - supports panel entries as objects (`description`, `text`, etc.)
  - supports `final_story_title`/`story_summary` shapes
  - normalizes compliance report pass/fail values and risk flags
- Panel image prompt (`buildPanelPrompt`) tightened:
  - explicit wordless constraints (no letters/numbers/signs/UI/watermarks)
  - role-aware panel generation (`before`, `setup`, `peak`, `after`)
  - previous/next panel context included for continuity
- UI story-option normalization and display improved:
  - parses structured compliance/risk fields
  - shows compliance pass/fail summary and risk flags per option

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --fix main/ai-providers/bridge.js renderer/pages/flips/new.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/bridge.test.js renderer/pages/flips/new.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- The story planner now pushes safer, clearer story candidates with explicit compliance metadata.
- Parser and UI now handle your JSON-style structured panel objects instead of degrading to `[object Object]` panel text.
- Regression tests pass (including a new test covering compliance-first prompt usage and structured output parsing).

## 2026-03-30 - Step: Fix flip submit payload overflow ("content is too big")

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/utils.js`

### Root cause

- Submit fails at `publishFlip()` when `publicHex + privateHex` exceeds protocol guard (`2 MB` string limit).
- AI-generated panels were being passed through submit as large base64 image payloads without a dedicated submit-size budget.
- This branch intentionally bypasses legacy `protectFlip` anti-AI image perturbation, so there was no replacement compression stage before submit.

### Changed

- Added submit-safe panel compression in flip builder page:
  - New JPEG budget encoder with quality fallback steps.
  - New panel compression pipeline (`compressPanelForSubmit`, `compressPanelsForSubmit`) with:
    - target crop/cover normalization
    - 440x330 first-pass encoding
    - fallback 320x240 encoding when still above size budget.
- Updated machine service `protectFlip` override in `new.js`:
  - now compresses all 4 draft images before submit
  - keeps anti-noise path disabled (`adversarialImage: ''`) as required.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Result

- AI-generated flips now go through a deterministic submit-size compression stage before `submitFlip`.
- This reduces probability of `Cannot submit flip, content is too big` for generated and edited draft flips.

## 2026-03-30 - Step: Fix story-option UI placeholders after generation

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/decision.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/decision.test.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.test.js`

### Root cause hypothesis

- Some provider responses for story generation were not parsed reliably as JSON (code fences / noisy wrappers / empty content edge case), causing fallback options with generic panel placeholders.

### Changed

- Reworked `extractJsonBlock()` in `decision.js`:
  - supports direct JSON parse
  - supports fenced JSON blocks
  - scans text for first valid balanced JSON object/array candidate.
- Strengthened story option parsing in `bridge.js`:
  - added meaningful-panel checks to avoid placeholder-only options
  - improved plain-text line fallback normalization
  - added keyword-based local fallback story generation when provider response is empty/unusable.
- Added regression tests:
  - fenced/noisy JSON extraction tests
  - empty-provider-story-response fallback test.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/decision.js main/ai-providers/bridge.js main/ai-providers/decision.test.js main/ai-providers/bridge.test.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/decision.test.js main/ai-providers/bridge.test.js`

### Result

- Story option generation no longer collapses into generic `Panel X: add a clear event...` placeholders when model output is wrapped or partially malformed.
- If provider text is empty/unusable, UI still gets two keyword-aware fallback options instead of blank placeholders.

## 2026-03-31 - Step: Enforce no-text panels with automatic audit + retry

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`

### Root cause

- Prompt-only constraints (`wordless`, `no labels/text`) are not deterministic for image generation models.
- Some generated panels still contained readable signs/words (e.g. `NIGHT CLUB`) despite no-text instructions.

### Changed

- Added panel text-audit logic in bridge:
  - post-generation check prompt (`buildPanelNoTextAuditPrompt`)
  - JSON audit parser (`parsePanelNoTextAudit`)
  - automatic per-panel regenerate loop when text is detected.
- Added configurable audit controls in `generateFlipPanels` payload handling:
  - `textAuditEnabled` (default `true`)
  - `textAuditModel` (default `gpt-4o-mini`)
  - `textAuditMaxRetries` (default `2`)
  - `textAuditRequestTimeoutMs` (default min `12000`)
- Cost accounting now includes all generation attempts (including retries), so expensive text-fix retries are visible instead of hidden.
- Returned metadata now includes:
  - `textOverlayRetryCount`
  - `textAuditByPanel[]`
- UI feedback in flip builder:
  - warning toast if any panel still contains text after all retries
  - info toast when text-audit retries were used successfully
  - success status includes retry count.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --fix main/ai-providers/bridge.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/bridge.js renderer/pages/flips/new.js main/ai-providers/decision.js main/ai-providers/bridge.test.js main/ai-providers/decision.test.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/decision.test.js main/ai-providers/bridge.test.js`

### Result

- No-text requirement is now enforced by an explicit verification loop instead of prompt-only best effort.
- Panels with accidental text are automatically regenerated before being shown/used.

## 2026-03-31 - Step: Fix second submit-size failure path in submit flow

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/machines.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`

### Root cause

- In the current simplified builder flow (`images -> shuffle -> submit`), `protect` step may be skipped.
- That means `protectedImages` can still hold raw/uncompressed panel payloads copied from `CHANGE_IMAGES`.
- Previous size fix in `protectFlip` service was not sufficient because `submitFlip` could execute without running `protectFlip`.

### Changed

- Added mandatory pre-submit preparation in page layer:
  - `pickSubmitImageSource(flip)` selects `protectedImages` if present, otherwise falls back to `images`.
  - `prepareFlipForSubmit(flip)` always compresses selected images via `compressPanelsForSubmit(...)`.
- Updated submit service wiring:
  - `submitFlip: async (flip) => publishFlip(await prepareFlipForSubmit(flip))`

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Result

- Submit now always applies compression right before `publishFlip`, independent of whether the user visited the legacy protect step.
- This closes the remaining `Cannot submit flip, content is too big` path in the regular builder submit flow.

## 2026-03-31 - Step: Adopt new main flip-story prompt + 2-pass generator/audit

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.test.js`

### Changed

- Replaced story generation prompt with your compliance-first main prompt structure:
  - hard constraints
  - low report-risk design rules
  - explicit internal workflow
  - exact target JSON schema fields (`final_story_title`, `story_summary`, `panels`, `compliance_report`, `risk_flags`, `revision_if_risky`)
  - extra heuristics you provided.
- Implemented 2-pass generation in backend:
  1. first pass = concept generation
  2. second pass = audit prompt (`audit this concept and hard-reject anything risky`)
- Added converters/helpers to keep audit payload schema-stable.
- Kept robust fallback parser behavior in case providers return malformed output.
- Behavior update: story generation now intentionally returns one final audited concept (`stories[0]`) instead of two options.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --fix main/ai-providers/bridge.js main/ai-providers/bridge.test.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/bridge.test.js main/ai-providers/decision.js main/ai-providers/decision.test.js renderer/pages/flips/new.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/decision.test.js main/ai-providers/bridge.test.js`

### Result

- Flip-story helper now uses your full compliance-focused prompt as the main planning instruction.
- Backend now executes the recommended generator+audit loop for lower-risk, clearer concepts.

## 2026-03-31 - Step: Restore creative story options while keeping compliance guardrails

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.test.js`

### Root cause

- Story generation had become over-constrained and collapsed into generic placeholders.
- Backend was returning only one option (`slice(0, 1)`), while UI still offered a 2-option chooser.
- Placeholder text such as `Panel X: add a clear event in the story.` could still pass parsing in fallback paths.

### Changed

- Prompt tuning for creativity-with-clarity:
  - switched goal from one concept to two distinct concepts
  - enforced strict JSON envelope `{ "stories": [concept1, concept2] }`
  - added explicit prohibition of template placeholder outputs
  - kept full compliance/risk rules from the main prompt.
- Story option pipeline:
  - `generateStoryOptions` now targets 2 options end-to-end.
  - Per-option audit pass is executed when provider output is structured JSON-like.
  - Audit keeps safer rewrites but no longer collapses to a single story.
- Parser/fallback hardening:
  - Added low-value story panel detection (`isLowValueStoryPanel`) for placeholder/generic boilerplate.
  - `hasMeaningfulStoryPanels` now requires >=3 unique meaningful panels.
  - Fallback story templates were rewritten to be clearer and less robotic.
  - If provider returns insufficient options, keyword-based fallback tops up to 2 distinct options.
- Tests:
  - Updated fallback test to assert 2 options.
  - Added regression test that rejects boilerplate placeholder panel outputs.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/bridge.test.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- Story generation is creative again (two distinct options) while preserving compliance constraints.
- Placeholder-style output is rejected and replaced with keyword-grounded alternatives.
- UI option chooser and backend behavior are aligned again.

## 2026-03-31 - Step: Apply storyboard checklist directly in generation/audit prompts

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.test.js`

### Changed

- Embedded practical 4-panel checklist into `buildStoryOptionsPrompt` so generation explicitly optimizes for:
  - before -> trigger -> peak change -> after
  - single story chain and dominant visible change
  - visible causality and stable anchors
  - literal/non-symbolic visual logic
  - large readable state changes.
- Added preferred archetypes and fast rejection rules directly to prompt text.
- Added mandatory scoring rubric thresholds in prompt:
  - `causality >= 4`
  - `consensus_safety >= 4`
  - `keyword_clarity >= 4`
- Extended `buildStoryAuditPrompt` to re-check the same structure/rubric in second pass.
- Added test assertions so prompt regressions are caught automatically.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/bridge.test.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- The checklist is now operational logic in generation, not just external documentation.
- Story options are forced through clearer causal structure and stricter consensus-safety gates.

## 2026-03-31 - Step: Replace random-topic noise panel with legacy adversarial image noise (single panel only)

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/utils.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`

### Root cause

- AI builder "include noise" path was implemented as a random unrelated scene prompt for one panel.
- Legacy Idena anti-bot flow uses image-domain adversarial noise (`protectFlipImage`) rather than semantic random-topic replacement.

### Changed

- Prompt/semantic behavior:
  - Removed random-topic decoy semantics from backend prompt hints.
  - Noise-enabled mode now keeps all 4 panels in one coherent story.
- Panel generation behavior:
  - Removed special random-topic generation branch in `buildPanelPrompt(...)`.
  - Noise-marked panel gets normal story prompt plus guidance that client-side distortion may be applied.
- Legacy noise application in regular builder flow:
  - Added `applyLegacyNoiseToPanel(...)` in `renderer/pages/flips/new.js`.
  - Uses legacy `protectFlipImage(...)` from `renderer/screens/flips/utils.js` on exactly one selected panel index.
  - Applied only when `storyIncludeNoise=true` and the selected panel is in current `regenerateIndices`.
  - This prevents accidental re-noising of all panels or repeated degradation.
- UI wording updated:
  - "Add random panel noise..." -> "Apply legacy adversarial image noise to one panel..."

### Cost optimization change

- Switched default AI image size to `1024x1024` (cheaper) while preserving final Idena panel format via existing normalization/crop pipeline.
- Updated defaults in:
  - `renderer/pages/flips/new.js` (`DEFAULT_AI_IMAGE_SIZE`)
  - `main/ai-providers/bridge.js` (`generateFlipPanels` and image-search generation defaults)

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js main/ai-providers/bridge.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- Noise mode now matches legacy intent: one panel gets real adversarial image noise, not a random-topic image.
- Story coherence is preserved across all 4 panels.
- Default generation cost is reduced by using 1024x1024 input size and post-crop normalization.

## 2026-03-31 - Step: Separate reasoning model from image model in flip-builder UI and harden low-cost defaults

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`

### Changed

- Added/kept explicit model split in regular flip-builder AI block:
  - `Reasoning model (story + audit)` (free-form)
  - `Image model` (free-form)
- Ensured story generation always uses reasoning model and panel rendering uses image model.
- Added UI hint that custom model IDs are allowed (e.g. `nano-banana` or provider-specific IDs).
- Set backend image-model fallback to cheaper default:
  - `generateFlipPanels`: `gpt-image-1-mini`
  - `generateImageSearchResults`: `gpt-image-1-mini`

### Why

- Keep reasoning and rendering decoupled so users can run strong reasoning models with cheaper image models.
- Preserve support for custom model names without hardcoded allowlists.
- Reduce accidental spend when payload does not explicitly set image model.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js main/ai-providers/bridge.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- Model split is explicit in UI and execution path.
- Image generation defaults now favor lower cost.
- Existing bridge tests continue to pass.

## 2026-03-31 - Step: Cross-provider image-generation routing (OpenAI-compatible + Gemini)

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/providers/gemini.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.test.js`

### Changed

- Added provider-agnostic image routing in bridge:
  - new `supportsImageGenerationProvider(provider)`
  - new `runImageProvider(...)` dispatcher
- Enabled Gemini in image paths:
  - `generateFlipPanels(...)` now routes by provider (not OpenAI-only)
  - `generateImageSearchResults(...)` now routes by provider (not OpenAI-only)
- Added Gemini image provider adapter:
  - `callGeminiImage(...)` in `providers/gemini.js`
  - parses Gemini inline image output and returns `data:image/...;base64,...`
  - payload fallback variants for better compatibility (`responseModalities`, `imageConfig`, minimal payload)
- Improved config consistency:
  - Gemini text/list/test calls now accept forwarded provider config from bridge
- Updated backend OpenAI image pricing snapshot to match UI table and low-cost defaults:
  - added `gpt-image-1.5`
  - added `gpt-image-1-mini`
  - aligned `gpt-image-1` values
- Added tests:
  - Gemini image search routing
  - Gemini 4-panel flip generation routing
  - explicit unsupported-provider error path for image search

### Why

- You requested cross-provider image generation routing.
- This removes the old OpenAI-only hard gate and keeps one execution path for image flows.
- It also preserves lower-cost operation with correct pricing hints in backend accounting.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/bridge.test.js main/ai-providers/providers/gemini.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js main/ai-providers/providers/openai.test.js`

### Result

- Image generation is now routed by provider and supports Gemini in addition to OpenAI-compatible endpoints.
- Targeted lint/tests pass.

## 2026-03-31 - Step: Fix flip-builder image timeout failures with robust timeout handling and backoff

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.test.js`

### Root cause

- Timeout handling in panel/image generation only checked `error.code === ECONNABORTED`.
- Some provider timeout failures surfaced only as timeout text in `error.message` and bypassed special handling.
- Image generation used a low minimum timeout for heavy image models and could fail before finishing.
- `maxRetries` used `payload.maxRetries || 1`, forcing retries even when user explicitly set `0`.

### Changed

- Added timeout helpers:
  - `isTimeoutError(error)` checks code and timeout message patterns.
  - `buildImageTimeoutCandidates(base)` builds escalating timeout windows.
- Increased image-generation minimum timeout to `180000ms` for:
  - `generateFlipPanels`
  - `generateImageSearchResults`
- Added automatic timeout escalation/backoff per panel/variant:
  - retries with larger timeout windows before hard failure.
- Fixed retries config semantics:
  - changed `payload.maxRetries || 1` to `payload.maxRetries ?? 1`.
- Updated renderer timeout error text to include practical mitigation:
  - retry, switch to faster/cheaper image model (`gpt-image-1-mini`), or raise timeout.
- Added regression test:
  - timeout without `ECONNABORTED` code now escalates timeout and succeeds.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/bridge.js main/ai-providers/bridge.test.js renderer/pages/flips/new.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- Flip/image generation no longer fails fast on message-only timeout variants.
- Build flow now retries with larger timeout windows automatically.
- Lint and targeted tests pass.

## 2026-03-31 - Step: Add dropdown model selectors in flip-builder AI generation UI

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/settings/ai.js`

### Changed

- Added dropdown (`Select`) for **Reasoning model (story + audit)**.
- Added dropdown (`Select`) for **Image model**.
- Added provider-aware preset lists for both selector types.
- Kept custom model support by adding `Custom model ID...` option and conditional text input fallback.
- Wired selector state so current model defaults cleanly and no temporary custom-state flicker appears on first render.

### Why

- You requested explicit dropdown menus for model selection in flip generation.
- This improves usability for non-technical users while preserving advanced/custom model IDs.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Result

- Flip-builder generation now has direct dropdown choice for reasoning and image models.
- Users can still type arbitrary model IDs when needed.

## 2026-03-31 - Step: Remove stray `ready/dirty` debug overlay from flip UX

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/list.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/edit.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/view.js`

### Root cause

- `FloatDebug` state widgets were still rendered in flip pages.
- In this desktop run mode they appear persistently and expose internal machine state (`ready/dirty`) to end users.

### Changed

- Removed `FloatDebug` imports and render blocks from all flip pages:
  - flips list
  - new flip
  - edit flip
  - view flip

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --fix renderer/pages/flips/list.js renderer/pages/flips/new.js renderer/pages/flips/edit.js renderer/pages/flips/view.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/list.js renderer/pages/flips/new.js renderer/pages/flips/edit.js renderer/pages/flips/view.js`

### Result

- The `ready/dirty` debug popup no longer appears in the flip workflow UI.

## 2026-03-31 - Step: Add "Add to AI test queue" action to Draft/My Flips cards

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/components.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/list.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/validation/ai/test-unit-utils.js`

### Changed

- Added a new per-flip menu action in flip cards:
  - `Add to AI test queue`
- Wired list-page handler to convert selected flip into AI-ready format and enqueue it via local test-unit bridge:
  - uses `decodedFlipToAiFlip(...)`
  - builds left/right orders from draft `originalOrder` and `order`
  - auto-generates a valid shuffled order when current order equals original
- Added success toast after enqueue with queue size feedback.
- Kept blockchain submit path unchanged.

### Why

- You requested that AI-testing flips can be queued directly, without requiring blockchain submit eligibility.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --fix renderer/pages/flips/list.js renderer/screens/flips/components.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/list.js renderer/screens/flips/components.js`

### Result

- In `My Flips` menu, drafts (and other actionable flip types) now provide a direct queue action for AI testing.

## 2026-03-31 - Step: Restore legacy-style random noise panel generation for AI flip builder

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/screens/flips/utils.js`

### Root cause

- AI builder post-process noise path used `protectFlipImage(sourcePanel)` on a single panel only.
- This skipped legacy adversarial composition (`getAdversarialImage(...)`) and produced weak/noisy variants not matching main flip adversarial behavior.
- `getAdversarialImage(...)` had fragile selection/fallback behavior: if palette extraction failed, color fallback could collapse to near-black output.

### Changed

- In AI builder (`new.js`), updated `applyLegacyNoiseToPanel(...)` to:
  - collect all generated panel images,
  - generate a legacy adversarial composite with `getAdversarialImage(...)`,
  - then apply `protectFlipImage(...)` on that composite,
  - fallback to source panel only if composite generation is unavailable.
- In legacy utility (`utils.js`), hardened `getAdversarialImage(...)`:
  - replaced risky random unique-pick loop with deterministic `shuffle(...).slice(0,4)` selection,
  - added strict fallback palette color derived from the image if `extract-colors` fails,
  - prevents black/no-color degeneration when palette extraction fails.

### Why

- Requested behavior: random noise panel should mimic mainchain-style adversarial mixed image (composed from visual fragments), not a plain or black placeholder.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js renderer/screens/flips/utils.js`

### Result

- AI-generated flips now apply legacy-style composite adversarial noise to the selected random panel.
- Noise output is more stable and avoids black-fallback artifacts when color extraction fails.

## 2026-03-31 - Step: Enforce composite legacy noise (always) for AI random noise panel

### Changed

- Removed single-panel fallback in AI noise post-process path.
- Added `buildCompositeNoiseFromPanels(...)` fallback composer in `/renderer/pages/flips/new.js` that synthesizes a mixed patchwork from generated panels if `getAdversarialImage(...)` cannot return a data URL.
- Noise-enabled AI build now always uses a composed adversarial source before `protectFlipImage(...)`.

### Why

- Requirement update: random noise panel must always be legacy-style composite/mixed noise, not a plain/single panel fallback.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js`

### Result

- With noise enabled, generated noise is consistently composed from flip panel content and no longer falls back to a plain single panel path.

## 2026-04-01 - Step: Remove recurring "stable everyday setting" boilerplate from generated flip stories

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`

### Root cause

- Local fallback story template had fixed phrase `in a stable everyday setting` in panel 1.
- Story prompt rules also over-emphasized stability wording, so models tended to repeat similar phrasing.

### Changed

- Replaced fallback panel phrasing with action-focused wording (no `stable everyday setting`).
- Added `reduceStoryBoilerplate(...)` sanitizer in story normalization to remove recurring stock phrases, including:
  - `in a stable everyday setting`
  - `in an everyday setting`
  - `in a stable setting`
  - `in the same scene`
  - `still clearly visible`
- Extended planner prompt with explicit anti-boilerplate instruction:
  - avoid stock phrases and vary wording across panels.

### Why

- Requested permanent reduction of repetitive phrase artifacts in generated flip texts.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/bridge.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- New story options and normalized panel texts no longer carry the repetitive `stable everyday setting` artifact by default.

## 2026-04-01 - Step: Harden flip image generation against timeout via automatic image profile fallback

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`

### Root cause

- Some image-model/size combinations timed out despite timeout escalation, especially on slower provider windows.
- Existing logic retried only timeout duration, not model/size profile.

### Changed

- Added `buildImageProfileCandidates(...)` in bridge:
  - tries requested image model+size first,
  - then falls back to `1024x1024` for the same model,
  - for OpenAI-compatible providers, also tries `gpt-image-1-mini@1024x1024` as fast fallback.
- Updated panel generation loop to iterate fallback profiles combined with timeout backoff.
- Added telemetry fields:
  - `panels[].imageModelUsed`
  - `panels[].imageSizeUsed`
  - top-level `imageFallbackUsed` flag.
- Updated timeout error detail string to include attempted fallback profiles.

### Why

- Requested fix for recurring "Flip generation failed / image generation timed out" in real UI runs.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint --fix main/ai-providers/bridge.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/bridge.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- Flip panel generation now auto-degrades to faster image profile(s) before failing on timeout, substantially reducing timeout-only build failures.

## 2026-04-01 - Step: Simplify flip-creation rules and speed up AI flip production

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`

### Root cause

- Story generation used a very long compliance prompt and optional extra audit pass, which increased latency/cost.
- Panel generation kept strict text-audit enabled by default in builder flow and used conservative timeout behavior, increasing total build time.

### Changed

- Added fast story prompt path `buildStoryOptionsPromptFast(...)` in bridge with simpler rule set and lighter output requirements.
- Added `fastStoryMode` switch in `generateStoryOptions(...)`:
  - when enabled, uses the simplified prompt,
  - lower default output token budget,
  - shorter request/deadline defaults,
  - skips second-pass story audit loop.
- Added `fastBuild` switch in `generateFlipPanels(...)`:
  - lower minimum image timeout for builder flow,
  - default text-audit disabled unless explicitly enabled,
  - default text-audit retries set to 0 in fast mode.
- Enabled both from builder UI flow (`new.js`):
  - `fastStoryMode: true` for story generation
  - `fastBuild: true`, `textAuditEnabled: false`, `textAuditMaxRetries: 0` for panel generation
  - slightly lowered story-generation token/temperature defaults for faster output.

### Why

- Requested: make flip creation rules less complicated so flip production does not take many minutes.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/ai-providers/bridge.js renderer/pages/flips/new.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- Builder now uses a fast, simpler story+panel generation path by default.
- Flip creation latency and complexity are reduced in normal AI builder usage.

## 2026-04-01 - Step: Add Fast/Strict toggle + required human story seed (1-2 sentences) + more imaginative story prompting

### Inspected

- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/renderer/pages/flips/new.js`
- `/Users/jz/Documents/idena-benchmark-workspace/idena-desktop/main/ai-providers/bridge.js`

### Root cause

- Builder default had no explicit generation-mode switch in UI.
- Story generation could run without direct human creative input.
- Prompt quality was compliance-heavy but often too generic under fallback conditions.

### Changed

- `new.js`:
  - Added `Generation mode` selector (`Fast` / `Strict`) in AI-assisted builder section.
  - Added required `Human story seed (1-2 sentences)` textarea and validation.
  - Story generation now blocks until valid human seed is provided.
  - Story generation passes:
    - `fastStoryMode` based on selected UI mode.
    - `humanStorySeed` to backend prompt construction.
  - Flip panel generation now maps mode to build behavior:
    - Fast: `fastBuild=true`, text-audit off.
    - Strict: `fastBuild=false`, text-audit on with 1 retry.

- `bridge.js`:
  - Added `normalizeHumanStorySeed(...)`.
  - Extended both story prompt builders to consume `humanStorySeed`.
  - Prompt text now explicitly requires using human seed as creative driver while keeping low-ambiguity visual causality.
  - Extended fallback story generation to use human seed so local fallback outputs stay less generic.

### Debug notes

- Initial lint run failed with:
  - `no-nested-ternary` in `new.js`
  - `prettier/prettier` formatting issues in `bridge.js`
- Fix attempt:
  - Replaced nested ternary temperature logic with explicit `if/else`.
  - Re-formatted affected function signature/calls.
- Result: lint clean.

### Commands

- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint renderer/pages/flips/new.js main/ai-providers/bridge.js`
- `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/bridge.test.js`

### Result

- UI now supports explicit Fast/Strict generation behavior.
- Human creativity is enforced in default flow via required 1-2 sentence seed.
- Story options are less generic and more anchored to user-provided narrative intent.
