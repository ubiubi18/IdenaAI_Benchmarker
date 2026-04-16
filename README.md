# IdenaAI Benchmarker

`IdenaAI_Benchmarker` is the off-chain FLIP benchmarking and training fork.

It is meant for:
- comparing AI providers on the FLIP-Challenge dataset
- running local FLIP training experiments
- testing human-assisted training variants
- exploring evaluation slices, bias, swap consistency, and aggregation methods

It is not a polished end-user app release.

## Current status

What exists today:
- the desktop shell is still usable for benchmark-oriented AI experiments
- FLIP-Challenge local training scripts are in active use
- normalized human-teacher annotations can be included in training prep
- the matrix runner can compare:
  - baseline
  - `weight_boost`
  - `followup_reasoning`
  - `hybrid`
- repeated human annotations can be merged by:
  - `best_single`
  - `deepfunding`

What is still rough:
- the codebase still shares a large amount of desktop-app structure with the
  main repo
- the desktop UI is secondary to the benchmark/training workflows

## Important naming reality

This repository is the benchmarker fork and now uses benchmarker-specific
package metadata.

That means:
- the repository name is `IdenaAI_Benchmarker`
- the package name is `idena-ai-benchmarker`
- the Electron `productName` is `IdenaAI_Benchmarker`
- you should still treat this as a source-run research fork first, not a
  polished end-user release

So the safest assumption today is:
- use separate checkouts
- do not rely on packaged-app identity separation being perfect yet
- prefer source runs for development and experiments

## Safety and privacy

Use this as research software.

Recommended precautions:
- use test identities, not valuable ones
- do not commit provider keys or private local configs
- keep AI budgets capped
- run privacy checks before publishing anything

Useful checks:

```bash
npm run audit:privacy
npm run audit:electron
npm test
```

## Install and run from source

These are the current realistic steps.

### 1. Prerequisites

You need:
- `git`
- `node` 20.x
- `npm`
- `python3`

On macOS:

```bash
xcode-select --install
```

Typical Homebrew setup:

```bash
brew install git node@20 python@3
brew link --overwrite --force node@20
```

### 2. Clone and install

```bash
git clone https://github.com/ubiubi18/IdenaAI_Benchmarker.git
cd IdenaAI_Benchmarker
npm install
```

### 3. Start the benchmarker in dev mode

```bash
npm start
```

### 4. Optional build

```bash
npm run build
npm run dist
```

Important caveat:
- this is still a research-oriented fork even though its package metadata is
  now benchmarker-specific
- prefer source runs for experiments and treat packaged artifacts as secondary

## Large bundled artifacts

This repository intentionally tracks a small set of large bundled static
libraries under `idena-wasm-binding/lib/`.

Rules:
- do not add new large tracked binaries casually
- if a new artifact is large, prefer Git LFS or release artifacts
- keep the currently allowed bundled wasm libraries under review for formal
  releases

## Optional Local AI runtime

For local inference tests, the current code expects a loopback runtime.

Typical setup:
- Ollama on `http://127.0.0.1:11434`

Keep Local AI endpoints on this machine unless you intentionally switch to a
hosted custom-provider experiment.

## Training and evaluation

This repo is the better place if your main goal is FLIP experiments rather than
the desktop client itself.

Current training/eval work includes:
- local dataset preparation from the Hugging Face FLIP-Challenge dataset
- human-teacher annotation import
- human-assisted prep modes
- side-by-side comparison of annotation aggregation:
  - `best_single`
  - `deepfunding`
- matrix-runner experiments on fixed slices

Start here:
- [docs/flip-challenge-local-training.md](docs/flip-challenge-local-training.md)

## Python training environment

Typical local environment:

```bash
python3 -m venv .tmp/flip-train-venv
source .tmp/flip-train-venv/bin/activate
python -m pip install -U pip setuptools wheel
python -m pip install mlx-vlm pyarrow pillow datasets huggingface_hub torch torchvision scipy
```

`scipy` is required if you want DeepFunding-based annotation aggregation during
training prep.

## Relationship to the main repo

Use this repo if you mainly want:
- off-chain benchmarking
- training scripts
- eval matrices
- human-annotation experiments

Use the main repo if you mainly want:
- the full desktop app direction
- the in-app human-teacher workflow
- app/runtime integration work

Main repo:
- [IdenaAI](https://github.com/ubiubi18/IdenaAI)

## License

MIT. See [LICENSE](LICENSE).
