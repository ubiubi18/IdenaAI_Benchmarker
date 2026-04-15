# Optional Cloud GPU Training for IdenaAI

This document describes the optional external-GPU path for FLIP training.

Use this path when:
- local MLX training on a Mac is too slow or too thermally expensive
- you want longer runs without stressing a laptop
- you need exportable weights or LoRA adapters for an open local runtime

Do not use this path if you only want a hosted model behind someone else's API.

## What this path is for

This repo's current local training path uses:
- Apple Silicon
- `mlx_vlm`
- local LoRA adapters

That is good for:
- smoke runs
- small pilots
- debugging data preparation

It is not the best fit for:
- many-hour runs
- repeated medium/full-corpus experiments
- future federated weight contribution at scale

The optional cloud path is the next step. It should keep:
- the same prepared FLIP dataset structure
- open-weight bases
- exportable LoRA adapters

It should not depend on OpenAI-hosted fine-tuning for the final model, because that does not return local weights suitable for `IdenaAI`.

## Service choices

The practical options are:
- Lambda Cloud
- Modal
- Hugging Face Jobs
- Runpod or Vast.ai

Recommended order:
1. Lambda or Modal for the first Linux/CUDA port
2. Hugging Face Jobs once the trainer is stable and reproducible
3. Runpod/Vast when you want lower cost and are willing to manage more infra details

## OpenAI API vs open-weight cloud training

OpenAI can still be useful, but for a different role.

OpenAI is good for:
- benchmarking
- teacher labeling
- comparison against a strong hosted model

OpenAI is not the right final training path for local `IdenaAI` weights, because:
- hosted fine-tuning does not give you exportable local model weights
- it does not fit a federated open-weight future

If the goal is a local or federated `IdenaAI` runtime, the training path should stay on open weights.

## What to move to the cloud

The dataset prep script can already stay mostly the same:
- [prepare_flip_challenge_mlx_vlm.py](../scripts/prepare_flip_challenge_mlx_vlm.py)

The part that must change is the trainer:
- current local trainer:
  [train_flip_challenge_mlx_vlm.py](../scripts/train_flip_challenge_mlx_vlm.py)

Why:
- `mlx_vlm` is Apple-Silicon-specific
- rented GPUs will typically be Linux + CUDA

So the cloud path should eventually be:
- `transformers`
- `peft`
- `accelerate`
- or a similarly standard PyTorch LoRA stack

## Suggested migration plan

### Phase 1: keep dataset prep stable

Prepare datasets exactly as we do now:
- native frames or composite images
- neutral `a/b/skip` targets
- ranking-derived `training_weight`

Save:
- `hf-dataset/`
- `manifest.json`
- `train.jsonl`

### Phase 2: port trainer to Linux/CUDA

Build a second trainer beside the MLX one, not a replacement at first.

Suggested file target:
- `scripts/train_flip_challenge_torch_vlm.py`

That trainer should:
- load the saved dataset from disk
- consume `images`, `messages`, and `training_weight`
- support LoRA on an open multimodal base
- save exportable adapters

### Phase 3: use the cloud only for long runs

Good split of responsibilities:
- Mac:
  - prepare data
  - run tiny smoke tests
  - evaluate adapters
  - take part in federated local contribution
- Cloud GPU:
  - medium/full training runs
  - heavy ablations
  - long overnight jobs

## Budgeting

Rates change. Do not hardcode spend assumptions into planning.

Instead:
1. check the provider's current pricing page
2. estimate runtime from a small pilot
3. use the estimator script in this repo

Estimator:
- [estimate_flip_training_budget.py](../scripts/estimate_flip_training_budget.py)

Example:

```bash
python scripts/estimate_flip_training_budget.py \
  --examples 500 \
  --seconds-per-step 1.5 \
  --runs 3 \
  --hourly-rate 1.29
```

Or with a preset:

```bash
python scripts/estimate_flip_training_budget.py \
  --examples 500 \
  --seconds-per-step 1.5 \
  --runs 3 \
  --service lambda \
  --gpu a10
```

## Federated future

For federated `IdenaAI`, the system should exchange:
- LoRA adapters
- low-rank updates
- sparse or compressed deltas

It should not expect every participant to move full dense multimodal checkpoints around all the time.

That matters for Macs:
- a Mac can realistically do local FLIP data prep
- a Mac can run inference and local evaluation
- a Mac can contribute smaller adapter-style updates
- a Mac can verify and score federated candidate updates

But a Mac is not the ideal machine for:
- repeated full dense merges of large multimodal checkpoints
- long heavy global aggregation jobs

So the federated design should prefer:
- adapter-level contribution
- signed update packages
- local evaluation before contribution
- server or coordinator side aggregation on stronger hardware

## Safety notes

Use cloud training only with:
- datasets you are comfortable uploading to the selected provider
- no wallet secrets in the training bundle
- clear separation between training artifacts and sensitive local profile data

If you use a public or shared cloud provider:
- do not upload private screenshots or chat history
- do not upload your live desktop profile
- export only the training dataset you intend to use
