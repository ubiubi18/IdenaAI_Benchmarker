# Research Index Integration

This repository includes a reproducible index so research or coding assistants
can ingest project context with minimal ambiguity.

## 1. Generate/refresh the index

```bash
cd /path/to/IdenaAI
npm run index:deep-research
```

This writes:

- `docs/deep-research-index.json` (machine-readable master index)

## 2. Current workflow

- Keep the repository index fresh before large research or implementation runs.
- Prefer the machine-readable index over ad hoc file discovery.
- Treat the listed files as the primary handoff set for external tooling.

## 3. Recommended file set to provide to external research tools

Always include:

- `docs/deep-research-index.json`
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

## 4. Prompt template

Use this starter prompt:

```text
Use docs/deep-research-index.json as the source-of-truth index.
Start with docs/context-snapshot.md and docs/worklog.md for recent context.
Prioritize files listed under sections.docs, sections.ai_backend, and sections.ai_ui.
When proposing changes, include exact file targets and minimal reversible patches.
Respect research benchmark constraints, cost/latency tracking, and local test-unit flow.
```

## 5. Harmonization rules for future changes

- Keep file paths stable; update index generation if paths move.
- Record major changes in `docs/worklog.md`.
- Keep AI provider behavior centralized in `main/ai-providers/bridge.js`.
- Keep flip-builder UX orchestration centralized in `renderer/pages/flips/new.js`.
- Keep the index and handoff notes current if repository structure changes.
