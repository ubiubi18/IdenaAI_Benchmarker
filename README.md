# IdenaAI_Benchmarker

Reproducible audit bundle for the Idena AI benchmark fork work.

## Included components

- `idena-desktop` (desktop app fork with AI helper/test tooling)
- `idena-go` (`v1.1.2`-based chain/node fork work)
- `idena-wasm-binding` (included source + static libs)
- `idena-wasm` (source for rebuilding wasm artifacts)
- `samples/flips/*-decoded-labeled.json` (small labeled benchmark samples)

## Disclaimer (important)

This project was **100% vibe-coded with Codex** and large parts are **unchecked**.
It may contain critical bugs, vulnerabilities, incorrect logic, or other issues.
Use entirely at your own risk. No warranties of any kind.

Current state:
- It can run against Idena mainnet endpoints for production-like testing workflows.
- The intended long-term target is a separate forked benchmark chain.
- Development happened primarily on macOS, so some dependencies/build steps may fail on other systems.

## License

This repository is distributed under the MIT License. See `LICENSE`.

## Reproducible setup

Use environment variables instead of machine-specific paths.

Quick bootstrap:

```bash
bash scripts/bootstrap_upstream_workspace.sh
```

Manual bootstrap:

```bash
export WORKSPACE="$HOME/idena-ai-benchmark-workspace"
mkdir -p "$WORKSPACE"
cd "$WORKSPACE"

git clone https://github.com/idena-network/idena-go.git
git clone https://github.com/idena-network/idena-desktop.git
git clone https://github.com/idena-network/idena-wasm.git
git clone https://github.com/idena-network/idena-wasm-binding.git

cd "$WORKSPACE/idena-go"
git fetch --tags --prune
git switch --detach v1.1.2
git switch -c research/benchmark-chain

cd "$WORKSPACE/idena-desktop"
git fetch --tags --prune
git switch --detach v0.39.1
git switch -c research/benchmark-desktop
```

For this audit bundle (already assembled), run:

```bash
cd IdenaAI_Benchmarker
bash scripts/verify_snapshot.sh
```

## Local run

```bash
cd idena-desktop
npm install
npm run start
```

## Load labeled sample flips

```bash
cd idena-desktop
python3 scripts/preload_ai_test_unit_queue.py \
  --input ../samples/flips/flip-challenge-test-20-decoded-labeled.json \
  --replace \
  --max-total 20 \
  --source audit-sample
```
