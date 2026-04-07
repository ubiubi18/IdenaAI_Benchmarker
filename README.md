# IdenaAI_Benchmarker

`idena-desktop` fork with optional experimental AI tools for Idena flips.

Idena is an identity blockchain. The official project website is
[`idena.io`](https://www.idena.io/) and the original desktop app repository is
[`idena-network/idena-desktop`](https://github.com/idena-network/idena-desktop)
(links last checked April 7, 2026).

During validation, users solve and create short visual puzzles called flips. A
flip is a 4-image story built from two keywords; humans should understand the
intended order, while bots should have a harder time guessing it.

This repository keeps the normal desktop app flow available and adds optional AI
features for research:

- AI-assisted flip story generation
- AI-assisted flip image generation
- AI flip solving and benchmark runs
- off-chain benchmark sample data
- experimental, guarded on-chain automation flows

AI is optional. The app should still be usable like regular `idena-desktop`
without enabling AI or adding API keys.

## Status

This is a research fork, not an official Idena release. Use it carefully:

- AI provider calls can cost money.
- API keys should be provided through the session-only UI or local untracked
  config, never committed.
- Fully automatic flip generation and publishing is experimental and has not
  been reliable enough in testing for unattended use.
- The safer workflow is the manual flip builder, where you review and edit story
  text and images before publishing.

For cost control, prefer prepaid API budgets or provider-side spending limits.

## Community Build Warning

The experimental AI work in this fork was built as a community project by
`ubiubi18`, an Idena community member with practical knowledge of Idena
consensus and flip flows, but without claiming deep software engineering or
security-audit expertise.

The project was developed through prompt-driven AI coding ("vibe coding") with
Codex and tested manually on a Mac. The maintainer did not read or audit every
line of generated code. Treat this as experimental software that may contain the
kind of weaknesses common in vibe-coded projects:

- security bugs
- broken or unreliable flows
- privacy mistakes
- accidental secret or metadata leakage
- bloated repository metadata or bundled artifacts
- unsafe assumptions around automation, costs, API calls, or publishing

Use it at your own responsibility. Do not run it with valuable accounts, large
API budgets, or unattended publishing enabled unless you have reviewed the code
and understand the risks.

## Install And Run

From the repository root:

```bash
npm install
npm run clean
npm start
```

Optional local defaults:

```bash
cp .env.example .env.local
```

Edit only the values you need. Do not commit `.env.local` or provider keys.

## Optional AI Setup

AI features are off by default. If you enable them in the app, the UI asks you to
choose one or more AI providers and enter session API keys.

The main areas under AI are:

- AI Flip Builder: helps create a story and images for the current keyword pair
- AI Solver: helps solve flips during validation or test runs
- Off-chain Benchmark: tests solver behavior on local/sample flips
- On-chain Automatic Flow: experimental automation for real validation flows

Cheap or very small models failed most often in early testing. If results are
poor, try different providers/models and advanced settings, but watch cost and
latency.

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
- [`samples/flips/`](samples/flips): small decoded benchmark sample files

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

This is not legal advice. Do not describe the entire bundled repository as
MIT-only. See [`LICENSE`](LICENSE), [`LICENSES/MIT.txt`](LICENSES/MIT.txt), and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) before preparing a public
release or binary distribution.
