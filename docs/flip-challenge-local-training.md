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
- [`/Users/jz/Documents/idena-benchmark-workspace/IdenaAI/docs/flip-challenge-cloud-training.md`](/Users/jz/Documents/idena-benchmark-workspace/IdenaAI/docs/flip-challenge-cloud-training.md)

## Important limitation

The app's built-in Local AI fine-tune controls still expect a custom local sidecar with a `/train` endpoint.

That means:
- Ollama is fine for inference and chat
- local training uses a separate stack
- the scripts in this repo are the recommended path for local experiments

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

## Stage 2: run a first LoRA pilot

Recommended initial base:
- `mlx-community/Qwen2-VL-2B-Instruct-4bit`

Pilot run:

```bash
source .tmp/flip-train-venv/bin/activate
python scripts/train_flip_challenge_mlx_vlm.py \
  --dataset-path .tmp/flip-train/pilot-train-500/hf-dataset \
  --model-path mlx-community/Qwen2-VL-2B-Instruct-4bit \
  --output-dir .tmp/flip-train/runs/Idena-multimodal-v1-pilot-500 \
  --epochs 1 \
  --batch-size 1 \
  --learning-rate 1e-4 \
  --lora-rank 10
```

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

## Larger model later, not first

If you later want a stronger branded runtime, you can try a larger MLX base such as:
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
