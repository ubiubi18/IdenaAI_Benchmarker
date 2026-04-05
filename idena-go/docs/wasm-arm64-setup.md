# WASM arm64 Setup (macOS)

This setup enables full WASM contract execution for `idena-go v1.1.2` on Apple Silicon.

## 1) Prepare local binding module

```bash
cd $WORKSPACE
rm -rf idena-wasm-binding
curl -L https://github.com/idena-network/idena-wasm-binding/archive/4227b9778d3d8c70157a8a34318439e6f897d608.tar.gz -o idena-wasm-binding-4227b9778d3d8c70157a8a34318439e6f897d608.tar.gz
rm -rf idena-wasm-binding
tar -xzf idena-wasm-binding-4227b9778d3d8c70157a8a34318439e6f897d608.tar.gz
mv idena-wasm-binding-4227b9778d3d8c70157a8a34318439e6f897d608 idena-wasm-binding
```

## 2) Build darwin/arm64 libidena_wasm

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
source "$HOME/.cargo/env"
cd $WORKSPACE
rm -rf idena-wasm
curl -L https://github.com/idena-network/idena-wasm/archive/refs/tags/v0.0.30.tar.gz -o idena-wasm-v0.0.30.tar.gz
tar -xzf idena-wasm-v0.0.30.tar.gz
mv idena-wasm-0.0.30 idena-wasm
cd $WORKSPACE/idena-wasm
cargo build --release --target aarch64-apple-darwin
cp $WORKSPACE/idena-wasm/target/aarch64-apple-darwin/release/libidena_wasm.a $WORKSPACE/idena-wasm-binding/lib/libidena_wasm_darwin_arm64.a
```

## 3) Patch linker selectors in binding module

```bash
cat <<'GO' > $WORKSPACE/idena-wasm-binding/lib/link_std_darwin.go
//go:build darwin && amd64

package lib

// #cgo LDFLAGS: -L${SRCDIR} -lidena_wasm_darwin_amd64
import "C"
GO
cat <<'GO' > $WORKSPACE/idena-wasm-binding/lib/link_std_darwin_arm64.go
//go:build darwin && arm64

package lib

// #cgo LDFLAGS: -L${SRCDIR} -lidena_wasm_darwin_arm64
import "C"
GO
```

## 4) Build node and run wasm tests

```bash
cd $WORKSPACE/idena-go
GOTOOLCHAIN=go1.19.13 go build -ldflags "-X main.version=1.1.2" -o "~/Library/Application Support/Idena/node/idena-go" .
chmod 755 "~/Library/Application Support/Idena/node/idena-go"
"~/Library/Application Support/Idena/node/idena-go" --version
GOTOOLCHAIN=go1.19.13 go test ./vm/wasm -count=1
```

## One-command rebuild helper

```bash
source "$HOME/.cargo/env"
$WORKSPACE/idena-go/scripts/build-node-macos-arm64.sh
```
