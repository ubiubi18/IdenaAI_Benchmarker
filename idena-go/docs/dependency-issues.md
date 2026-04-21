# Dependency Issues (Chain)

## 2026-03-25 - Issue 1: `v1.1.2` build failed with Go 1.26 (quic-go mismatch)

- Command:
  - `cd $WORKSPACE/idena-go && go build -o /tmp/idena-go-v1.1.2-arm64 .`
- Error summary:
  - Build failed due to quic-go compatibility guard for newer Go toolchain.
- Root cause hypothesis:
  - `idena-go v1.1.2` dependency graph is tied to Go 1.19-era networking stack.
- Fix attempt:
  - Build with the repo wrapper that pins the compatible toolchain:
  - `cd $WORKSPACE/idena-go && ./scripts/run-go-toolchain.sh build -o /tmp/idena-go-v1.1.2-arm64 .`
- Result:
  - Toolchain mismatch resolved; build progressed to next linker issue.

## 2026-03-25 - Issue 2: Apple Silicon link failure in `idena-wasm-binding`

- Command:
  - `cd $WORKSPACE/idena-go && ./scripts/run-go-toolchain.sh build -o /tmp/idena-go-v1.1.2-arm64 .`
- Error summary:
  - linker failed because upstream module contains `libidena_wasm_darwin_amd64.a` but no darwin/arm64 static archive.
- Root cause hypothesis:
  - `github.com/idena-network/idena-wasm-binding@4227b9778d3d` ships darwin binary only for amd64.
- Fix attempt:
  - Built `libidena_wasm` for `aarch64-apple-darwin` from `idena-wasm v0.0.30`.
  - Added new static library to local `idena-wasm-binding` module:
    - `lib/libidena_wasm_darwin_arm64.a`
  - Added darwin arm64 linker file in binding module:
    - `lib/link_std_darwin_arm64.go`
  - narrowed existing darwin amd64 linker file to `darwin && amd64`.
  - pointed `idena-go` to local binding module via:
    - `replace github.com/idena-network/idena-wasm-binding => ../idena-wasm-binding`
  - rebuilt with version ldflag and ran wasm package tests:
  - `cd $WORKSPACE/idena-go && ./scripts/run-go-toolchain.sh build -ldflags "-X main.version=1.1.2" -o /tmp/idena-go-v1.1.2-arm64 .`
  - `cd $WORKSPACE/idena-go && ./scripts/run-go-toolchain.sh test ./vm/wasm -count=1`
- Result:
  - Node binary builds successfully on macOS arm64 with WASM symbols linked.
  - `vm/wasm` tests pass on this machine.
