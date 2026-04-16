# IdenaAI

`IdenaAI` is an experimental desktop fork of `idena-desktop` for AI-assisted
FLIP research.

It combines three things in one codebase:
- the Electron desktop client
- optional local or hosted AI provider integration
- FLIP data collection, human-teacher annotation, and local training helpers

This is research software, not a hardened wallet release.

## Current status

What exists today:
- the desktop app still works as an `idena-desktop`-style client
- optional AI settings and local-runtime debugging are available
- post-session human-teacher annotation exists in-app
- an offline demo annotator path exists for testing without live session data
- FLIP training scripts exist for local experiments on the Hugging Face
  FLIP-Challenge dataset
- human annotations can be injected into training prep in multiple modes:
  `weight_boost`, `followup_reasoning`, `hybrid`
- repeated human annotations can now be merged either by:
  - `best_single`
  - `deepfunding` weighted aggregation

What is still experimental or incomplete:
- Electron hardening is improved but not complete
- on-chain automation is not trustworthy enough for unattended use
- federated learning is still a design/prototyping area, not a finished network
- local AI model defaults and UX are still evolving
- packaged releases should be treated as experimental community builds, not
  polished end-user binaries

## Safety and privacy

Use this repository as test software.

Recommended precautions:
- use a low-value or disposable Idena identity
- keep API/provider budgets small
- do not store valuable secrets in the repo
- prefer a separate machine, VM, or OS user profile
- review AI-generated flips manually before publishing anything on-chain

Human-teacher annotation has an additional consent implication:
- if users contribute annotations for federated learning, those annotations may
  later be incorporated into shared training artifacts or merged model updates
- once propagated, those contributions should be treated as effectively
  irreversible
- contributors are solely responsible for making sure they have the right to
  share that content

## Install and run from source

These steps are the current supported path.

### 1. Prerequisites

You need:
- `git`
- `node` 20.x
- `npm`
- `python3`

On macOS, install the Xcode command line tools first:

```bash
xcode-select --install
```

If you use Homebrew, a typical setup is:

```bash
brew install git node@20 python@3
brew link --overwrite --force node@20
```

### 2. Clone and install

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
npm install
```

### 3. Start the desktop app in dev mode

```bash
npm start
```

The dev renderer currently expects the local loopback renderer URL used by the
app scripts. You do not need to start Next manually; `npm start` handles the
desktop development flow.

### 4. Optional production build

```bash
npm run build
npm run dist
```

Useful checks before packaging:

```bash
npm run audit:privacy
npm run audit:electron
npm test
```

## Optional Local AI runtime

If you want local inference, the current app expects a loopback-only runtime.

Typical local setup:
- Ollama on `http://127.0.0.1:11434`
- one or more multimodal/text models pulled locally

The app should only talk to local endpoints on this machine. Do not point Local
AI at arbitrary remote URLs unless you intentionally switch to a hosted custom
provider flow and understand the privacy/cost tradeoff.

## Human-teacher loop

The core long-term idea is not just synthetic AI-to-AI distillation.

`IdenaAI` is being built toward a decentralized human-teacher loop:
- users solve flips in normal Idena sessions
- after consensus, small batches can be reviewed voluntarily
- the app can ask focused follow-up questions when a case is uncertain or
  interesting
- those answers can become higher-quality supervision for local training and
  later federated aggregation

The important part is the source of supervision:
- blockchain consensus anchors the final outcome
- humans add the missing reasoning layer
- training can then compare raw consensus-only prep against richer
  human-annotation modes

## FLIP training pipeline

The local training stack lives in `scripts/` and is intended for small pilot
experiments first, not full-scale blind runs.

Current pipeline capabilities:
- prepare FLIP-Challenge slices from Hugging Face
- inject normalized human-teacher annotations during dataset prep
- run local LoRA pilots
- compare baseline vs human-assisted modes with the matrix runner
- compare annotation aggregation methods side by side:
  - `best_single`
  - `deepfunding`

Start here for the full workflow:
- [docs/flip-challenge-local-training.md](docs/flip-challenge-local-training.md)

Related notes:
- [docs/federated-model-distribution.md](docs/federated-model-distribution.md)
- [docs/federated-human-teacher-protocol.md](docs/federated-human-teacher-protocol.md)

## Python training environment

A typical local training environment looks like:

```bash
python3 -m venv .tmp/flip-train-venv
source .tmp/flip-train-venv/bin/activate
python -m pip install -U pip setuptools wheel
python -m pip install mlx-vlm pyarrow pillow datasets huggingface_hub torch torchvision scipy
```

`scipy` is now needed if you want to use DeepFunding-based human-annotation
aggregation during prep.

## Repository focus

Use this repo if you want:
- the desktop app
- the in-app human-teacher flow
- local AI experiments inside the client
- the FLIP training scripts alongside the main app code

If you only want the off-chain benchmarking and training fork, see:
- [IdenaAI_Benchmarker](https://github.com/ubiubi18/IdenaAI_Benchmarker)

## License

MIT. See [LICENSE](LICENSE).
