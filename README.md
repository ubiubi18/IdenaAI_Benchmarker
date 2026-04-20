# IdenaAI

`IdenaAI` is an experimental desktop fork of `idena-desktop` focused on:
- local and hosted AI integration
- FLIP solving, generation, and benchmarking research
- human-teacher annotation flows
- local training and runtime experiments tied to the desktop app

This is research software, not a hardened wallet release.

## Warning

This repository is still in development.

Use it at your own risk:
- no warranties
- no guarantee of safety, correctness, uptime, or fitness for any purpose
- not audited
- not suitable for valuable identities, funds, or unattended automation
- this codebase includes rapid experimental work and vibe-coding risks

If you are not comfortable debugging broken flows, reviewing diffs, and
accepting the possibility of wrong behavior, do not rely on this build.

## Current stage

Current project posture:
- the desktop app is active and usable for research
- AI features remain explicitly experimental
- local AI is back in embryo stage as a long-term base-layer project
- the current managed on-device research candidate is `allenai/Molmo2-O-7B`
- no local AI path in this repo should be treated as audited or production-safe

What works today:
- AI settings and runtime controls inside the app
- provider-based solving, benchmarking, and AI-assisted FLIP generation
- in-app human-teacher annotation flows and demo/test paths
- managed on-device runtime bootstrap for the current Molmo2-O research path
- local FLIP research scripts in `scripts/`

What is still not production-ready:
- packaged end-user release quality
- stable local-model defaults
- unattended on-chain AI automation
- federated-learning / networked training workflows
- full polish across local-runtime UX

## Local AI status

Local AI is deliberately conservative right now.

- there is no permanently approved bundled local base model
- the managed on-device runtime is a research path, not a final endorsement
- first use now asks for an explicit one-time trust approval before installing
  pinned packages and running the pinned Molmo2-O runtime locally
- the managed runtime is loopback-only, token-gated, and verifies trusted
  pinned runtime files and weight shards before startup
- advanced users can still point the app at their own local-only Ollama,
  MLX, Transformers, or `vLLM` runtime

In short: the repo can run local AI experiments, but the broader local-model
direction is still being re-evaluated.

## Safety and privacy

Treat this repository as test software.

Recommended precautions:
- use a low-value or disposable Idena identity
- keep provider budgets small
- do not store secrets in the repo
- prefer a separate machine, VM, or OS user profile
- review AI-generated flips manually before publishing on-chain

If human annotations are later used for shared training, those contributions may
become part of propagated model artifacts. Only contribute material you have the
right to share.

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

## Training workflow

The local FLIP training stack remains in the repo for research.

It currently supports:
- FLIP-Challenge dataset prep from Hugging Face
- human-teacher annotation import
- local LoRA pilot training experiments
- matrix comparison of baseline vs human-assisted modes
- side-by-side comparison of `best_single` vs `deepfunding`

Important limitation:
- no approved bundled local training base model is currently endorsed by the
  project

Start here:
- [docs/flip-challenge-local-training.md](docs/flip-challenge-local-training.md)

Related notes:
- [docs/local-ai-mvp-architecture.md](docs/local-ai-mvp-architecture.md)
- [docs/federated-model-distribution.md](docs/federated-model-distribution.md)
- [docs/federated-human-teacher-protocol.md](docs/federated-human-teacher-protocol.md)

## Large bundled artifacts

This repo intentionally carries large static libraries in
`idena-wasm-binding/lib/` for reproducible local builds.

If public release packaging becomes more formal later:
- keep those files under review before every tag
- consider Git LFS or external release artifacts if the bundle grows further
- make sure `THIRD_PARTY_NOTICES.md` ships with any redistributed binary bundle

## Development history

Very short overview:
- `Phase 1`: desktop fork created to explore AI inside `idena-desktop`
- `Phase 2`: human-teacher annotation and local training research were added
- `Phase 3`: provider benchmarking / solving / generation were separated from
  local-model-training semantics
- `Phase 4`: the old local base-model direction was reset; the project returned
  to embryo stage for local AI while Molmo2-O is evaluated as the current
  managed research candidate

## Related repo

If you mainly want the off-chain benchmark and training fork, use:
- [IdenaAI_Benchmarker](https://github.com/ubiubi18/IdenaAI_Benchmarker)

## License

MIT. See [LICENSE](LICENSE).
