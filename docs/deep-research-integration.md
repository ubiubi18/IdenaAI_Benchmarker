# ChatGPT Deep Research Integration

This repository includes a reproducible index so ChatGPT Deep Research can ingest project context with minimal ambiguity.

## 1. Generate/refresh the index

```bash
cd /path/to/IdenaAI
npm run index:deep-research
```

This writes:

- `docs/deep-research-index.json` (machine-readable master index)

## 2. Current private-repo workflow

- Development home: `ubiubi18/IdenaAI`
- Public reference repo: `ubiubi18/IdenaAI_Benchmarker`
- Keep `origin` on the private repo
- Keep `upstream` on the public repo
- Use `local-ai` for the current private migration track
- Do not target the public repo for new changes by mistake

## 3. Recommended file set to provide to Deep Research

Always include:

- `docs/deep-research-index.json`
- `docs/private-repo-codex-context.md`
- `docs/deep-research-private-notes.md`
- `docs/context-snapshot.md`
- `docs/fork-plan.md`
- `docs/worklog.md`
- `docs/flip-format-reference.md`
- `main/ai-providers/bridge.js`
- `renderer/pages/flips/new.js`

Optional (for dataset + audits):

- `docs/flip-challenge-import.md`
- `docs/flip-consensus-audit.md`
- `scripts/import_flip_challenge.py`
- `scripts/audit_flip_consensus.py`

## 4. Prompt template for Deep Research

Use this starter prompt:

```text
Use docs/deep-research-index.json as the source-of-truth index.
Start with docs/private-repo-codex-context.md and docs/deep-research-private-notes.md.
Treat the public repo as reference-only and target the private repo for future work.
Prioritize files listed under sections.docs, sections.ai_backend, and sections.ai_ui.
When proposing changes, include exact file targets and minimal reversible patches.
Respect research benchmark constraints, cost/latency tracking, and local test-unit flow.
```

## 5. Harmonization rules for future changes

- Keep file paths stable; update index generation if paths move.
- Record major changes in `docs/worklog.md`.
- Keep AI provider behavior centralized in `main/ai-providers/bridge.js`.
- Keep flip-builder UX orchestration centralized in `renderer/pages/flips/new.js`.
- Keep private-repo workflow notes current if remotes or branch policy change.
