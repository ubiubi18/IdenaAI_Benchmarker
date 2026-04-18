# Local AI MVP Architecture

## Purpose

This private repository, `ubiubi18/IdenaAI`, is now the forward-moving
development home for the desktop fork and its Local AI extension work.

The public repository, `ubiubi18/IdenaAI_Benchmarker`, remains the
historical/public reference for now. Future Codex and Deep Research work should
target the private repo and avoid changing the public repo by mistake.

## Current MVP Scope

Implemented now:

- `localAi` settings state and defaults
- Local AI settings UI with explicit opt-in controls
- validation-time local flip capture hook
- main-process Local AI manager and IPC handlers
- local-only storage for capture metadata, manifests, received bundles, and
  aggregation results
- conservative epoch manifest generation
- local bundle build and local bundle import
- replay protection and base-model compatibility checks
- safe bundle rejection handling with observable accepted/rejected outcomes
- guarded aggregation that stays honest when real deltas do not exist yet
- optional local sidecar interface for health, models, chat, caption, OCR, and
  training calls
- Ollama-backed Local AI chat and image-aware `flipToText` inference
- advisory Local AI flip checker with `consistent` / `ambiguous` /
  `inconsistent` sequence classifications
- post-consensus Local AI training-candidate packaging for eligible local items
- focused Jest tests for the Local AI plumbing

Still placeholder or stubbed:

- sidecar `caption`, `ocr`, and `train` are interface-only or stub-only
- `flipToText` uses Ollama vision with `qwen2.5vl:7b` as the default local
  vision model; OCR is still not implemented
- image-aware `flipToText` and the flip checker use a 2-stage local pipeline:
  panel captions first, then ordered sequence reduction/checking
- main-process signing verification does not yet perform full Node-RPC trust
  validation
- update bundles are still metadata-first and currently use `deltaType: "none"`
  by default
- aggregation currently produces a `metadata_only_noop` result until real
  adapter/LoRA deltas exist
- training-candidate packaging is preparation only: no training, no model
  deltas, and no federated exchange are performed yet
- no relay/coordinator networking, automated sharing, or federated aggregation
  protocol exists yet

Current model-role split:
- local runtime vision inference stays on Ollama, currently `qwen2.5vl:7b`
- local MLX training can intentionally use a different base model
- recommended strong-Mac MLX training target: `mlx-community/Qwen3.5-9B-MLX-4bit`
- stronger fallback: `mlx-community/Qwen2.5-VL-7B-Instruct-4bit`
- safe minimum fallback: `mlx-community/Qwen2-VL-2B-Instruct-4bit`

## Data Flow

1. Settings are defined in
   `renderer/shared/providers/settings-context.js` and edited in
   `renderer/pages/settings/ai.js`.
2. During validation, decoded flip images become available in
   `renderer/screens/validation/machine.js`.
3. When `localAi.captureEnabled` is true, the renderer sends a guarded
   `localAi.captureFlip` IPC event from `renderer/pages/validation.js`.
4. `main/index.js` routes Local AI IPC calls into `main/local-ai/manager.js`
   and `main/local-ai/federated.js`.
5. `main/local-ai/manager.js` stores capture metadata locally through
   `main/local-ai/storage.js`. Raw image bytes are not persisted in the current
   MVP path.
6. `buildManifest(epoch)` creates a conservative epoch manifest from locally
   captured metadata only when flips satisfy the eligibility rules.
7. `buildUpdateBundle(epoch)` reads the manifest and emits a local metadata-only
   bundle for later manual exchange.
8. `importUpdateBundle(filePath)` verifies schema, compatibility, signature
   metadata, and replay protection before storing an accepted bundle locally.
9. `aggregateAcceptedBundles()` reads accepted bundles and writes an aggregation
   result. At the current MVP stage this remains a guarded no-op when no real
   deltas are present.
10. `main/local-ai/sidecar.js` provides the optional local runtime interface.
    The current Ollama-backed `chat` path operates on text, and
    `flipToText` uses local vision inference with the configured Ollama vision
    model. The Local AI flip checker is advisory only and does not make final
    solve decisions. The existing cloud provider bridge is not replaced.
11. `buildTrainingCandidatePackage(epoch)` creates a local-only package from
    eligible finalized captures after the available final-consensus signal is
    present. Reported, unresolved, and invalid items are excluded when those
    signals are available.

## Trust Boundaries And Safety Rules

- Raw/private flips remain local.
- Raw/private flip images in the current `flipToText` path are processed only
  through the local Ollama runtime and are not uploaded through a cloud path.
- Raw/private flip images used by the advisory checker also remain local and are
  not uploaded through a cloud path.
- The MVP local path does not upload bundles, captures, manifests, or
  aggregation outputs anywhere.
- Future unknown flips must remain private until consensus is available.
- Training eligibility is conservative:
  - no final consensus means exclusion
  - reported flips are excluded
  - invalid/rejected consensus answers are excluded
  - epoch mismatches are excluded
  - missing local metadata is excluded
- Training-candidate packages contain only safe local metadata and consensus
  labels. Raw/private flip images are not included.
- Bundle acceptance is gated by:
  - schema validation
  - base model ID/hash compatibility
  - signature metadata checks
  - nonce replay protection
  - duplicate bundle detection
  - rejection of raw image payloads
- malformed or rejected bundles fail closed and are not added to accepted local
  bundle storage
- Placeholder signatures are integrity-only, not production-grade identity
  proof.
- Cloud-provider behavior should remain unchanged unless Local AI is explicitly
  enabled or a local-compatible provider is explicitly selected.

## Current Status Vs Future Roadmap

### Implemented now

- Local AI settings and guardrails
- local capture metadata path
- local storage helpers with atomic JSON writes
- conservative manifest generation
- local bundle build/import
- replay protection
- metadata-only aggregation output
- optional sidecar health/models/chat interface
- focused Local AI tests

### Partial or stubbed now

- sidecar runtime start/stop currently marks intent and probes reachability
- local sidecar script is a small loopback-only stub by default, not a real
  training runtime
- placeholder signature handling is explicit but not yet equivalent to real
  verifier-backed identity checks
- aggregation records readiness, accepted/rejected counts, and compatibility but
  does not merge real model deltas yet

### Later phases

- stronger sidecar OCR/caption/training capabilities
- real adapter/LoRA delta generation and exchange
- stronger verification and Node-RPC trust checks
- more robust aggregation, clipping, and minimum-data thresholds
- deployment and selection of improved shared artifacts
- optional automated relay/coordinator flows
- optional later decentralized multi-trainer candidate competition

That last item is roadmap-only. It is not part of the current MVP and should
not be implemented prematurely.

## File Map

- Settings state:
  `renderer/shared/providers/settings-context.js`
- AI settings UI:
  `renderer/pages/settings/ai.js`
- Validation capture hook:
  `renderer/pages/validation.js`
  `renderer/screens/validation/machine.js`
- Main-process IPC registration:
  `main/index.js`
- Local AI manager:
  `main/local-ai/manager.js`
- Local AI storage:
  `main/local-ai/storage.js`
- Local AI bundle/import/aggregation helpers:
  `main/local-ai/federated.js`
- Optional local sidecar interface:
  `main/local-ai/sidecar.js`
- Optional stub sidecar:
  `scripts/local_ai_server.py`
- Local AI tests:
  `main/local-ai/storage.test.js`
  `main/local-ai/manager.test.js`
  `main/local-ai/federated.test.js`
  `main/local-ai/sidecar.test.js`

## Developer Guardrails

- Prefer minimal diffs and reuse the existing app architecture.
- Keep cloud provider paths stable and backward-compatible.
- Do not upload private flip data from the Local AI path.
- Do not persist raw decoded image bytes unless a later task explicitly requires
  it and justifies the privacy boundary.
- Do not fake production-grade signing, verification, or model deltas.
- Keep placeholder behavior clearly labeled as placeholder or MVP-only.
- Reject suspicious or incomplete data conservatively.
- Do not implement later roadmap items early, especially relay automation,
  production federated logic, or decentralized multi-trainer competition.
