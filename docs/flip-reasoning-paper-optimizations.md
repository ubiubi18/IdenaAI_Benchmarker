# FLIP Paper Optimization Notes (arXiv:2504.12256v1)

## Source

- Paper file reviewed locally: `$DOWNLOADS/2504.12256v1.pdf`
- Main findings used here:
  - Caption-first pipelines often outperform direct image-only prompting in FLIP-like tasks.
- Ensemble methods materially improve accuracy over single models.
- Subset/weighted combinations outperform naive all-model majority voting.
- Extended backlog derived from the later prompt/pipeline PDF review:
  - [flip-prompt-pipeline-backlog.md](./flip-prompt-pipeline-backlog.md)

## Applied in app

1. Multi-provider ensemble support is implemented (up to 3 consultants per flip).
2. Ensemble now supports weighted averaging, not only equal averaging.
3. Per-consultant weights are configurable in AI settings and propagated to validation + builder runs.
4. Logs now include consultant weights and ensemble weight totals.

## Why this matters for newer models

- New model generations can be plugged in without protocol changes by setting model IDs in settings.
- Weighted ensembles let us quickly calibrate stronger/weaker models as new APIs arrive.
- We can keep the same benchmark flow while updating only:
  - selected models
  - consultant weights
  - timeout/token constraints

## Recommended next optimization steps

1. Add per-model historical calibration:
   - automatically update consultant weights from recent labeled benchmark runs.
2. Add optional two-stage caption-first mode:
   - pass 1: concise per-frame caption summary
   - pass 2: decision from summaries.
3. Add adaptive fallback policy for low confidence:
   - if confidence below threshold and time remains, trigger second pass with stricter prompt.
4. Add online model registry file for quick updates:
   - local JSON for model presets and optional pricing metadata.

## Constraints to keep benchmark fair

- Keep sequential flip processing for visible real-time behavior and controlled rate limits.
- Keep full telemetry:
  - answer, confidence, latency, prompt/completion/total tokens, provider errors.
- Keep short-session budget explicit (6 flips / 60 seconds target) and always logged.
