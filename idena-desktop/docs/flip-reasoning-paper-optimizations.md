# FLIP Paper Optimization Notes (arXiv:2504.12256v1)

## Source

- Paper reviewed: arXiv `2504.12256v1`
- Main findings used here:
  - Caption-first pipelines often outperform direct image-only prompting in FLIP-like tasks.
  - Ensemble methods can improve accuracy over single models.
  - Weighted subsets can outperform naive equal-vote ensembles.

## Applied in app

1. Multi-provider ensemble support is implemented (up to 3 consultants per flip).
2. Ensemble supports weighted averaging.
3. Consultant weights are configurable in AI settings and used in validation + builder runs.
4. Logs include consultant weights and ensemble totals.

## Why this matters for newer models

- New model generations can be plugged in by changing model IDs in settings.
- Weighted ensembles help calibrate stronger/weaker models over time.
- Benchmark flow remains stable while changing:
  - selected models
  - consultant weights
  - timeout/token constraints

## Recommended next optimization steps

1. Add per-model historical calibration from labeled benchmark runs.
2. Add optional two-stage caption-first mode:
   - pass 1: concise per-frame caption summary
   - pass 2: decision from summaries
3. Add adaptive low-confidence fallback when time remains.
4. Add online model registry for presets + pricing metadata.

## Fairness constraints

- Keep sequential processing for visible real-time behavior and rate-limit control.
- Keep full telemetry:
  - answer, confidence, latency, prompt/completion/total tokens, provider errors
- Keep short-session target explicit (6 flips / 60 seconds) and always logged.
