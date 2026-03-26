# Reproducible Setup

## 1. Prerequisites

- macOS or Linux
- Node.js (LTS compatible with `idena-desktop` v0.39.1)
- npm
- Go toolchain compatible with `idena-go` v1.1.2
- Rust toolchain (optional, for rebuilding wasm)

## 2. Create workspace

```bash
export WORKSPACE="$HOME/idena-ai-benchmark-workspace"
mkdir -p "$WORKSPACE"
cd "$WORKSPACE"
```

## 3. Clone upstream repositories

```bash
git clone https://github.com/idena-network/idena-go.git
git clone https://github.com/idena-network/idena-desktop.git
git clone https://github.com/idena-network/idena-wasm.git
git clone https://github.com/idena-network/idena-wasm-binding.git
```

## 4. Pin anchor versions

```bash
cd "$WORKSPACE/idena-go"
git fetch --tags --prune
git switch --detach v1.1.2
git switch -c research/benchmark-chain

cd "$WORKSPACE/idena-desktop"
git fetch --tags --prune
git switch --detach v0.39.1
git switch -c research/benchmark-desktop
```

## 5. Build and run desktop

```bash
cd "$WORKSPACE/idena-desktop"
npm install
npm run start
```

## 6. Validate snapshot integrity

```bash
cd "$WORKSPACE/IdenaAI_Benchmarker"
bash scripts/verify_snapshot.sh
```
