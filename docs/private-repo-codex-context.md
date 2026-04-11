# Private Repo Codex Context

## Current development home

- Private repo: `ubiubi18/IdenaAI`
- Public reference repo: `ubiubi18/IdenaAI_Benchmarker`
- Local working branch for this migration track: `local-ai`

## Remote rules

- `origin` must remain the private repo.
- `upstream` must remain the public repo.
- Future Codex and Deep Research work should target `origin`, not `upstream`.

## Guardrails

- Do not push new work to the public repo unless explicitly told to do so.
- Treat the public repo as reference-only during this phase.
- Before any push, verify `git remote -v` and `git branch --show-current`.
- Keep application behavior unchanged unless a task explicitly asks for code changes.

## Session start checks

```bash
git remote -v
git branch --show-current
git status --short --branch
```

Expected working state:

- `origin` -> `https://github.com/ubiubi18/IdenaAI.git`
- `upstream` -> `https://github.com/ubiubi18/IdenaAI_Benchmarker.git`
- active branch -> `local-ai`
- clean working tree before starting new work
