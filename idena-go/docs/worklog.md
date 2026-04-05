# Worklog (Chain)

## 2026-03-22 - Anchor update and sequencing

### Decision
- Accepted anchor update from `idena-go v1.0.3` to `idena-go v1.1.2`.
- Accepted sequencing change to start implementation with desktop AI-helper UX and cloud-provider integration.

### Commands
- `git -C $WORKSPACE/idena-go fetch --tags --prune`
- `git -C $WORKSPACE/idena-go switch --detach v1.1.2`
- `git -C $WORKSPACE/idena-go switch -c research/benchmark-chain`

### Result
- Chain repository is anchored at `v1.1.2` and ready for protocol work after desktop MVP.

## 2026-03-25 - Step 2: macOS arm64 full WASM build path for `v1.1.2`

### Why
- Built-in desktop node needed to run `idena-go v1.1.2` on Apple Silicon with WASM enabled.
- Upstream `v1.1.2` wasm binding does not provide darwin/arm64 static library.

### Inspected
- local `idena-wasm-binding` module artifacts
- `idena-wasm v0.0.30` source build outputs
- `go.mod` module wiring in `idena-go`

### Changed
- Built `libidena_wasm` for `aarch64-apple-darwin` from `idena-wasm v0.0.30`.
- Added arm64 darwin static lib and linker selector in local `idena-wasm-binding`.
- Updated `idena-go/go.mod` to use the local binding module (`replace ... => ../idena-wasm-binding`).
- Added helper script:
  - `scripts/build-node-macos-arm64.sh`
  - builds arm64 wasm lib + rebuilds `idena-go v1.1.2` in one command.
- Added setup doc:
  - `docs/wasm-arm64-setup.md`

### Commands
- `source "$HOME/.cargo/env" && cd $WORKSPACE/idena-wasm && cargo build --release --target aarch64-apple-darwin`
- `cp $WORKSPACE/idena-wasm/target/aarch64-apple-darwin/release/libidena_wasm.a $WORKSPACE/idena-wasm-binding/lib/libidena_wasm_darwin_arm64.a`
- `cd $WORKSPACE/idena-go && GOTOOLCHAIN=go1.19.13 go build -ldflags "-X main.version=1.1.2" -o /tmp/idena-go-v1.1.2-arm64-wasm .`
- `cd $WORKSPACE/idena-go && GOTOOLCHAIN=go1.19.13 go test ./vm/wasm -count=1`
- `source "$HOME/.cargo/env" && $WORKSPACE/idena-go/scripts/build-node-macos-arm64.sh`

### Result
- `idena-go v1.1.2` builds on macOS arm64 with WASM path linked.
- `vm/wasm` tests pass.
