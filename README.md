# IdenaAI Benchmarker NOT PRODUCTION READY, DONT USE!

`IdenaAI_Benchmarker` is the off-chain FLIP benchmarking and training fork.

Use it for:
- FLIP-Challenge benchmarking
- local FLIP training experiments
- human-assisted training variants
- evaluation slices, bias checks, swap consistency, and aggregation tests

It is a research fork, not a polished end-user app release.

## Embryo stage

`IdenaAI_Benchmarker` is also back in embryo stage for the moment while
research for a better local base layer is ongoing.

Current consequence:
- no approved local base model ships by default
- benchmarking, annotation, and provider experiments continue
- any future local base layer should be chosen deliberately and audited first

## Current status

Available today:
- benchmark-oriented desktop shell
- active local FLIP training scripts
- human-teacher annotation import during prep
- matrix comparison of:
  - `baseline`
  - `weight_boost`
  - `followup_reasoning`
  - `hybrid`
- annotation aggregation by:
  - `best_single`
  - `deepfunding`

Still rough:
- a lot of shared structure with the main desktop repo
- desktop UI is secondary to training and evaluation workflows

## Naming

This repo uses benchmarker-specific naming.

Current identifiers:
- repository: `IdenaAI_Benchmarker`
- package: `idena-ai-benchmarker`
- Electron `productName`: `IdenaAI_Benchmarker`
- human-facing name: `IdenaAI Benchmarker`

Treat it as a source-run research fork first.

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

Prerequisites:
- `git`
- `node` 20.x
- `npm`
- `python3`

On macOS:

```bash
xcode-select --install
brew install git node@20 python@3
brew link --overwrite --force node@20
```

Clone and start:

```bash
git clone https://github.com/ubiubi18/IdenaAI_Benchmarker.git
cd IdenaAI_Benchmarker
npm install
npm start
```

Optional build:

```bash
npm run build
npm run dist
```

Prefer source runs for experiments.

## Local AI runtime

For local inference tests, the current code expects a loopback runtime.

Typical setup:
- Ollama on `http://127.0.0.1:11434`

Keep Local AI endpoints on this machine unless you intentionally switch to a
hosted-provider experiment.

There is no approved bundled local base model at the moment. If you continue
local training research here, choose and audit the base model yourself first.

## Training and evaluation

This repo is the better choice if your main goal is FLIP experiments rather
than desktop-client integration.

It supports:
- FLIP-Challenge dataset prep
- human-teacher annotation import
- human-assisted prep modes
- aggregation comparison of `best_single` vs `deepfunding`
- matrix-runner experiments on fixed slices

Start here:
- [docs/flip-challenge-local-training.md](docs/flip-challenge-local-training.md)

Typical Python environment:

```bash
python3 -m venv .tmp/flip-train-venv
source .tmp/flip-train-venv/bin/activate
python -m pip install -U pip setuptools wheel
python -m pip install mlx-vlm pyarrow pillow datasets huggingface_hub torch torchvision scipy
```

## Related repo

Use the main repo if you want the app/runtime integration work:
- [IdenaAI](https://github.com/ubiubi18/IdenaAI)

## License

MIT. See [LICENSE](LICENSE).
