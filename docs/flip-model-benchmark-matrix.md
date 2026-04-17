# FLIP Model Benchmark Matrix

This document defines the next concrete FLIP benchmarking path for the real
`IdenaAI` repo.

It is intended to answer:
- which model should replace `Qwen2-VL-2B-Instruct-4bit` as the main local
  FLIP baseline
- which inference mode should be preferred for local short-session solving
- which evaluation slices should be treated as gating checks before larger
  training runs

## Current position

Current practical baseline:
- local training safe fallback: `mlx-community/Qwen2-VL-2B-Instruct-4bit`
- local training stronger fallback: `mlx-community/Qwen2.5-VL-7B-Instruct-4bit`
- local training recommended strong-Mac target: `mlx-community/Qwen3.5-9B-MLX-4bit`
- local runtime vision baseline: `qwen2.5vl:7b` via Ollama where available

Recommended local Mac preset:
- Ollama base URL: `http://127.0.0.1:11434`
- local vision runtime: `qwen2.5vl:7b`
- local MLX training target: `mlx-community/Qwen3.5-9B-MLX-4bit`
- stronger MLX fallback: `mlx-community/Qwen2.5-VL-7B-Instruct-4bit`
- smaller MLX fallback: `mlx-community/Qwen2-VL-2B-Instruct-4bit`

Model-role split:
- runtime model: `qwen2.5vl:7b`
- training model: `mlx-community/Qwen3.5-9B-MLX-4bit`
- benchmark candidate: the same MLX base used for held-out adapter evaluation unless overridden
- fallback candidates: `mlx-community/Qwen2.5-VL-7B-Instruct-4bit`, then `mlx-community/Qwen2-VL-2B-Instruct-4bit`

Qwen3.5 evaluation policy:
- keep FLIP evaluation deterministic
- use `--mode score` and `--temperature 0.0`
- avoid treating Qwen3.5 free-form thinking output as the main gate

Known findings so far:
- older direct A/B runs collapsed to one option slot
- later native-frame runs improved held-out accuracy but still showed canonical
  bias
- prompt quality alone is not enough; candidate-order randomization and
  explicit bias diagnostics are required
- caption-first or separate-candidate scoring is likely more important than
  simply scaling the same direct-choice prompt

## Benchmark goals

Every benchmark cycle should measure:
- canonical accuracy
- candidate-slot bias
- swap consistency
- skip/report behavior
- latency
- provider/runtime failures

For short-session local solving, the main operational target remains:
- `6 flips <= 80 seconds total`

## Model matrix

### Tier 1: must benchmark

| Model | Role | Backend | Why |
| --- | --- | --- | --- |
| `Qwen2-VL-2B-Instruct-4bit` | Control | MLX | Existing training/eval baseline |
| `qwen2.5vl:7b` | Main local runtime candidate | Ollama | Stronger open local vision baseline already available locally |
| `Qwen3.5-9B-MLX-4bit` | Main local training target | MLX | Recommended strong-Mac training/eval path |
| `Qwen2.5-VL-7B-Instruct-4bit` | Stronger fallback training target | MLX | Reproducible fallback when Qwen3.5-9B is too heavy |

### Tier 2: should benchmark if time allows

| Model | Role | Backend | Why |
| --- | --- | --- | --- |
| `Qwen2.5-VL-3B` or closest local equivalent | Smaller local upgrade | Ollama / MLX / cloud | Better than 2B without 7B cost |
| `Phi-4-multimodal-instruct` | Alternate strong open model | cloud / external local path | Useful comparison against Qwen family bias patterns |

## Inference mode matrix

Every candidate model should be tested in these modes:

1. `native_direct_ab`
   - native frames
   - direct `a|b|skip` choice
   - current minimum viable path

2. `native_two_pass`
   - pass 1: captions, OCR, translation, summaries, report-risk
   - pass 2: final decision from structured JSON
   - expected to reduce shallow visual shortcutting

3. `native_separate_candidate_scoring`
   - score candidate A and candidate B independently
   - compare scores deterministically in code
   - expected to reduce candidate-slot collapse the most

4. `composite_direct_ab`
   - keep only as a compatibility/control mode
   - do not treat as the main research direction

## Evaluation slices

Use fixed evaluation slices so runs remain comparable.

### Slice A: smoke

- size: `10`
- purpose:
  - verify runtime wiring
  - catch catastrophic collapse quickly
  - measure rough latency

Pass conditions:
- no provider/runtime errors
- no total collapse to one candidate slot
- latency acceptable for the chosen mode

### Slice B: fixed holdout

- size: `50`
- purpose:
  - standard regression comparison
  - compare with earlier recorded results

Always report:
- `accuracy`
- `predicted_counts`
- `candidate_counts`
- `candidate_slot_bias_score`
- confusion matrix
- mean/median latency

### Slice C: balanced holdout

- size: `50`
- design:
  - approximately balanced canonical `left/right`
  - includes swap-presentation variants

Purpose:
- detect canonical-answer collapse that can hide inside an imbalanced holdout

### Slice D: swap consistency

- run the same flips twice:
  - once with candidate A shown first
  - once with candidate B shown first

Track:
- canonical agreement rate
- candidate-slot disagreement rate
- confidence drop after remap

## Gating thresholds

### Runtime gating

A model/mode pair is worth further work only if:
- `6 flips <= 80s`
- provider/runtime errors are `0` or very close to `0`
- `candidate_slot_bias_score <= 0.20`

### Quality gating

Before launching larger training work, require:
- `>= 60%` on the fixed 50-flip holdout
- no near-total collapse in `predicted_counts`
- no near-total collapse in `candidate_counts`
- acceptable swap consistency

### Promotion rule

Promote a model/mode to the next stage only if it beats the current control on:
- accuracy
- candidate-slot bias
- swap consistency

Do not promote based on one metric alone.

## Recommended execution order

### Stage 1: runtime baseline refresh

Run these first:
- `qwen2.5vl:7b` + `native_direct_ab`
- `qwen2.5vl:7b` + `native_two_pass`
- `qwen2.5vl:7b` + `native_separate_candidate_scoring` once implemented

Goal:
- determine whether runtime prompt structure alone can improve over the current
  local baseline

Observed local baseline on 2026-04-15:

| Model | Mode | Slice | Accuracy | Candidate slot bias | Mean latency |
| --- | --- | --- | --- | --- | --- |
| `qwen2.5vl:7b` | `native_direct_ab` | bundled `5` | `60%` | `0.50` | `11.3s/flip` |
| `qwen2.5vl:7b` | `native_two_pass` | bundled `5` | `40%` | `0.50` | `32.1s/flip` |
| `qwen2.5vl:7b` | `native_separate_candidate_scoring` | bundled `5` | `60%` | `0.17` | `23.6s/flip` |
| `qwen2.5vl:7b` | `native_direct_ab` | first `10` of bundled `20` | `50%` | `0.20` | `13.6s/flip` |
| `qwen2.5vl:7b` | `native_two_pass` | first `10` of bundled `20` | `30%` | `0.50` | `26.5s/flip` |

Current interpretation:
- `native_direct_ab` is the only local path that is both reasonably fast and
  not obviously broken.
- `native_two_pass` is currently too slow for short session and still collapses
  to one candidate slot.
- `native_separate_candidate_scoring` reduces slot bias, but in its current
  form it is too slow for short session and too conservative on ambiguous
  cases.

### Stage 2: adapter comparison

Compare:
- current `Qwen2-VL-2B` adapters
- `Qwen2.5-VL-7B` fallback adapters
- `Qwen3.5-9B` adapters

Goal:
- determine whether training improvements survive against the stronger runtime
  baseline

### Stage 3: larger training investment

Only after Stage 1 and 2:
- run the next serious native-frame training on the best prompt family
- prefer cloud/CUDA for multi-hour 7B runs

## Immediate next benchmark set

Run these next in order:

1. `qwen2.5vl:7b` + `native_direct_ab` on smoke `10`
2. `qwen2.5vl:7b` + `native_two_pass` on smoke `10`
3. best of those two on fixed holdout `50`
4. same winner on balanced holdout `50`
5. swap-consistency run on `10`

Recommended command sequence:

```bash
ollama pull qwen2.5vl:7b
```

```bash
source .tmp/flip-train-venv-py311/bin/activate
python scripts/run_local_flip_ollama_smoke.py --input samples/flips/flip-challenge-test-20-decoded-labeled.json --model qwen2.5vl:7b --mode native_direct_ab --max-flips 10 --output .tmp/flip-train/smoke-qwen2.5vl-7b.json
```

```bash
source .tmp/flip-train-venv-py311/bin/activate
python scripts/run_flip_human_annotation_matrix.py --output-root .tmp/flip-train/human-matrix-qwen3.5-9b --train-split train --max-flips 30 --prompt-family runtime_aligned_native_frames_v2 --image-mode native_frames --human-annotations-jsonl .tmp/human-teacher/normalized.jsonl --human-annotation-aggregations best_single deepfunding --eval-dataset-path .tmp/flip-train/pilot-val-200/hf-dataset --modes baseline weight_boost followup_reasoning hybrid --model-path mlx-community/Qwen3.5-9B-MLX-4bit
```

```bash
source .tmp/flip-train-venv-py311/bin/activate
python scripts/evaluate_flip_challenge_mlx_vlm.py --dataset-path .tmp/flip-train/pilot-val-200/hf-dataset --model-path mlx-community/Qwen3.5-9B-MLX-4bit --adapter-path .tmp/flip-train/runs/Idena-multimodal-v1-pilot-500-qwen3.5-9b/adapters.safetensors --output .tmp/flip-train/runs/Idena-multimodal-v1-pilot-500-qwen3.5-9b/eval.json --mode score --temperature 0.0
```

If `separate_candidate_scoring` becomes available before step 3, insert it
immediately after step 2.

## Success criteria for replacing the old baseline

`Qwen3.5-9B` should become the primary local MLX training target only if it:
- beats the current control and the 7B fallback on fixed holdout accuracy
- lowers `candidate_slot_bias_score`
- improves swap consistency
- stays reproducible enough to rerun on stronger Macs without constant manual recovery

If it is stronger but too slow, keep it as:
- the high-quality offline benchmark model
- while `Qwen2.5-VL-7B` or `Qwen2-VL-2B` remains the active MLX fallback and `qwen2.5vl:7b` remains the live short-session runtime
