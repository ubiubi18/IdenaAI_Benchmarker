# Local FLIP-Challenge Training for IdenaAI

The local training toolchain remains in this repository for research, but
`IdenaAI` is back in embryo stage and does not currently approve or ship a base
model by default.

## Current posture

- local training is research-only
- no default runtime model is endorsed
- no default MLX training model is endorsed
- `allenai/Molmo2-O-7B` is the current research candidate, but only as an
  operator-supplied base on a custom local stack
- any training run must provide its own explicit `--model-path`
- operators are responsible for checking license, provenance, and model
  suitability before training

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
- stop the run if thermals, memory pressure, or responsiveness become
  unacceptable
- adjust batch size, dataset size, and model size to your hardware

This workflow is for experimentation. Use it carefully and at your own risk.

If your machine becomes too hot or longer runs are not practical, use the
optional cloud path instead:

- [flip-challenge-cloud-training.md](./flip-challenge-cloud-training.md)

## Important limitation

The app's built-in Local AI fine-tune controls still expect a custom local
sidecar with a `/train` endpoint.

That means:

- Ollama is fine for inference and chat
- the current `Molmo2-O` research track uses a custom local runtime service
  rather than an Ollama pull
- local training uses a separate stack
- the scripts in this repo are the recommended path for local experiments

## Generic staged approach

Suggested order:

1. verify the local runtime with a small smoke test
2. prepare a small pilot dataset
3. add a small human-annotation batch if available
4. run a 1-epoch LoRA pilot on an explicitly chosen local base model
5. run held-out evaluation with deterministic settings
6. scale to larger slices only if the pilot is healthy

## Training environment

Run these commands from the repository root:

```bash
python3.11 -m venv .tmp/flip-train-venv-py311
source .tmp/flip-train-venv-py311/bin/activate
python -m pip install -U pip setuptools wheel
python -m pip install mlx-vlm pyarrow pillow datasets huggingface_hub torch torchvision
```

## Embryo-stage rule

Every script in `scripts/` now requires an explicit `--model-path` or `--model`
for local research runs. If you do not provide one, the script should fail
closed instead of silently falling back to an old base-model assumption.
