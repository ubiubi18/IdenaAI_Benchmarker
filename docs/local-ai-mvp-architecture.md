# Local AI MVP Architecture

## Purpose

This repository remains the active research home for the desktop fork and its
Local AI work.

The Local AI lane is back in embryo stage. The architecture notes below are
therefore intentionally generic and should not be read as an endorsement of any
specific shipped base model family.

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
- Ollama-backed Local AI chat plus a custom local runtime service path for
  research stacks such as `Molmo2-O`
- image-aware `flipToText` inference when the operator explicitly configures a
  local multimodal model
- advisory Local AI flip checker with `consistent` / `ambiguous` /
  `inconsistent` sequence classifications
- post-consensus Local AI training-candidate packaging for eligible local items
- focused Jest tests for the Local AI plumbing

Still placeholder or stubbed:

- no approved local base model ships by default
- sidecar `caption`, `ocr`, and `train` remain interface-heavy research paths
- local FLIP training stays experimental and must be configured manually
- image-aware `flipToText` and the flip checker remain advisory only
- main-process signing verification does not yet perform full Node-RPC trust
  validation
- update bundles are still metadata-first and currently use `deltaType: "none"`
  by default
- aggregation currently produces a `metadata_only_noop` result until real
  adapter/LoRA deltas exist
- training-candidate packaging is preparation only: no federated exchange is
  performed yet
- no relay/coordinator networking, automated sharing, or federated aggregation
  protocol exists yet

## Model Policy

Current posture:

- no bundled local runtime model is approved by default
- no bundled local training model is approved by default
- any local runtime or training model must be configured deliberately by the
  operator
- the current research candidate is `allenai/Molmo2-O-7B` on a custom local
  runtime service, but it is not treated as a shipped default
- future base-layer candidates should be evaluated for transparency,
  inspectability, and controllability before they are recommended

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
    The current local chat path operates on text, and `flipToText` uses local
    vision inference only when the operator configured a local vision-capable
    model. The Local AI flip checker is advisory only and does not make final
    solve decisions. The existing cloud provider bridge is not replaced.
11. `buildTrainingCandidatePackage(epoch)` creates a local-only package from
    eligible finalized captures after the available final-consensus signal is
    present. Reported, unresolved, and invalid items are excluded when those
    signals are available.

## Trust Boundaries And Safety Rules

- Raw/private flips remain local.
- Raw/private flip images in the current `flipToText` path are processed only
  through a local runtime service on the same machine and are not uploaded
  through a cloud path.
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
