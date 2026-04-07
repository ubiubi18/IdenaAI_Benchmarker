# IdenaAI_Benchmarker

Research bundle for the Idena desktop fork, AI flip tooling, and reproducible benchmark work.

This repository is a bundled workspace. It is not a clean upstream fork of one single project.

It currently contains:

- the active desktop app fork at the repository root
- a bundled `idena-go/` source snapshot
- bundled `idena-wasm/` and `idena-wasm-binding/` sources
- sample flip data and benchmark helper material

## Why older screenshots looked different

Older GitHub screenshots showed a layout like this:

- `idena-desktop/`
- `idena-go/`
- `idena-wasm/`
- `idena-wasm-binding/`

That was an earlier bundle layout.

The current repository keeps the desktop app fork flattened at the repo root instead of nesting it under `idena-desktop/`. So the active app code now lives directly in:

- [`main/`](main)
- [`renderer/`](renderer)
- [`scripts/`](scripts)
- [`docs/`](docs)
- [`package.json`](package.json)

The installable application still presents itself as `idena-desktop`; the
GitHub repository metadata points to this benchmark fork so releases and issue
links do not accidentally target upstream `idena-network/idena-desktop`.

The missing bundled source components have been restored as top-level directories:

- [`idena-go/`](idena-go)
- [`idena-wasm/`](idena-wasm)
- [`idena-wasm-binding/`](idena-wasm-binding)
- [`samples/`](samples)

## Current bundle layout

### Active desktop app fork

These files and directories are the app you currently run and modify:

- [`main/`](main): Electron main process, node launcher, AI bridge, provider integrations
- [`renderer/`](renderer): UI, flip builder, solver flow, settings, validation views
- [`scripts/`](scripts): helper scripts, benchmark tooling, imports, audits
- [`docs/`](docs): fork notes, setup notes, worklog, audit material
- [`package.json`](package.json): desktop app dependencies and scripts

### Bundled source components

These are included so the benchmark bundle is not limited to the UI layer:

- [`idena-go/`](idena-go): chain/node source snapshot
- [`idena-wasm/`](idena-wasm): wasm runtime source
- [`idena-wasm-binding/`](idena-wasm-binding): Go binding layer plus static libraries
- [`samples/flips/`](samples/flips): small decoded benchmark sample files

## What you need for different kinds of work

### AI desktop helper work

If you only work on the desktop app, AI solver, AI flip builder, or provider integrations, you usually only need the root app:

- [`main/`](main)
- [`renderer/`](renderer)
- [`package.json`](package.json)

That is enough for:

- AI story generation
- AI flip building
- AI solver and benchmark queue work
- provider integrations
- most UI changes

### Full bundle or node/runtime work

If you want to rebuild or inspect the bundled runtime parts, you also need:

- [`idena-go/`](idena-go)
- [`idena-wasm/`](idena-wasm)
- [`idena-wasm-binding/`](idena-wasm-binding)

That matters for:

- rebuilding or inspecting the bundled node
- chain-level fork changes
- wasm runtime compatibility
- reproducing the older benchmark bundle more faithfully

## Local run

Run the active desktop app from the repository root:

```bash
npm install
npm run clean
npm start
```

For local environment defaults, copy `.env.example` to `.env.local` and adjust
only the values you need:

```bash
cp .env.example .env.local
```

Provider API keys are not meant to be committed. The app loads them as
session-only keys through the AI settings UI.

## Optional AI Features

The app can run like regular `idena-desktop`. Experimental AI features stay off
until you enable them and configure your own provider key.

Use AI features with caution:

- Provider calls may cost money and costs are your responsibility.
- Prefer prepaid API budgets or provider-side spending limits.
- Do not attach debug logs with secrets or raw provider payloads to public
  issues.
- Fully automatic flip generation and publishing is experimental; the safer
  path is still the manual flip builder where story text and images can be
  reviewed and edited before publishing.

## Optional Python Pipeline

The Python story pipeline is optional and disabled by default:

```bash
python3 -m pip install -r requirements.txt
```

Then set these values in `.env.local` if you want to test it:

```bash
IDENAAI_USE_PY_FLIP_PIPELINE=true
IDENAAI_PYTHON=python3
```

On Windows, set `IDENAAI_PYTHON=py -3` or the absolute path to your Python
interpreter.

## Tests

Typical targeted benchmark tests:

```bash
npm test -- --runInBand main/ai-providers/bridge.test.js
```

Lint:

```bash
npm run lint -- --format unix
```

Local release gate:

```bash
npm run release:check
```

This runs syntax checks for release helper scripts and critical Electron/AI
bridge files, full lint, the privacy audit, and the AI bridge regression suite.

Release packaging excludes local `.env*`, logs, `.tmp/`, `tmp/`, `data/`, and
coverage artifacts. Keep provider keys in the session-only UI or in local
untracked files, never in release artifacts.

## Sample benchmark data

Small labeled samples are included under [`samples/flips/`](samples/flips), including:

- [`flip-challenge-test-5-decoded-labeled.json`](samples/flips/flip-challenge-test-5-decoded-labeled.json)
- [`flip-challenge-test-20-decoded-labeled.json`](samples/flips/flip-challenge-test-20-decoded-labeled.json)

## Notes on historical paths

Some old docs, scripts, or notes may still mention paths like:

- `$WORKSPACE/idena-desktop`
- `$WORKSPACE/idena-go`

Those refer to the earlier multi-folder workspace layout.

For the current repository:

- the active desktop fork is the repo root
- `idena-go/`, `idena-wasm/`, and `idena-wasm-binding/` are bundled as additional source directories

## Disclaimer

This repository is research code. Large parts were assembled quickly and evolved through iterative experiments. Expect rough edges, missing cleanup, and documentation that may lag behind implementation details.

Use it with caution, especially when:

- spending money on API providers
- testing automated flip generation or publish flows
- relying on built-in node or wasm rebuild paths without verifying the bundled sources first

## License

This repository has multiple license scopes:

- Active desktop app fork and AI benchmark helper code: MIT. See
  [`LICENSE`](LICENSE) and [`LICENSES/MIT.txt`](LICENSES/MIT.txt).
- Bundled `idena-go/` snapshot: LGPL-3.0. See
  [`idena-go/LICENSE`](idena-go/LICENSE).
- Bundled `idena-wasm-binding/` snapshot: LGPL-3.0. See
  [`idena-wasm-binding/LICENSE`](idena-wasm-binding/LICENSE).

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) before preparing a public
release or binary distribution.
