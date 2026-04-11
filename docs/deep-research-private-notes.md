# Deep Research Private Notes

## Purpose

This private repository is the forward-moving development home for the Idena desktop fork and its future local-AI and federated-learning extensions.

## Migration status

- Private repo is created and active: `ubiubi18/IdenaAI`
- Public repo is preserved as the historical/reference source: `ubiubi18/IdenaAI_Benchmarker`
- Local development branch for the migration track is `local-ai`
- Current phase is repository readiness, indexing readiness, and workflow hardening only

## Later roadmap areas

- Local AI mode for desktop-assisted solving and generation workflows
- Federated-learning support and related coordination/data plumbing
- Private-repo-first research workflow for ChatGPT Deep Research and Codex

## Likely later touchpoints

- `main/ai-providers/`
- `main/ai-test-unit.js`
- `renderer/pages/settings/ai.js`
- `renderer/pages/validation.js`
- `renderer/pages/flips/new.js`
- `renderer/screens/validation/ai/`
- `scripts/` for local datasets, indexing, and reproducibility helpers
- `idena-go/` only when protocol or federated-learning work is explicitly started

## Explicitly out of scope in this phase

- No local inference/runtime sidecar implementation yet
- No relay/trainer election/model-candidate competition yet; current MVP capture work is local-only
- No federated-learning protocol or transport implementation yet
- No main-process status/start/stop/capture handlers yet; current MVP change is renderer-side local capture only
- No changes to the public repo in this step
