# Dependency Issues (Desktop)

## 2026-03-22 - Issue 1: `npx eslint` pulled incompatible ESLint 10
- Command:
  - `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npx eslint main/channels.js main/ai-providers.js main/index.js main/preload.js main/logger.js renderer/shared/providers/settings-context.js renderer/screens/settings/layout.js renderer/pages/settings/ai.js renderer/screens/validation/machine.js renderer/pages/validation.js renderer/screens/validation/ai/solver-orchestrator.js`
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
  - `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm install`
- Error summary:
  - TLS cipher operation failure during install/audit phase.
- Root cause hypothesis:
  - Registry/audit TLS path instability on this environment.
- Fix attempt:
  - Re-run with audit disabled:
  - `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm install --no-audit --no-fund`
- Result:
  - Moved past TLS audit path, then hit Electron binary issue (Issue 3).

## 2026-03-22 - Issue 3: Electron `v9.4.0` Darwin arm64 binary 404
- Command:
  - `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm install --no-audit --no-fund`
- Error summary:
  - `electron-v9.4.0-darwin-arm64.zip` not found.
- Root cause hypothesis:
  - This legacy Electron release does not provide arm64 macOS binaries.
- Fix attempt:
  - Skip Electron binary download for dependency install:
  - `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --no-audit --no-fund`
- Result:
  - Install succeeded; local linting became available.

## 2026-03-22 - Issue 4: Next.js dev runtime failed with OpenSSL hash error on Node 20
- Command:
  - `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && ./node_modules/.bin/next dev renderer -p 3105`
- Error summary:
  - `ERR_OSSL_EVP_UNSUPPORTED` from webpack hash creation.
- Root cause hypothesis:
  - Legacy webpack/next stack in this tag is incompatible with Node 20 OpenSSL defaults.
- Fix attempt:
  - Launch with OpenSSL legacy provider:
  - `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && env NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/next dev renderer -p 3105`
- Result:
  - Dev server starts and page previews can be captured.

## 2026-03-23 - Issue 5: Jest bridge test failed due Electron binary requirement
- Command:
  - `cd /Users/jz/Documents/idena-benchmark-workspace/idena-desktop && npm test -- --runInBand main/ai-providers/profile.test.js main/ai-providers/decision.test.js main/ai-providers/bridge.test.js`
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
