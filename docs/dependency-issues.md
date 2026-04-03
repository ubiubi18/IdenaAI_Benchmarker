# Dependency Issues (Desktop)

## 2026-03-22 - Issue 1: `npx eslint` pulled incompatible ESLint 10
- Command:
  - `cd $WORKSPACE/idena-desktop && npx eslint main/channels.js main/ai-providers.js main/index.js main/preload.js main/logger.js renderer/shared/providers/settings-context.js renderer/screens/settings/layout.js renderer/pages/settings/ai.js renderer/screens/validation/machine.js renderer/pages/validation.js renderer/screens/validation/ai/solver-orchestrator.js`
- Error summary:
  - ESLint 10 was auto-installed and failed because repo uses legacy config format.
- Root cause hypothesis:
  - Local dependencies were not installed; `npx` selected latest ESLint instead of project-pinned version.
- Fix attempt:
  - Install project dependencies and use local ESLint binary/script.
- Result:
  - Resolved after local install (see issues 2 and 3 for install blockers and fix).

## 2026-03-22 - Issue 2: `npm install` failed with `ERR_SSL_CIPHER_OPERATION_FAILED`
- Command:
  - `cd $WORKSPACE/idena-desktop && npm install`
- Error summary:
  - TLS cipher operation failure during install/audit phase.
- Root cause hypothesis:
  - Registry/audit TLS path instability on this environment.
- Fix attempt:
  - Re-run with audit disabled:
  - `cd $WORKSPACE/idena-desktop && npm install --no-audit --no-fund`
- Result:
  - Moved past TLS audit path, then hit Electron binary issue (Issue 3).

## 2026-03-22 - Issue 3: Electron `v9.4.0` Darwin arm64 binary 404
- Command:
  - `cd $WORKSPACE/idena-desktop && npm install --no-audit --no-fund`
- Error summary:
  - `electron-v9.4.0-darwin-arm64.zip` not found.
- Root cause hypothesis:
  - This legacy Electron release does not provide arm64 macOS binaries.
- Fix attempt:
  - Skip Electron binary download for dependency install:
  - `cd $WORKSPACE/idena-desktop && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --no-audit --no-fund`
- Result:
  - Install succeeded; local linting became available.

## 2026-03-22 - Issue 4: Next.js dev runtime failed with OpenSSL hash error on Node 20
- Command:
  - `cd $WORKSPACE/idena-desktop && ./node_modules/.bin/next dev renderer -p 3105`
- Error summary:
  - `ERR_OSSL_EVP_UNSUPPORTED` from webpack hash creation.
- Root cause hypothesis:
  - Legacy webpack/next stack in this tag is incompatible with Node 20 OpenSSL defaults.
- Fix attempt:
  - Launch with OpenSSL legacy provider:
  - `cd $WORKSPACE/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3105`
- Result:
  - Dev server starts and page previews can be captured.

## 2026-03-23 - Issue 5: Jest bridge test failed due Electron binary requirement
- Command:
  - `cd $WORKSPACE/idena-desktop && npm test -- --runInBand main/ai-providers/profile.test.js main/ai-providers/decision.test.js main/ai-providers/bridge.test.js`
- Error summary:
  - `Electron failed to install correctly, please delete node_modules/electron and try installing again`
  - stack originated from `main/app-data-path.js` during import.
- Root cause hypothesis:
  - Legacy Electron binary is intentionally skipped on this environment (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`), but `bridge.js` imported `app-data-path` at module load time during Jest tests.
- Fix attempt:
  - Avoid hard import-time dependency by making `app-data-path` optional at startup and requiring it only for default runtime path resolution.
  - Keep test flow using injected `writeBenchmarkLog` and `now` dependencies.
- Result:
  - Jest suites for `main/ai-providers/*.test.js` pass without requiring Electron runtime binaries.

## 2026-03-25 - Issue 6: Inbuilt node `v1.1.2` missing macOS arm64 release asset
- Command:
  - Desktop inbuilt node init path (`init-local-node`) via `main/idena-node.js` release resolution.
- Error summary:
  - `v1.1.2` tag does not provide a compatible `darwin/arm64` downloadable node artifact.
- Root cause hypothesis:
  - upstream release packaging for this tag lacks Apple Silicon mac binary.
- Fix attempt:
  - pin updater to tag `v1.1.2` and add local build fallback for `darwin/arm64`:
  - source detection: sibling `idena-go` repo
  - build command at runtime: `go build -ldflags "-X main.version=1.1.2"` with `GOTOOLCHAIN=go1.19.13`
- Result:
  - Desktop can prepare an inbuilt `v1.1.2` node binary on macOS arm64 without depending on unavailable release assets.

## 2026-03-25 - Issue 7: Full WASM support required on macOS arm64
- Command:
  - `cd $WORKSPACE/idena-go && GOTOOLCHAIN=go1.19.13 go test ./vm/wasm -count=1`
- Error summary:
  - Product requirement rejected no-wasm fallback; benchmark fork needs full protocol fidelity.
- Root cause hypothesis:
  - arm64 static wasm library absent in upstream binding package.
- Fix attempt:
  - built `libidena_wasm` for `aarch64-apple-darwin` from `idena-wasm v0.0.30`.
  - added `libidena_wasm_darwin_arm64.a` and `link_std_darwin_arm64.go` in local `idena-wasm-binding`.
  - restricted existing darwin linker file to amd64 and wired `idena-go` to local binding module via `replace`.
  - added `idena-go/scripts/build-node-macos-arm64.sh` and updated desktop `main/idena-node.js` to invoke it when present.
- Result:
  - `go test ./vm/wasm` passes on macOS arm64.
  - inbuilt node binary can be rebuilt at version `1.1.2` with WASM enabled.

## 2026-03-25 - Issue 8: Electron start blocked by global `NODE_OPTIONS`
- Command:
  - `cd $WORKSPACE/idena-desktop && export NODE_OPTIONS=--openssl-legacy-provider && npm run start`
- Error summary:
  - `electron: --openssl-legacy-provider is not allowed in NODE_OPTIONS`
- Root cause hypothesis:
  - Electron runtime rejects this flag when provided through global `NODE_OPTIONS`.
- Fix attempt:
  - Clear `NODE_OPTIONS` in package start script scope:
  - `start: "NODE_OPTIONS= dotenv -e .env.local electron ."`
- Result:
  - `npm run start` no longer fails with this Electron flag rejection even when shell has `NODE_OPTIONS` set.
