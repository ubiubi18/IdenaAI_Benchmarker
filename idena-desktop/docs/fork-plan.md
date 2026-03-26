# Fork Plan (Desktop) - UI-First AI Benchmark

## Anchors and branches

- `idena-go`: `v1.1.2` on `research/benchmark-chain`
- `idena-desktop`: `v0.39.1` on `research/benchmark-desktop`

## Locked scope for current milestone

- UI-first implementation starts in `idena-desktop`.
- Provider support: OpenAI + Gemini.
- Benchmark modes:
  - strict default (fixed session budget and bounded requests)
  - custom research mode (overrides with metadata logging)
- API keys are session-only by default (in-memory, not persisted to settings).

## Implemented in this step

1. Main-process AI bridge and provider adapters.
2. Renderer settings state for `aiSolver` profile.
3. New settings route `/settings/ai` for provider/model/profile/key management.
4. Validation AI helper integration in normal solve flow:
   - one-click solve button for short and long solving phases
   - optional auto-run per validation session phase (`session-auto` mode)
   - live telemetry with visible flip pair, chosen side, and per-flip latency
   - sequential request pacing for rate-limit-safe benchmarking
5. Local benchmark metrics logging in user data.
6. Token accounting for cost transparency:
   - per-flip prompt/completion/total tokens
   - batch/session token totals in benchmark summaries

## Additional implemented milestone

1. Modularized AI provider implementation into dedicated main-process modules under `main/ai-providers/`.
2. Added focused Jest coverage for:
   - benchmark profile normalization
   - provider decision parsing/normalization
   - deadline-exceeded behavior in batch solving
3. Added short-session AI benchmark telemetry panel in validation UI:
   - provider/model summary
   - applied answers and elapsed time
   - per-flip confidence/latency/error rows
4. Added persistent research warning banners:
   - global layout banner with AI settings link
   - validation top warning strip
5. Added local AI test unit and pre-publish flip testing flow:
   - `/settings/ai-test-unit` queue + run utility
   - JSON ingest (paste + file upload) and ad-hoc run support
   - manual flip builder from 4 uploaded single images (custom left/right order)
   - one-click AI test before flip submit
   - one-click add draft flip to local test queue
6. Added protocol-aware flip normalization for test unit imports:
   - AI-ready `{leftImage,rightImage}`
   - protocol-style decrypted `{hex/privateHex/publicHex}`
   - decoded `{images,orders}`
   - envelope compatibility for `{result:{...}}` and `{flips:[...]}`
   - map payload compatibility with key->hash fallback
7. Hardened browser preview runtime:
   - in-memory DB fallback for non-Electron context
   - synchronous preview global initialization (fixes `dbPath` and zoom crashes)
8. Added historical dataset import utility for FLIP-Challenge:
   - script: `scripts/import_flip_challenge.py`
   - converts HF parquet rows to test-unit decoded JSON chunks
   - supports paging via `--skip-flips` + `--max-flips`
9. AI test-unit run UX hardening:
   - strict profile now sequential by default (`maxConcurrency=1`, `interFlipDelayMs=650`)
   - live main-process progress events for queue/JSON/manual runs
   - live renderer monitor showing current flip images, decision side, latency, tokens
   - JSON ingest moved to compact advanced panel with reduced textarea size
   - OpenAI presets tuned for user-accessible models (`gpt-4o`, `gpt-4.1` path; `o3` removed from presets)
10. Regular builder integration:

- moved queue + bulk JSON AI benchmark controls into `/flips/new` submit step
- live monitor now available in the same regular builder flow used for normal flip publication
- run progress routing hardened with request-id scoped events to avoid stale or missing monitor updates
- `/settings/ai-test-unit` converted to a lightweight guidance page linking users to `/flips/new` and `/settings/ai`
- `/settings/ai-test-unit` is no longer a primary settings tab; route redirects into regular builder benchmark section
- run monitor now has response-hydration fallback from final run payload if IPC live events are delayed or missing
- quick-access tab restored with guidance links so users can jump directly to builder benchmark or validation preview
- new-flip screen now supports offline/bootstrap entry into builder mode when `dna_epoch` is unavailable, so import/setup is still possible

11. Benchmark session UX alignment:

- starting AI benchmark from regular builder now opens a 5-second countdown popup
- popup shows two-side flip view and real-time AI decisions per flip
- `flip-start` + `flip-result` event pipeline added for clearer per-flip progression
- local benchmark runs are forced to sequential mode (`maxConcurrency=1`) for deterministic one-by-one observation

12. Resilience and compatibility hardening:

- keyword loading now has legacy dictionary fallback (`idena-go v1.1.2 keywords.json`) when local RPC is unavailable
- web image search now uses normalized provider output with Openverse fallback when DuckDuckGo fails
- internal node downloader now resolves platform-compatible releases (important for macOS where latest `v1.1.2` has no mac asset)
- node update path now validates temp binary size before overwrite to avoid empty/corrupt binary replacement

13. Builder run readiness checks:

- regular builder AI run now validates `aiSolver.enabled` and provider session-key presence before invoking solver
- missing prerequisites now show actionable errors and redirect to `/settings/ai`
- regular builder submit panel now includes direct `AI settings` action button

14. Bulk import visibility:

- removed hidden JSON tools toggle in `/flips/new` submit step
- bulk JSON import controls are now permanently visible at top of AI benchmark helper panel

15. Session split benchmark pack:

- local queue can be preloaded with a deterministic 20-flip pack for auditability
- submit-step UI now shows split preview: short session `6` + long session `14` with hash lists

16. Builder ergonomics + node pinning hardening:

- inbuilt desktop node updater is pinned to `idena-go v1.1.2`
- macOS arm64 local build fallback added when tagged binary asset is unavailable
- regular flip flow no longer depends on adversarial/noise protection stage for benchmark testing
- bulk JSON import is shown as always-visible panel in New Flip flow (not hidden in submit-only section)

17. WASM parity on macOS arm64:

- local `idena-wasm-binding` module extended with `darwin/arm64` static library and linker selector
- `idena-go` wired to local binding module so desktop inbuilt node rebuild keeps WASM contract execution enabled
- desktop node builder invokes `idena-go/scripts/build-node-macos-arm64.sh` when present for one-command local recovery

18. Multi-provider ensemble mode:

- optional consultation of up to 3 providers/models per flip (primary + consultant #2/#3)
- consultants run in parallel per pass, then final answer is picked from averaged left/right/skip probabilities
- per-consultant weighted averaging is supported for calibration as newer models are added
- ensemble settings wired into validation orchestrator and regular builder benchmark runs
- logs include ensemble diagnostics (`consultedProviders`, `ensembleProbabilities`, contributors/consulted counts)

19. Major provider wiring + latest-model discovery:

- added first-class provider options: OpenAI, Anthropic, Gemini, xAI, Mistral, Groq, DeepSeek, OpenRouter, and custom OpenAI-compatible
- runtime now routes:
  - OpenAI-compatible style providers through unified OpenAI-compatible adapter
  - Anthropic through native Messages API adapter
  - Gemini through native Generative Language adapter
- added AI settings action to check latest models from provider APIs
- loaded model catalogs are merged into model preset pickers for primary and ensemble consultants

20. Model discovery UX extension:

- added a one-click `Check all providers` action in AI settings
- scan runs sequentially to reduce rate-limit spikes and returns loaded/skipped summary
- existing single-provider `Check latest models` remains available for focused refresh

21. Legacy strategy as weighted ensemble vote:

- added internal strategy `legacy-heuristic` as optional consultant in ensemble averaging
- strategy can be combined with one provider or with multi-provider ensemble
- added UI controls:
  - `Legacy heuristic vote` toggle
  - `Legacy heuristic weight`
- payload wiring added in validation orchestration and flip-builder benchmark runs
- no additional provider key required for this strategy (local-only heuristic)

22. Legacy-only execution mode:

- added `legacyHeuristicOnly` mode in settings and runtime payload
- when enabled together with `legacyHeuristicEnabled`, runs execute with internal heuristic only
- primary cloud provider key is not required in this mode
- run metadata reports provider/model as `legacy-heuristic` / `legacy-heuristic-v1`

## Next desktop steps

1. Add renderer tests for protocol JSON normalization and image compose edge-cases.
2. Add export/import format for local benchmark logs.
3. Apply full fork branding and default network separation in desktop package/runtime metadata.

## Next chain steps (after desktop MVP)

1. Implement previous-epoch eligibility in `idena-go v1.1.2`:
   - `canMineNextEpoch`
   - `canPublishFlipsNextEpoch`
2. Implement report suspension rule (`reportedFlipsInSession > 1`, configurable).
3. Implement bootstrap ramp config and enforcement points.
4. Extend RPC identity payload fields for desktop visibility.
