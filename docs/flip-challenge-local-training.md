# Local FLIP-Challenge Training for IdenaAI

This repo includes helper scripts to prepare the [FLIP-Challenge dataset](https://huggingface.co/datasets/aplesner-eth/FLIP-Challenge) for local multimodal LoRA training.

This document is intentionally generic. It does not assume a specific username, filesystem layout, or hardware profile.

## Before you start

Local training can put sustained load on your machine.

Possible effects:
- high CPU/GPU usage
- elevated temperatures
- fan noise
- reduced responsiveness
- large first-time model downloads
- multi-hour runtimes on larger training slices

You should:
- start with a small pilot, not the full dataset
- keep the machine on reliable power
- watch Activity Monitor or an equivalent system monitor
- stop the run if thermals, memory pressure, or responsiveness become unacceptable
- adjust batch size, dataset size, and model size to your hardware

This workflow is for experimentation. Use it carefully and at your own risk.

If your machine becomes too hot or the longer runs are not practical, use the optional cloud path instead:
- [flip-challenge-cloud-training.md](./flip-challenge-cloud-training.md)

## Important limitation

The app's built-in Local AI fine-tune controls still expect a custom local sidecar with a `/train` endpoint.

That means:
- Ollama is fine for inference and chat
- local training uses a separate stack
- the scripts in this repo are the recommended path for local experiments

## Recommended local Mac path

For the current human-annotation workflow on a Mac:
- local annotation / inference recommendation:
  - Ollama at `http://127.0.0.1:11434`
  - vision model: `qwen2.5vl:7b`
- local MLX training recommendation on stronger Macs:
  - `mlx-community/Qwen2.5-VL-7B-Instruct-4bit`
- safe smaller fallback:
  - `mlx-community/Qwen2-VL-2B-Instruct-4bit`

Why both exist:
- `qwen2.5vl:7b` is the stronger local image-grounded runtime path for annotation help and smoke benchmarking
- `Qwen2.5-VL-7B-Instruct-4bit` is the straightforward MLX training upgrade path on stronger Macs
- `Qwen2-VL-2B-Instruct-4bit` remains the smaller fallback when 7B is too slow, too hot, or too memory-heavy

Recommended staged order:
1. pull the Ollama model
2. run a 10-flip local smoke benchmark
3. run a small human-annotation matrix
4. run a 7B pilot train
5. run held-out evaluation before scaling further

Recommended commands:

```bash
ollama pull qwen2.5vl:7b
```

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/run_local_flip_ollama_smoke.py --input samples/flips/flip-challenge-test-20-decoded-labeled.json --model qwen2.5vl:7b --mode native_direct_ab --max-flips 10 --output .tmp/flip-train/smoke-qwen2.5vl-7b.json
```

## Recommended staged approach

Do not begin with a full-corpus run. Validate the pipeline first, then scale up in steps.

Suggested order:
1. prepare a small pilot dataset
2. run a 1-epoch LoRA pilot on a smaller model
3. inspect outputs and failure modes
4. scale to larger slices only if the pilot is healthy

## Training environment

Run these commands from the repository root:

```bash
python3 -m venv .tmp/flip-train-venv
source .tmp/flip-train-venv/bin/activate
python -m pip install -U pip setuptools wheel
python -m pip install mlx-vlm pyarrow pillow datasets huggingface_hub torch torchvision
```

## Stage 1: prepare a pilot dataset

Training slice:

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/prepare_flip_challenge_mlx_vlm.py \
  --split train \
  --max-flips 500 \
  --output-dir .tmp/flip-train/pilot-train-500
```

Held-out validation slice:

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/prepare_flip_challenge_mlx_vlm.py \
  --split validation \
  --max-flips 200 \
  --output-dir .tmp/flip-train/pilot-val-200
```

### Optional: include human-teacher annotations in prep

If you already have normalized human-teacher annotations, the prep script can
now blend them directly into the training dataset.

Supported modes:
- `none`: baseline preparation, ignore human annotations
- `weight_boost`: keep the original answer target, but increase
  `training_weight` for useful human-annotated examples
- `followup_reasoning`: keep the original answer target and add a second
  supervised human-teacher follow-up turn with the rationale
- `hybrid`: apply both the weight boost and the rationale follow-up turn

If multiple humans annotated the same flip, you can also choose how those rows
are merged before training augmentation:
- `best_single`: keep only the strongest single annotation row per flip
- `deepfunding`: use the forked `scoring` mechanism to weight repeated
  annotators against consensus-backed answers and build one merged annotation
  per flip

Expected annotation input:
- normalized JSONL from:
  - `python scripts/import_human_teacher_annotations.py ...`

Example hybrid preparation:

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/prepare_flip_challenge_mlx_vlm.py \
  --split train \
  --max-flips 500 \
  --output-dir .tmp/flip-train/pilot-train-500-human \
  --prompt-family runtime_aligned_native_frames_v2 \
  --image-mode native_frames \
  --human-annotations-jsonl .tmp/human-teacher/normalized.jsonl \
  --human-annotation-mode hybrid \
  --human-annotation-aggregation deepfunding \
  --human-min-quality-tier bronze \
  --human-weight-scale 1.0
```

The prepared manifest will record:
- how many human annotations were loaded
- how many records received weight boosts
- how many received follow-up reasoning turns
- which quality tiers were applied

## Stage 2: run a first LoRA pilot

Safe initial base:
- `mlx-community/Qwen2-VL-2B-Instruct-4bit`

Recommended upgrade base on a stronger Mac:
- `mlx-community/Qwen2.5-VL-7B-Instruct-4bit`

Pilot run:

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/train_flip_challenge_mlx_vlm.py --dataset-path .tmp/flip-train/pilot-train-500/hf-dataset --model-path mlx-community/Qwen2-VL-2B-Instruct-4bit --output-dir .tmp/flip-train/runs/Idena-multimodal-v1-pilot-500-2b --epochs 1 --batch-size 1 --learning-rate 1e-4 --lora-rank 10
```

7B pilot run on a stronger Mac:

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/train_flip_challenge_mlx_vlm.py --dataset-path .tmp/flip-train/pilot-train-500/hf-dataset --model-path mlx-community/Qwen2.5-VL-7B-Instruct-4bit --output-dir .tmp/flip-train/runs/Idena-multimodal-v1-pilot-500-7b --epochs 1 --batch-size 1 --learning-rate 1e-4 --lora-rank 10
```

Held-out evaluation:

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/evaluate_flip_challenge_mlx_vlm.py --dataset-path .tmp/flip-train/pilot-val-200/hf-dataset --model-path mlx-community/Qwen2.5-VL-7B-Instruct-4bit --adapter-path .tmp/flip-train/runs/Idena-multimodal-v1-pilot-500-7b/adapters.safetensors --output .tmp/flip-train/runs/Idena-multimodal-v1-pilot-500-7b/eval.json
```

If you prepared a human-assisted dataset, just point `--dataset-path` at that
prepared `hf-dataset/` directory. The trainer itself does not need a special
human-annotation flag because the prep stage already bakes the weighting and
follow-up turns into the dataset rows.

## Stage 3: scale carefully

If the pilot is stable and useful, scale in increments instead of jumping straight to the full corpus.

Typical progression:
- 2,000 examples
- 5,000 examples
- 10,000 examples
- only then consider the full train split

Example:

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/prepare_flip_challenge_mlx_vlm.py \
  --split train \
  --max-flips 2000 \
  --output-dir .tmp/flip-train/train-2000
```

## Compare baseline vs human-assisted runs

The easiest way to compare training styles on the same small slice is the
matrix runner:

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/run_flip_human_annotation_matrix.py --output-root .tmp/flip-train/human-matrix --train-split train --max-flips 30 --prompt-family runtime_aligned_native_frames_v2 --image-mode native_frames --human-annotations-jsonl .tmp/human-teacher/normalized.jsonl --human-annotation-aggregations best_single deepfunding --eval-dataset-path .tmp/flip-train/pilot-val-200/hf-dataset --modes baseline weight_boost followup_reasoning hybrid
```

Same matrix on the 7B MLX base:

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/run_flip_human_annotation_matrix.py --output-root .tmp/flip-train/human-matrix-7b --train-split train --max-flips 30 --prompt-family runtime_aligned_native_frames_v2 --image-mode native_frames --human-annotations-jsonl .tmp/human-teacher/normalized.jsonl --human-annotation-aggregations best_single deepfunding --eval-dataset-path .tmp/flip-train/pilot-val-200/hf-dataset --modes baseline weight_boost followup_reasoning hybrid --model-path mlx-community/Qwen2.5-VL-7B-Instruct-4bit
```

This runner keeps the current evaluator compatible and simply orchestrates:
1. prepare dataset
2. train adapter
3. evaluate adapter on the same holdout

That makes it suitable for small experiments where you want to find out which
human annotation style actually helps:
- answer-only with higher weight
- short rationale follow-up
- both at once
- and, when multiple annotators exist, `best_single` vs `deepfunding`

It writes:
- per-mode prepared manifests
- per-mode run summaries
- optional per-mode evaluation reports
- one combined `matrix-summary.json`

By default, matrix results are kept for only the newest `3` epoch snapshots under:
- `.tmp/flip-train/human-matrix/epochs/<epoch-key>/`

Older epoch snapshots are pruned automatically. The top-level:
- `.tmp/flip-train/human-matrix/matrix-summary.json`

always points to the latest run for compatibility with the leaderboard and any
existing tooling.

The combined `matrix-summary.json` now also includes a `comparisons` block with:
- one compact metrics row per run
- best run per training mode
- best run per aggregation mode
- overall best run on the key metrics

To print a quick terminal leaderboard from that summary:

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/print_flip_human_annotation_leaderboard.py \
  --summary-path .tmp/flip-train/human-matrix/matrix-summary.json \
  --sort-by accuracy
```

Useful variants:
- Markdown table for notes or PRs:

```bash
python scripts/print_flip_human_annotation_leaderboard.py \
  --summary-path .tmp/flip-train/human-matrix/matrix-summary.json \
  --format markdown
```

- Only compare DeepFunding runs:

```bash
python scripts/print_flip_human_annotation_leaderboard.py \
  --summary-path .tmp/flip-train/human-matrix/matrix-summary.json \
  --aggregation deepfunding \
  --sort-by accuracy
```

- Export a spreadsheet-friendly CSV:

```bash
python scripts/print_flip_human_annotation_leaderboard.py \
  --summary-path .tmp/flip-train/human-matrix/matrix-summary.json \
  --format csv \
  --output .tmp/flip-train/human-matrix/leaderboard.csv
```

Recommended first experiment:
- use a small fixed FLIP slice such as `30-50` flips
- compare `baseline`, `weight_boost`, and `hybrid`
- only scale further if one mode clearly beats the others on the same holdout

## Larger model later, not first

If you later want a stronger local training base and your Mac can sustain it, use:
- `mlx-community/Qwen2.5-VL-7B-Instruct-4bit`

Do that only after the smaller pilot path is proven on your system.

## Output layout

Prepared dataset directories look like this:

```text
.tmp/flip-train/pilot-train-500/
  hf-dataset/
  images/
  manifest.json
  train.jsonl
```

The trainer consumes:
- `hf-dataset/`

The other files help with:
- inspection
- reproducibility
- audits

Human-assisted prepared datasets may also contain:
- `human_annotation_available`
- `human_annotation_quality_tier`
- `human_annotation_quality_score`
- `evaluation_messages`

`evaluation_messages` is used only to keep evaluation anchored to the original
decision prompt when the training record includes an extra human follow-up turn.

## Recommended monitoring

During training, watch:
- process CPU and memory usage
- system temperature and fan activity
- free disk space
- whether the run directory is producing adapter and summary outputs

If your system shows signs of stress, stop the run and reduce:
- model size
- dataset size
- epoch count
- concurrent workload on the machine
