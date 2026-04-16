# IdenaAI

## Work In Progress

This repository is a **work-in-progress** community fork of
[`idena-desktop`](https://github.com/idena-network/idena-desktop) with
experimental AI, governance, and in-app social features.

It is **not an official Idena release**, **not production-ready**, and **not
fully security-audited**. Treat it as research software and test tooling, not
as a hardened wallet or trusted desktop client.

If you want to try it anyway, do so **only at your own risk** and **only inside
a secure test environment**, for example:

- a separate macOS/Linux user profile
- a dedicated test machine or VM
- a disposable or low-value Idena identity
- tightly capped API/provider budgets
- no unattended publishing or automation

Do **not** use valuable identities, high-value wallets, long-lived secrets, or
large AI budgets unless you have reviewed the code and understand the current
risks.

This fork connects AI tooling to the FLIP Challenge, a human CAPTCHA-like
benchmark built from human-generated and human-verified tasks collected from the
Idena blockchain. It lets researchers test, compare, and stress-test models on
tasks that are still easy for humans but often hard, brittle, and expensive for
AI.

Use it to explore model capability, failure modes, prompt strategies, provider differences, and cost. See which models come closest, where they still break down, and what price AI has to pay on tasks where humans still hold the advantage.

Latest models from leading AI providers can be evaluated offchain against the publicly released FLIP Reasoning Challenge benchmark, built from human-generated and human-verified tasks collected from the Idena blockchain.

Humans still clearly outperform state-of-the-art AI on this benchmark. The best individual closed-source model reached 77.9% zero-shot accuracy, humans reached 95.3%, and even a 15-model ensemble reached only 85.2%, as of the 2025 FLIP Reasoning Challenge paper, referenced in the

Hugging Face dataset:
[https://huggingface.co/datasets/aplesner-eth/FLIP-Challenge](https://huggingface.co/datasets/aplesner-eth/FLIP-Challenge)

Andreas Plesner repo:
[https://github.com/aplesner/flip-reasoning-challenge](https://github.com/aplesner/flip-reasoning-challenge)

This repository also enables experimental on-chain testing, but entirely at the
tester’s own responsibility. On-chain outcomes may differ from off-chain
benchmark results and depend not only on model capability, but also on the
willingness and ability of the Idena community to defend the network against bad
flips and to report invalid submissions.

This project does not endorse any token or coin. It is a research tool built around one core question: where are humans still meaningfully better than AI? If onchain benchmarking on Idena shows that stronger defenses are needed, an individual fork or a redesigned Idena-like blockchain may be the better path for preserving or improving AI resistance.

Idena is an identity blockchain with a long-running human-verification mechanism. 

Official Idena website:
https://www.idena.io/

Original desktop app repository:
https://github.com/idena-network/idena-desktop

During validation, users solve and create short visual puzzles called flips. A flip is a 4-image story built from two keywords. Humans should be able to understand the intended sequence, while bots and weak models should have a much harder time inferring it reliably.

That makes FLIP interesting as a multimodal benchmark for reasoning, sequencing, common sense, and visual storytelling - not just raw image recognition.

This fork keeps the familiar desktop app flow available while adding optional AI
research features:

- AI-assisted flip story generation
- AI-assisted flip image generation
- AI flip solving and benchmark runs
- bundled in-app `idena.social` access through the current node RPC settings
- off-chain benchmark sample data
- experimental, guarded on-chain automation flows

AI is optional. The app should still be usable like regular `idena-desktop`
without enabling AI or adding API keys.

## Human Teacher Loop

The longer-term idea of `IdenaAI` is a decentralized human-teacher loop, not
just another AI-to-AI distillation stack.

In that model, real users annotate small post-consensus batches such as
`20-30` flips per epoch from the sessions they already solve, plus a few flips
they prepared themselves. That is the natural unit of work in Idena: people are
already solving flips, already creating flips, and the protocol already
produces a consensus outcome for those tasks.

The intended flow is organic, not a separate enterprise labeling pipeline. When
the local AI is unsure, disagrees with consensus, or notices a case it still
does not understand, it can ask the user focused annotation questions about
that specific flip. In some cases that may look more like a short discussion
than a form: the user explains why one story feels coherent, why another one is
implausible, whether readable text was actually required, or why a human common
sense judgment says the flip should be reported.

The genuinely new part is where the supervision comes from. Instead of relying
only on synthetic labels or a hosted teacher model, the training signal is
anchored in protocol-native human consensus and enriched by human explanation.
The blockchain gives a way to filter bad annotation at scale, while humans add
the missing reasoning layer that current models still struggle with: panel
captions, coherence explanations, text-required flags, sequence-marker checks,
reportability judgments, and plain human common sense about what story makes
sense.

Over time, the local AI is supposed to note those corrections, retain the
useful patterns, and become a more human-aligned companion instead of just a
faster pattern matcher. The goal is not only higher benchmark accuracy, but a
solver that gradually behaves more like a helpful human partner who understands
why a flip works or fails.

## Current Loose Ends

The main unfinished areas at the time of writing are:

- Electron hardening is incomplete. The app is still a development-oriented
  Electron fork, not a fully hardened desktop client.
- Local AI support is still evolving. Branding, runtime adapters, model
  defaults, and compatibility layers are in active development.
- Federated learning is still experimental and incomplete. Governance,
  contributor verification, redundancy, aggregation, and auditability are not
  yet finished end-to-end.
- On-chain automation remains risky. Real validation and publishing flows still
  need human review and should not be trusted unattended.
- Linux and Windows support are still best-effort. Most testing has been on
  current macOS.
- Repository layout is still in transition. Some bundled snapshots and research
  artifacts remain for reproducibility, but the long-term release shape is not
  settled yet.

## Status

This is a research fork, not an official Idena release. The desktop runtime has
been updated to Electron 30.x and tested mainly on current macOS, including
Apple Silicon. Linux and Windows support are still best-effort and may require
local native rebuilds. Use it carefully:

- You must use your own API keys.
- AI provider calls do cost money.
- API keys should be provided through the session-only UI or local untracked
  config, never committed.
- Fully automatic flip generation and publishing is experimental and has not
  been reliable enough in testing for unattended use.
- The safer workflow is the manual flip builder, where you review and edit story
  text and images before publishing.

For cost control, prefer prepaid API budgets or provider-side spending limits.

This fork uses its own app-support directory, so it no longer collides with
`IdenaAI_Benchmarker`.

## Community Build Warning

Large parts of the experimental AI functionality in this fork were developed as a community project and have not undergone a full professional security audit.

The project was developed through prompt-assisted coding with Codex and tested manually on a Mac. Treat this as experimental software that may contain the kinds of weaknesses common in fast-moving AI-assisted community projects:

- security bugs
- broken or unreliable flows
- privacy mistakes
- accidental secret or metadata leakage
- bloated repository metadata or bundled artifacts
- unsafe assumptions around automation, costs, API calls, or publishing

Use it at your own responsibility. Prefer a secure test setup with isolated
accounts, limited budgets, and no valuable production secrets. Do not run it
with valuable identities, large API budgets, or unattended publishing enabled
unless you have reviewed the code and understand the risks.

## Install From Source

There is no official binary release from this fork. These instructions build and
run the app from source.

Copy one command block at a time. If one block fails, stop and fix that error
before continuing.

### macOS

1. Install Apple command line tools:

```bash
xcode-select --install
```

If macOS says the tools are already installed, continue.

2. Install Homebrew if you do not already have it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

3. Install build dependencies:

```bash
brew install git node@20 python@3 pkg-config cairo pango libpng jpeg giflib librsvg
brew link --overwrite --force node@20
```

4. Download and enter the project:

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
```

If you already downloaded the repository, open Terminal in that folder instead.

5. Install JavaScript dependencies and run the release gate:

```bash
npm ci
npm run release:check
```

6. Start the desktop app:

```bash
npm run clean
npm start
```

Optional local defaults:

```bash
cp .env.example .env.local
```

Edit only the values you need. Do not commit `.env.local` or provider keys.

`npm start` launches the Next.js renderer dev server on `127.0.0.1:8000` and
then starts Electron.

If Electron or a native addon needs to be rebuilt for the current runtime:

```bash
npm rebuild electron
node node_modules/electron/install.js
npm start
```

### Linux Ubuntu/Debian

These commands target Ubuntu/Debian style distributions.

1. Install system dependencies:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 python3-pip pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libgtk-3-0 libnss3 libxss1 libasound2 libxtst6 libx11-xcb1 libxkbfile1 libsecret-1-0 libgbm1
```

2. Install Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

`node --version` should print a `v20...` version.

3. Download and enter the project:

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
```

4. Install dependencies, run checks, and start:

```bash
npm ci
npm run release:check
npm run clean
npm start
```

`npm start` now launches the Next.js renderer dev server and Electron together.

If Electron or a native addon needs to be rebuilt for the current runtime:

```bash
npm rebuild electron
node node_modules/electron/install.js
npm start
```

### Windows

Recommended Windows path: use WSL2 with Ubuntu and follow the Linux instructions
above. That is usually simpler than native Windows builds for current Electron
projects with native dependencies.

Native Windows source build path is experimental and may require extra debugging:
1. Open PowerShell as Administrator.

2. Install Chocolatey if you do not already have it:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

3. Close and reopen PowerShell as Administrator, then install dependencies:

```powershell
choco install -y git nodejs-lts python visualstudio2022buildtools visualstudio2022-workload-vctools gtk-runtime libjpeg-turbo 7zip curl
node --version
npm --version
```

If `node --version` is not Node 20, install Node 20 manually from
[`nodejs.org`](https://nodejs.org/) or use a Node version manager before
continuing.

4. Download and enter the project:

```powershell
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
```

5. Install dependencies, run checks, and start:

```powershell
npm ci
npm run release:check
npm run clean
npm start
```

If the native Windows build fails on current Electron/native modules, use the WSL2
Ubuntu path instead.

## Updating The Electron Runtime

If you update the desktop runtime, keep `electron`, `electron-builder`, and
`electron-updater` aligned in [`package.json`](package.json), then reinstall so
native modules are rebuilt for the matching Electron ABI:

```bash
npm install
npm run release:check
node scripts/rebuild-electron-runtime-deps.js
```

If a native addon is still missing after that, remove `node_modules`,
reinstall, and rerun the rebuild helper before starting the app again.

## Optional AI Setup

AI features are off by default. If you enable them in the app, the UI asks you to
choose one or more AI providers and enter session API keys.

Typical research workflows include:

- AI Flip Builder: helps create a story and images for the current keyword pair
- AI Solver: helps solve flips during validation or test runs
- Off-chain Benchmark: tests solver behavior on local/sample flips
- On-chain Automatic Flow: experimental automation for real validation flows

Local AI also includes a local-only post-consensus training-package flow. New
packages start as `draft` and can be marked `reviewed`, `approved`, or
`rejected` locally in the settings UI. This is still review state only: not
training, not federated sharing, and not cloud upload.
Only locally approved packages are marked `federatedReady: true`, which is a
local preparation step only and still does not perform any federated sharing.

The longer-term idea is a decentralized human-teacher loop, not just another
AI-to-AI distillation stack. See [Human Teacher Loop](#human-teacher-loop)
above for the actual training direction this project is aiming at.

Cheap or very small models failed most often in early testing. If results are poor, try different providers, models, and advanced settings, but watch cost and latency.

## Repository Layout

The active desktop app lives at the repository root:

- [`main/`](main): Electron main process, node launcher, AI bridge, providers
- [`renderer/`](renderer): UI, flip builder, solver flow, settings, validation
- [`scripts/`](scripts): helper scripts, imports, release checks, benchmark tools
- [`docs/`](docs): notes and audit/worklog material
- [`package.json`](package.json): app scripts, dependencies, build config

Bundled source snapshots are included for reproducibility and runtime inspection:

- [`idena-go/`](idena-go): Idena node source snapshot
- [`idena-wasm/`](idena-wasm): wasm runtime source snapshot
- [`idena-wasm-binding/`](idena-wasm-binding): Go binding layer and static libs
- [`vendor/idena.social-contract/`](vendor/idena.social-contract): bundled
  `idena.social` smart-contract source snapshot
- [`vendor/idena.social-ui/`](vendor/idena.social-ui): bundled `idena.social`
  UI source snapshot used for the in-app Social page
- [`samples/flips/`](samples/flips): small decoded benchmark sample files

If you change the bundled social UI source and want to refresh the embedded app
snapshot, run:

```bash
npm run build:social
```

Most AI/UI work only touches `main/`, `renderer/`, and `scripts/`. Node or WASM
work needs the bundled source directories too.

## Optional Python Pipeline

The Python story pipeline is optional and disabled by default:

```bash
python3 -m pip install -r requirements.txt
```

Enable it in `.env.local` only when testing that path:

```bash
IDENAAI_USE_PY_FLIP_PIPELINE=true
IDENAAI_PYTHON=python3
```

On Windows, use `IDENAAI_PYTHON=py -3` or an absolute Python path.

## Tests And Release Checks

Targeted AI bridge tests:

```bash
npm test -- --runInBand main/ai-providers/bridge.test.js
```

Lint:

```bash
npm run lint -- --format unix
```

Full local release gate:

```bash
npm run release:check
```

`release:check` runs syntax checks, ESLint, release metadata checks, large
artifact checks, privacy checks, Electron remote safety checks, and the AI bridge
regression suite. GitHub Actions uses the same command for push CI and before
tagged release packaging.

Release packaging excludes local `.env*`, logs, `.tmp/`, `tmp/`, `data/`, and
coverage artifacts. Keep provider keys in the session-only UI or in local
untracked files.

Large bundled artifacts:

- `idena-wasm-binding/lib/*.a` contains prebuilt static libraries from the
  bundled wasm binding snapshot.
- The release check allows the current known static libraries but blocks new
  unreviewed tracked files above the GitHub warning threshold.
- For a polished public binary release, prefer Git LFS or GitHub release
  artifacts for large rebuilt libraries instead of committing new large files.

## Sample Data

Small labeled samples are included under [`samples/flips/`](samples/flips):

- [`flip-challenge-test-5-decoded-labeled.json`](samples/flips/flip-challenge-test-5-decoded-labeled.json)
- [`flip-challenge-test-20-decoded-labeled.json`](samples/flips/flip-challenge-test-20-decoded-labeled.json)

## Cleaner Component Split Option

This repository currently bundles desktop, node, wasm, and sample data snapshots
for reproducibility. That makes the repo easier to inspect as one workspace, but
it also makes licensing and release packaging more complex.

For a cleaner app-only public release, use this approach instead:

- keep only the active desktop app fork and AI changes in this repository
- preserve the original Idena MIT copyright notice for inherited desktop code
- keep the 2026 `ubiubi18 and contributors` MIT notice for community AI changes
- remove bundled `idena-go/`, `idena-wasm/`, `idena-wasm-binding/`, static
  libraries, and sample datasets from the app-only release branch
- tell users to fetch node/wasm/runtime components from their official upstream
  sources and verify those licenses separately
- keep `THIRD_PARTY_NOTICES.md` accurate for whichever components are actually
  distributed

Do not remove bundled component notices while those components are still shipped
inside this repository.

## License

This repository has multiple license scopes:

- Upstream `idena-desktop` code remains MIT with the original 2020 Idena
  copyright notice.
- Community AI benchmark/helper modifications are offered under MIT with a 2026
  `ubiubi18 and contributors` notice, to the extent those contributors own the
  modifications.
- Bundled `idena-go/` snapshot: LGPL-3.0. See
  [`idena-go/LICENSE`](idena-go/LICENSE).
- Bundled `idena-wasm-binding/` snapshot: LGPL-3.0. See
  [`idena-wasm-binding/LICENSE`](idena-wasm-binding/LICENSE).

This is not legal advice. Do not describe the entire bundled repository as MIT-only. Review `LICENSE`, `LICENSES/MIT.txt`, and `THIRD_PARTY_NOTICES.md` before preparing a public release or binary distribution. 
