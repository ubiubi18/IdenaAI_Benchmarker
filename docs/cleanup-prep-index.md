# Cleanup Prep Index

This note is a compact handoff for the next deep research and cleanup pass. It
does not change the current MVP scope.

## A. Current Local AI MVP file map

- `renderer/shared/providers/settings-context.js`: `localAi` defaults,
  hydration, nested merge, and dispatch updates.
- `renderer/pages/settings/ai.js`: Local AI settings UI and sidecar control
  actions.
- `renderer/pages/validation.js`: guarded renderer capture send path.
- `renderer/screens/validation/machine.js`: decode hook that exposes decoded
  flip images to the capture path.
- `main/index.js`: Local AI IPC registration.
- `main/preload.js`: `global.localAi` renderer bridge.
- `main/local-ai/manager.js`: capture intake, runtime status, manifest build,
  and sidecar delegation.
- `main/local-ai/storage.js`: local path resolution, atomic JSON writes, and
  hashing helpers.
- `main/local-ai/federated.js`: bundle build, import verification, replay
  protection, and guarded aggregation.
- `main/local-ai/sidecar.js`: local sidecar HTTP helpers and graceful failure
  handling.
- `scripts/local_ai_server.py`: optional stub sidecar for local-only health,
  models, chat, caption, OCR, and train endpoints.
- `main/local-ai/storage.test.js`: storage safety tests.
- `main/local-ai/manager.test.js`: capture and manifest eligibility tests.
- `main/local-ai/federated.test.js`: bundle, import, replay, and aggregation
  tests.
- `main/local-ai/sidecar.test.js`: sidecar reachability and parsing tests.
- `docs/local-ai-mvp-architecture.md`: current Local AI architecture and trust
  boundaries.
- `docs/deep-research-index.json`: deep-research entrypoint index; currently
  partly stale and still worth checking before relying on it.

## B. Clearly intentional MVP / placeholder areas

- `main/local-ai/federated.js`: bundles are metadata-first and currently default
  to `deltaType: "none"`.
- `main/local-ai/federated.js`: placeholder signatures are explicit and must
  stay visibly distinct from real identity-backed signatures.
- `main/local-ai/federated.js`: aggregation may intentionally return
  `metadata_only_noop` instead of fabricating model output.
- `main/local-ai/manager.js`: start/stop mark runtime intent and probe
  reachability; they do not supervise a real sidecar process yet.
- `main/local-ai/sidecar.js` and `scripts/local_ai_server.py`: `caption`,
  `ocr`, and `train` are interface or stub endpoints, not real ML
  implementations yet.
- `renderer/pages/settings/ai.js`: Local AI is opt-in and does not replace the
  current cloud-provider path by default.
- `renderer/pages/validation.js` and `main/local-ai/manager.js`: the current
  capture path persists metadata only; raw decoded image bytes are not stored.

## C. Likely cleanup targets later

- `docs/deep-research-index.json`: repository metadata may drift from the
  current code layout and should be checked before relying on it.
- `docs/deep-research-integration.md`,
  `docs/local-ai-mvp-architecture.md`, and this file: overlapping
  documentation that may be consolidated after the next research pass.
- `main/index.js`, `main/preload.js`, and `renderer/pages/_app.js`: thin Local
  AI bridge wiring that may be simplified once the interface stabilizes.
- `renderer/pages/settings/ai.js` and
  `renderer/shared/providers/settings-context.js`: naming and schema consistency
  for `localAi` settings should be reviewed.
- `main/local-ai/federated.js`: manifest, bundle, import, and aggregation logic
  is intentionally grouped for MVP speed and may deserve a cleaner split later.
- Placeholder result modes, reasons, and status labels may be candidates for
  shared constants once the Local AI surface stops moving.

## D. Things that must NOT be "cleaned up" accidentally

- Conservative manifest exclusions such as `missing_consensus`, `reported`, and
  `epoch_mismatch`.
- Nonce replay protection and duplicate bundle detection.
- Base-model compatibility checks.
- Rejection of raw payloads and the raw-flip privacy boundary.
- Explicit placeholder labeling such as `placeholder_sha256`,
  `signature_unverifiable`, and `metadata_only_noop`.
- Opt-in Local AI behavior and the existing cloud-provider compatibility path.
- Guarded sidecar failure behavior when the local runtime is absent.

## E. Questions for the next deep research pass

- Where is there architecture drift between the current code and older docs or
  index metadata?
- Which parts of `main/local-ai/federated.js` should stay together, and which
  should split into smaller helpers?
- Are `localAi` settings names, manifest fields, bundle fields, and sidecar
  contract names consistent enough, or should schemas be normalized?
- Which placeholder paths should become real next: signature verification,
  sidecar supervision, or real delta generation?
- Is the current manifest -> bundle -> import -> aggregate flow overbuilt in
  some places and underbuilt in others?
- Should the `global.localAi` bridge stay separate from the existing AI
  provider bridge, or merge later?
- Which docs are authoritative, and which are now redundant or stale?
- If a later decentralized multi-trainer candidate phase is still desired, what
  extension points are actually worth preserving now without implementing it
  early?
