# IdenaAI

`IdenaAI` is the main experimental desktop fork of `idena-desktop` in the `IdenaAI` repository for:
- local or hosted AI integration
- in-app FLIP annotation and human-teacher flows
- local FLIP training experiments tied to the desktop app

This is research software, not a hardened wallet release.

## Current status

Available today:
- AI settings and local runtime debugging
- in-app human-teacher annotation, including demo mode
- local FLIP training scripts in `scripts/`
- human-assisted prep modes: `weight_boost`, `followup_reasoning`, `hybrid`
- annotation aggregation modes: `best_single`, `deepfunding`

Still experimental:
- packaged builds
- federated-learning workflow
- unattended on-chain automation
- some Local AI UX and runtime defaults

## Embryo Stage

`IdenaAI` is back in embryo stage for the moment while research for a better
base layer is ongoing.

> I just pulled the plug on Qwen 3.5 as base model for the moment. Too much
> opaque pretraining. You can’t grow a trustworthy system on a black box. Back
> to embryo stage.

Sanitized screenshot of the behavior that triggered this reset:

![Sanitized base-layer review example](docs/assets/base-layer-research-note.jpg)

Current consequence:
- no approved local base model ships by default
- benchmarking, annotation, and provider experiments continue
- any future local base layer should be chosen deliberately and audited first

## Safety and privacy

Treat this repo as test software.

Recommended precautions:
- use a low-value or disposable Idena identity
- keep provider budgets small
- do not store secrets in the repo
- prefer a separate machine, VM, or OS user profile
- review AI-generated flips manually before publishing on-chain

If human annotations are later used for shared training, those contributions may
become part of propagated model artifacts. Only share content you have the right
to contribute.

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
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
npm install
npm start
```

Optional build:

```bash
npm run build
npm run dist
```

For explicit macOS targets on Apple Silicon:

```bash
npm run pack:mac:arm64
npm run pack:mac:universal
```

Useful checks:

```bash
npm run audit:privacy
npm run audit:electron
npm test
```

## Large bundled artifacts

This repo intentionally carries large static libraries in
`idena-wasm-binding/lib/` for reproducible local builds.

For a more polished public release flow:
- keep those files under review before every tag
- consider Git LFS or external release artifacts if the bundle grows further
- make sure `THIRD_PARTY_NOTICES.md` ships with any redistributed binary bundle

## Local AI runtime

For local inference, the app expects a loopback-only runtime.

Typical setup:
- Ollama on `http://127.0.0.1:11434`
- manually chosen local text and multimodal models pulled on the same machine

Do not point Local AI at arbitrary remote URLs unless you intentionally want a
hosted-provider setup and accept the privacy and cost tradeoff.

## Training workflow

The local FLIP training stack lives in `scripts/`.

It supports:
- FLIP-Challenge dataset prep from Hugging Face
- human-teacher annotation import
- local LoRA pilot training
- matrix comparison of baseline vs human-assisted modes
- side-by-side comparison of `best_single` vs `deepfunding`

There is no approved bundled local base model at the moment. The training stack
remains in the repo for research, but the base layer has intentionally been
reset while better candidates are evaluated.

Start here:
- [docs/flip-challenge-local-training.md](docs/flip-challenge-local-training.md)

Related protocol/design notes:
- [docs/federated-model-distribution.md](docs/federated-model-distribution.md)
- [docs/federated-human-teacher-protocol.md](docs/federated-human-teacher-protocol.md)

Typical Python environment:

```bash
python3.11 -m venv .tmp/flip-train-venv-py311
source .tmp/flip-train-venv-py311/bin/activate
python -m pip install -U pip setuptools wheel
python -m pip install mlx-vlm pyarrow pillow datasets huggingface_hub torch torchvision scipy
```

If you continue local training research, choose and audit the base model
yourself first.

## Related repo

If you mainly want the off-chain benchmark and training fork, use:
- [IdenaAI_Benchmarker](https://github.com/ubiubi18/IdenaAI_Benchmarker)

## License

MIT. See [LICENSE](LICENSE).
